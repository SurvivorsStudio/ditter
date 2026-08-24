"""Python 전처리 노드의 **부모측 게이트웨이** — 격리 자식 프로세스를 관리한다.

자식(pysandbox_child.py)을 절대경로로 직접 띄운다(패키지 import 회피). 환경변수를
최소한으로 스크럽해 넘겨 시크릿이 자식에 새지 않게 하고, 배치를 NDJSON 으로
주고받는다. 자식이 멈추면(무한 루프 등) wall-clock 타임아웃으로 죽인다.

한 노드 실행 동안 자식은 하나만 살아 있고 배치를 연달아 처리한다 — 행마다
프로세스를 띄우는 비용을 피하기 위해서다.
"""

from __future__ import annotations

import base64
import contextlib
import datetime as _dt
import decimal as _decimal
import json
import os
import select
import signal
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from eai_connectors.errors import ConfigurationError

#: 자식 스크립트 절대경로. 파일로 직접 실행하므로 eai_worker 패키지가 로드되지 않는다.
_CHILD = str(Path(__file__).with_name("pysandbox_child.py"))

#: 기본 자원 한계. 배치 하나를 처리하는 데 걸리는 wall-clock 상한(초)과
#: 자식 CPU/메모리 상한. pandas/numpy 를 기본 제공하므로 메모리가 넉넉하다
#: (numpy·OpenBLAS 가 큰 주소공간을 예약해 256MB 로는 import 조차 못 한다).
DEFAULT_BATCH_TIMEOUT_SEC = 30.0
DEFAULT_CPU_SECONDS = 15
DEFAULT_MEMORY_MB = 1024


def _json_default(value: Any) -> Any:
    """부모 → 자식 방향 직렬화. 자식측과 같은 규칙으로 값을 정규화한다."""
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, _decimal.Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (set, frozenset)):
        return list(value)
    return str(value)


