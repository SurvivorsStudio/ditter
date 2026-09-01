"""사전 모듈을 하나로 합친다.

프론트(`web/src/i18n/messages/`)는 **화면 단위**로 나눈다. 백엔드에는 화면이 없으니
**문구를 만드는 모듈 단위**로 나눈다 — "이 파일을 고칠 때 어느 사전을 보나"가 1:1 이 되고
커밋 경계와도 맞는다.

`dict` 병합은 중복 키를 **조용히 덮어쓴다.** `test_i18n.py` 가 모듈별 키 수의 합과 병합
결과의 크기를 비교해 그것을 막는다.
"""

from __future__ import annotations

from .dag import dag
from .sync import sync

MESSAGES: dict[str, tuple[str, str]] = {**dag, **sync}

#: 병합 전 모듈들 — 중복 키 검사가 이것을 본다.
MODULES: tuple[dict[str, tuple[str, str]], ...] = (dag, sync)
