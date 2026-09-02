## 무엇을 바꿨나

Closes #

<!-- 한두 문장으로 무엇을 바꿨는지 적는다.

     위 `Closes #` 에는 **이 PR 이 실제로 닫는** 이슈 번호만 넣는다. 참고로만 관련된 이슈는
     본문에서 `#123` 으로 언급만 한다.
     근거 이슈 없이 시작한 작업이면 **그 줄을 통째로 지운다** — 번호를 지어내지 않는다.
     근거 이슈가 없는 PR 도 정상이다. (commit-convention.md §5.2) -->

## 왜

<!-- 배경과 근거. 설계 결정이 걸린 변경이면 CLAUDE.md 의 해당 절을 링크한다. -->

## 확인한 것

<!-- 실제로 돌려본 것만 적는다. 안 돌려봤으면 안 돌려봤다고 적는다.
     아래는 바꾼 영역의 것만 남기고 나머지는 지운다. -->

```bash
# Python 영역 (api · worker · connectors · sap-connector)
cd apps/<영역> && uv run --extra dev pytest -q && uv run --extra dev ruff check . && uv run --extra dev mypy src
```

```bash
# web
cd apps/web && npm test && npm run lint && npm run build
```

- [ ] 바꾼 영역의 테스트·린트·타입체크가 통과한다
- [ ] 변경한 화면/경로를 실제로 실행해 확인했다

## 체크리스트

- [ ] 근거 이슈가 있으면 본문 맨 위에 `Closes #N` 을 적었다 — 없으면 그 줄을 지웠다
      ([commit-convention.md](https://github.com/SurvivorsStudio/ditter/blob/main/docs/conventions/commit-convention.md) §5.2).
      이 선언이 머지 게이트(§5.1)가 겹치는 PR 을 찾는 **유일한 근거**다
- [ ] 커밋을 **영역별로 분리**했다 — api·web·worker·connectors·sap-connector·cdc·sync·docs
      ([commit-convention.md](https://github.com/SurvivorsStudio/ditter/blob/main/docs/conventions/commit-convention.md) §1)
- [ ] 브랜치명이 `feature/`·`fix/`·`bug/` 로 시작한다 (§4)
- [ ] 새 커넥터·새 노드를 추가했다면 **단위 테스트를 함께** 넣었다 (CLAUDE.md §11)
- [ ] 설계 결정이 바뀌었다면 `CLAUDE.md`·`docs/` 를 함께 갱신했다
- [ ] **시크릿·자격증명이 코드·로그·테스트 픽스처에 남지 않았다** (CLAUDE.md §11)

<!-- 아래는 해당할 때만 -->

- [ ] 읽기 전용 경계(`ensure_statement_allowed`·`ensure_select_only`)를 건드렸다
      — **리뷰어에게 이 사실을 명시**한다. 이 저장소에서 되돌리기 가장 어려운 경계다
- [ ] 메타DB 스키마를 바꿨다 — Alembic 마이그레이션을 포함했고 `alembic upgrade head` 를 돌려봤다
- [ ] 프런트·백엔드 **양쪽에 같은 상수**가 있는 것을 고쳤다 (`SQL_STATEMENTS`·`DUCK_TYPES`·`SYNC_CHANNELS`, 그리고 백엔드 `rbac.py` 의 `_IMPLIES` ↔ 프런트 `auth.can()`)
      — 한쪽만 고치면 화면과 서버가 어긋난다
- [ ] `apps/connectors/` 계약을 바꿨다 — **커넥터 커밋을 소비 측(api·worker)보다 먼저** 올렸다 (§1)
