## 무엇을 바꿨나

<!-- 한두 문장. 관련 STEP 문서 링크를 남긴다 (예: docs/todo/step-01-db-connection.md) -->

## 왜

<!-- 배경·근거. 정책 문서에서 나온 결정이면 그 문서를 링크한다. -->

## 확인한 것

<!-- 실제로 돌려본 것만 적는다. 안 돌려봤으면 안 돌려봤다고 적는다. -->

- [ ] `npm run lint` / `npm run typecheck` / `npm test` 통과
- [ ] 변경한 영역을 실제로 실행해 확인

## 체크리스트

- [ ] 커밋을 영역별(`frontend/`·`backend/`·`packages/`·`docs/`)로 분리했다
      ([commit-convention.md](../docs/conventions/commit-convention.md))
- [ ] 정책·설계가 바뀌었다면 `docs/` 를 함께 갱신했다 (CLAUDE.md 「문서 갱신 원칙」)
- [ ] 읽기 전용 경계를 건드렸다면 2인 리뷰를 받았다
      ([read-only-enforcement.md](../docs/policy/read-only-enforcement.md))
- [ ] 새 의존성을 추가했다면 "직접 짤 수 있나"를 먼저 검토했다
      ([supply-chain-security.md](../docs/policy/supply-chain-security.md) S1)
