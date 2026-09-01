"""dag 문구 — `schemas/dag.py` 의 파이프라인 검증과 그것을 감싸는 실행 게이트.

값은 **[한국어, 영어] 쌍**이다 (프론트 `web/src/i18n/messages/*.ts` 와 같은 모양 —
리뷰에서 두 언어가 나란히 보이고, 키가 한쪽에만 있는 상태가 자료구조상 불가능하다).

**ko 문구는 기존 리터럴과 바이트 동일하게 유지한다** — 기존 테스트 160여 건이 한글
부분 문자열을 단언한다(`test_dag.py` 의 `"노드가 없" in i.message` 등).
`이(가)`·`은(는)` 같은 어색한 조사 회피 표기도 그대로 둔다. 한국어 표현 개선은 별건이다.
"""

from __future__ import annotations

dag: dict[str, tuple[str, str]] = {}
