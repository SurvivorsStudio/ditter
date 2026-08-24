"""테스트 공통 설정.

``Settings()`` 는 ``EAI_JWT_SECRET`` 이 없으면 기동을 거부한다 — 운영에서는 옳지만
(32바이트 미만 금지, RFC 7518 §3.2), 설정값 하나를 읽는 단위 테스트까지 그 때문에
갈리면 안 된다. 실제로 그 탓에 테스트가 **실행 순서에 따라** 통과하기도 실패하기도 했다.

로컬 우회 경로(``EAI_AUTH_ENABLED=false``)를 여기서 한 번 켠다. ``setdefault`` 라
바깥에서 준 값이 있으면 그쪽이 이긴다.
"""

from __future__ import annotations

import os

os.environ.setdefault("EAI_AUTH_ENABLED", "false")