def _scrubbed_env() -> dict[str, str]:
    """자식에 넘길 최소 환경. 시크릿·자격증명·연결정보는 일부러 뺀다.

    자식은 표준 라이브러리만 쓰므로 PYTHONPATH 도 필요 없다(설치된 인터프리터의
    site-packages 로 충분). 로케일만 UTF-8 로 맞춰 준다.
    """
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        # numpy/pandas(OpenBLAS·OMP)를 단일 스레드로 묶는다 — 스레드 폭발을 막고
        # 메모리·CPU 사용을 예측 가능하게 하며, 자식의 스레드 생성을 최소화한다.
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
    }
    if sys.platform == "darwin":
        # macOS 에서 fork 안전성 회피 — 자식은 subprocess spawn 이라 무관하지만,
        # 혹시 모를 네이티브 초기화까지 막아 둔다.
        env["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"
    return env


class PySandbox:
    """격리 자식 프로세스 하나를 감싸는 컨텍스트 매니저.

    사용::

        with PySandbox(code) as sb:
            out_rows = sb.run_batch(rows)
    """

    def __init__(
        self,
        code: str,
        *,
        batch_timeout_sec: float = DEFAULT_BATCH_TIMEOUT_SEC,
        cpu_seconds: int = DEFAULT_CPU_SECONDS,
        memory_mb: int = DEFAULT_MEMORY_MB,
        on_output: Callable[[str], None] | None = None,
    ) -> None:
        self._code = code
        self._timeout = batch_timeout_sec
        self._cpu = cpu_seconds
        self._mem = memory_mb
        #: 사용자 코드가 print 한 내용(배치 단위)을 받는 콜백 — 런 로그로 흘려보낸다
        self._on_output = on_output
        self._proc: subprocess.Popen[str] | None = None
        #: 자식이 코드를 보고 정한 처리 모드 — "row"(행 단위) | "batch"(전체 행). init 후 채워진다.
        self.mode: str = "row"

    def __enter__(self) -> PySandbox:
        self._spawn()
        self._init()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ── 내부 ──────────────────────────────────────────────────────────────
    def _spawn(self) -> None:
        self._proc = subprocess.Popen(
            [sys.executable, "-I", _CHILD, str(self._cpu), str(self._mem)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_scrubbed_env(),
            text=True,
            encoding="utf-8",
            bufsize=1,  # 라인 버퍼링
            close_fds=True,
            start_new_session=True,  # 자체 프로세스 그룹 — 타임아웃 시 그룹째 죽인다
        )

    def _init(self) -> None:
        self._send({"code": self._code})
        reply = self._recv()
        if not reply.get("ok"):
            self.close()
            raise ConfigurationError(reply.get("error", "Python 노드 초기화 실패"))
        self.mode = str(reply.get("mode", "row"))

    def _send(self, obj: dict[str, Any]) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise ConfigurationError("Python 샌드박스가 종료되었습니다")
        try:
            proc.stdin.write(json.dumps(obj, ensure_ascii=False, default=_json_default))
            proc.stdin.write("\n")
            proc.stdin.flush()
        except (BrokenPipeError, ValueError) as exc:
            raise ConfigurationError(f"Python 샌드박스로 전송 실패: {self._death_reason() or exc}") from exc

    def _recv(self) -> dict[str, Any]:
        proc = self._proc
        if proc is None or proc.stdout is None:
            raise ConfigurationError("Python 샌드박스가 종료되었습니다")
        # wall-clock 타임아웃 — 자식이 응답 한 줄을 낼 때까지 select 로 기다린다.
        ready, _, _ = select.select([proc.stdout], [], [], self._timeout)
        if not ready:
            self.close()
            raise ConfigurationError(
                f"Python 코드가 제한시간({self._timeout:.0f}초)을 초과했습니다 — "
                "무한 루프거나 너무 무거운 연산일 수 있습니다"
            )
        line = proc.stdout.readline()
        if not line:
            raise ConfigurationError(
                f"Python 샌드박스가 응답 없이 종료되었습니다: {self._death_reason() or '알 수 없음'}"
            )
        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ConfigurationError(f"Python 샌드박스 응답 파싱 실패: {exc}") from exc
        if not isinstance(data, dict):
            raise ConfigurationError("Python 샌드박스가 잘못된 형식을 반환했습니다")
        return data

    def _death_reason(self) -> str | None:
        """자식이 죽었으면 종료코드/시그널과 stderr 를 사람이 읽을 문장으로 만든다."""
        proc = self._proc
        if proc is None:
            return None
        rc = proc.poll()
        if rc is None:
            return None
        stderr = ""
        if proc.stderr is not None:
            try:
                stderr = proc.stderr.read() or ""
            except (OSError, ValueError):
                stderr = ""
        if rc < 0:
            sig = signal.Signals(-rc).name
            hint = {
                "SIGKILL": "메모리 한계 초과로 강제 종료되었을 수 있습니다",
                "SIGXCPU": "CPU 시간 한계를 초과했습니다",
                "SIGSEGV": "세그멘테이션 오류",
            }.get(sig, "")
            parts = [f"시그널 {sig}"]
            if hint:
                parts.append(f" — {hint}")
            if stderr.strip():
                parts.append(f": {stderr.strip()}")
            return "".join(parts)
        tail = stderr.strip().splitlines()[-3:]
        return f"종료코드 {rc}{(': ' + ' / '.join(tail)) if tail else ''}"

    # ── 공개 API ──────────────────────────────────────────────────────────
    def run_batch(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """행 목록을 자식에 보내 변환 결과를 받는다. 사용자 코드 오류면 실패로 올린다."""
        if not rows:
            return []
        self._send({"rows": rows})
        reply = self._recv()
        if not reply.get("ok"):
            idx = reply.get("index")
            where = f" (행 {idx})" if idx is not None else ""
            raise ConfigurationError(f"Python 코드 오류{where}: {reply.get('error', '알 수 없음')}")
        # 사용자 print 출력이 있으면 런 로그로 흘려보낸다
        printed = reply.get("stdout")
        if printed and self._on_output is not None:
            self._on_output(str(printed))
        result = reply.get("rows", [])
        if not isinstance(result, list):
            raise ConfigurationError("Python 샌드박스가 잘못된 형식을 반환했습니다")
        return result

    def close(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream is not None:
                with contextlib.suppress(OSError, ValueError):
                    stream.close()
        if proc.poll() is None:
            try:
                # 자체 세션이라 그룹째 죽여 자식이 띄웠을 손자까지 정리한다.
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                with contextlib.suppress(OSError):
                    proc.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=5)
