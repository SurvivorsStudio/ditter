"""팬아웃 스풀 — 한 번 읽은 스트림을 여러 소비자에게 다시 흘린다.

Phase 1 의 엔진은 한 소스가 여러 타깃에 연결되면 소스를 타깃 수만큼 **다시 읽었다**.
제너레이터는 한 번만 소비할 수 있기 때문이다. 소스가 원격 DB 면 그만큼 부하가 곱해지고,
읽는 사이에 원본이 바뀌면 타깃끼리 내용이 어긋난다.

여기서는 첫 소비자가 당겨오는 배치를 **디스크에 JSONL 로 적으면서** 흘려보내고,
두 번째 이후 소비자는 그 파일을 되읽는다. 메모리는 여전히 배치 단위로 상수이고,
소스는 정확히 한 번만 읽힌다.

디스크를 쓰는 이유: 메모리에 전부 담으면 대용량에서 워커가 죽는다. 스풀 파일은
실행이 끝나면 삭제된다.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Iterator
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from eai_connectors import RecordBatch

logger = logging.getLogger(__name__)


def _default(value: Any) -> Any:
    """JSON 이 모르는 타입을 타입 태그와 함께 적는다 — 되읽을 때 복원하기 위해서다."""
    if isinstance(value, datetime):
        return {"__t": "datetime", "v": value.isoformat()}
    if isinstance(value, date):
        return {"__t": "date", "v": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__t": "decimal", "v": str(value)}
    if isinstance(value, bytes):
        import base64

        return {"__t": "bytes", "v": base64.b64encode(value).decode("ascii")}
    return str(value)


def _revive(obj: dict[str, Any]) -> Any:
    tag = obj.get("__t")
    if tag is None:
        return obj
    raw = obj["v"]
    if tag == "datetime":
        return datetime.fromisoformat(raw)
    if tag == "date":
        return date.fromisoformat(raw)
    if tag == "decimal":
        return Decimal(raw)
    if tag == "bytes":
        import base64

        return base64.b64decode(raw)
    return obj


class SpooledStream:
    """스트림 하나를 여러 번 소비할 수 있게 만든다.

    ``tee()`` 를 호출할 때마다 새 이터레이터가 나온다. 첫 이터레이터가 원본을
    끝까지 당겨야 스풀이 완성되므로, 두 번째 이터레이터는 첫 소비가 끝난 뒤에
    돌리는 것을 전제로 한다 (엔진은 타깃을 순차 실행하므로 이 조건을 만족한다).
    """

    def __init__(self, source: Iterator[RecordBatch], *, label: str = "spool") -> None:
        self._source = source
        self._label = label
        self._path: str | None = None
        self._complete = False
        self._batches = 0
        self._rows = 0

    # ------------------------------------------------------------- 소비

    def tee(self) -> Iterator[RecordBatch]:
        """새 소비자용 이터레이터. 첫 호출은 원본을 읽으며 스풀을 만든다."""
        if self._complete:
            return self._replay()
        return self._fill_and_yield()

    def _fill_and_yield(self) -> Iterator[RecordBatch]:
        # mkstemp 로 경로만 확보하고 파일은 with 로 연다 — 실행이 끝난 뒤에도
        # 파일이 남아 있어야 재생할 수 있으므로 자동 삭제는 쓰지 않는다
        fd, self._path = tempfile.mkstemp(suffix=".jsonl", prefix=f"eai-{self._label}-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                for batch in self._source:
                    handle.write(
                        json.dumps(
                            {
                                "rows": batch.rows,
                                "columns": list(batch.columns),
                                "max_watermark": batch.max_watermark,
                                "is_last": batch.is_last,
                            },
                            ensure_ascii=False,
                            default=_default,
                        )
                        + "\n"
                    )
                    self._batches += 1
                    self._rows += len(batch.rows)
                    yield batch
            self._complete = True
            logger.debug(
                "스풀 완성: %s (%d배치 / %d행 / %s)",
                self._path,
                self._batches,
                self._rows,
                _human_size(self._path),
            )
        except BaseException:
            # 도중에 끊기면 스풀은 불완전하다 — 재생에 쓰면 데이터가 잘린다
            self._complete = False
            self.cleanup()
            raise

    def _replay(self) -> Iterator[RecordBatch]:
        if self._path is None or not self._complete:
            raise RuntimeError("스풀이 완성되지 않았습니다 — 첫 소비가 끝나기 전에 재생할 수 없습니다")
        with open(self._path, encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                payload = json.loads(line, object_hook=_revive)
                yield RecordBatch(
                    rows=payload["rows"],
                    columns=payload["columns"],
                    max_watermark=payload["max_watermark"],
                    is_last=payload["is_last"],
                )

    # ------------------------------------------------------------- 정리

    def cleanup(self) -> None:
        if self._path is None:
            return
        try:
            os.unlink(self._path)
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning("스풀 파일 삭제 실패: %s", self._path, exc_info=True)
        self._path = None

    @property
    def stats(self) -> dict[str, int]:
        return {"batches": self._batches, "rows": self._rows}


def _human_size(path: str | None) -> str:
    if not path:
        return "-"
    try:
        size = os.path.getsize(path)
    except OSError:
        return "-"
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f}{unit}"
        size //= 1024
    return f"{size}TB"
