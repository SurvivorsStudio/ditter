# ditter

운영 중인 PostgreSQL에 붙어서, 위험한 쿼리를 실행하기 전에 잡아내고 AI와 함께 고칠 수 있게 해주는 읽기 전용 웹 SQL 콘솔. 여기에 그 안전한 조회를 반복 적재로 만드는 **데이터 파이프라인(F7)**이 얹힌다.

## 문서

- [docs/todo](docs/todo/README.md) — 개발 단계(STEP 0~13)와 완료 조건
- [docs/policy](docs/policy/README.md) — 보안·데이터 취급 정책
- [docs/conventions](docs/conventions/README.md) — 개발 언어·코드 컨벤션
- [docs/schema](docs/schema/README.md) — DITTER 로컬 SQLite 테이블 스키마
- [docs/pipeline](docs/pipeline/README.md) — 데이터 파이프라인(F7) 설계: 커넥터 계약·DAG·실행 엔진·캔버스·배포
- `.requirements/` — 신규 기능 설계서를 작성하는 로컬 전용 디렉토리(커밋 대상 아님, `.gitignore` 처리됨)

## 절대 흐리면 안 되는 경계

DITTER는 **읽기 전용**이다. 파이프라인이 타깃에 쓰기 때문에 이 경계가 흐려지기 쉬운데, 흐려지는
순간 제품의 존재 이유가 사라진다. 파이프라인 관련 코드·문서를 건드릴 때는
[pipeline-write-boundary.md](docs/policy/pipeline-write-boundary.md)(P9)를 먼저 읽는다.

- 사람에게 열리는 SQL 실행 경로는 **읽기 전용 하나뿐**이다.
- 커넥션은 `source`/`target` 역할이 나뉘고 **겸할 수 없다.** 타깃은 콘솔에서 도달 불가.
- 타깃에 나가는 문장은 커넥터가 만드는 **세 가지(append/upsert/overwrite)뿐**이다. 사용자도 AI도
  자유형 SQL을 넣을 수 없다.

## 문서 갱신 원칙

대화 중에 정책·설계가 바뀌거나 새로 정해지면, 그 자리에서 결정만 내리고 넘어가지 않는다. 논의로
확정한 뒤에는 관련 문서(주로 `docs/policy`, 필요하면 `docs/todo`·`docs/conventions`·`docs/schema`·
`docs/pipeline`)를 그 결정에 맞게 갱신한다. 문서의 기존 내용과 대화에서 새로 정한 내용이 다르면 문서 쪽을 최신
결정에 맞게 고친다 — 대화에서만 정하고 문서를 그대로 두지 않는다.
