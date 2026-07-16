# ditter

운영 중인 PostgreSQL에 붙어서, 위험한 쿼리를 실행하기 전에 잡아내고 AI와 함께 고칠 수 있게 해주는 읽기 전용 웹 SQL 콘솔.

## 문서

- [docs/todo](docs/todo/README.md) — 개발 단계(STEP 0~10)와 완료 조건
- [docs/policy](docs/policy/README.md) — 보안·데이터 취급 정책
- [docs/conventions](docs/conventions/README.md) — 개발 언어·코드 컨벤션
- [docs/schema](docs/schema/README.md) — DITTER 로컬 SQLite 테이블 스키마
- `.requirements/` — 신규 기능 설계서를 작성하는 로컬 전용 디렉토리(커밋 대상 아님, `.gitignore` 처리됨)

## 문서 갱신 원칙

대화 중에 정책·설계가 바뀌거나 새로 정해지면, 그 자리에서 결정만 내리고 넘어가지 않는다. 논의로
확정한 뒤에는 관련 문서(주로 `docs/policy`, 필요하면 `docs/todo`·`docs/conventions`·`docs/schema`)를
그 결정에 맞게 갱신한다. 문서의 기존 내용과 대화에서 새로 정한 내용이 다르면 문서 쪽을 최신
결정에 맞게 고친다 — 대화에서만 정하고 문서를 그대로 두지 않는다.
