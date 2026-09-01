"""sync 문구 — `services/sync_service.py` 의 착수 점검과 예외.

값은 **[한국어, 영어] 쌍**이다. ko 는 기존 리터럴과 바이트 동일하게 유지한다.

착수 점검 항목은 `PreflightCheck.key` 를 이미 갖고 있으므로(`schemas/stream.py`)
label 을 `sync.pre.<key>.label` 로 **유도**한다 — 호출부에서 label 인자가 사라진다.
"""

from __future__ import annotations

sync: dict[str, tuple[str, str]] = {}
