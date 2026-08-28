# 변경 이력

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를,
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

> **커밋 이력만으로는 범위를 알 수 없다.** Phase 0~4 의 구현 대부분이 이관 커밋
> `dba5a94` 하나에 뭉쳐 들어왔다. 그래서 이 문서는 커밋이 아니라 **실제로 동작하는 기능**을
> 기준으로 적는다.

## [0.1.0] — 2026-08-28

Phase 0~4 완료 시점. 아래가 이 릴리스에서 동작하는 범위다.

### Added
- 이슈 폼(버그·기능 제안)과 PR 템플릿, `SECURITY.md` — GitHub 비공개 취약점 신고 창구
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- CI 가 린트까지 강제한다 — 4개 Python 앱 `ruff`, 웹 `eslint`·`tsc`·빌드
- `.github/dependabot.yml` 복구 (npm · uv · github-actions · docker)

### Fixed
- **`.env.example` 이 없어 저장소를 clone 한 사람이 실행할 수 없던 문제.**
  `docker compose` 가 `${VAR:?}` 로 기동을 거부했고 README 1단계부터 막혔다.
- `ruff` 32건 · `eslint` 10건 위반
- `variables.ts` 가 날 NUL 때문에 git 에서 바이너리로 취급되어, 그 파일의 변경이
  코드 리뷰와 PR 화면에 표시되지 않던 문제

### Changed
- README 의 테스트 수치와 품질 현황을 실제와 맞췄다 (테스트 1,278건)
- 저장소 루트의 `참고용/`(docs 와 중복된 사본 34개) 제거

### 기능 범위

#### SQL 콘솔
- MySQL · PostgreSQL · MSSQL · MongoDB · S3 · SAP · 로컬파일에 한 화면에서 붙어 조회
- 쿼리 탭 · 스키마 탐색기 · 저장된 쿼리 · 즐겨찾기 · 결과 그리드 · 내보내기
- **EXPLAIN / EXPLAIN ANALYZE** 로 실행 계획 확인 (PostgreSQL · MySQL)
- **노트북 모드** — 셀 단위 실행, 메모(md) 셀, 블록 재실행
- **연합 조회(DuckDB)** — 서로 다른 연결의 테이블을 한 SELECT 로 조인 (READ_ONLY ATTACH)
- 연합 쿼리를 그대로 도는 **Python 스크립트로 내보내기**

#### 안전장치
- **읽기 전용이 기본.** 위험 문장은 실행 전에 판정·차단하고, 쓰기는 연결별로 **명시 허용한
  명령만** 통과한다. 편집기·노트북·연합 탭 어디서 실행해도 같은 검사를 거친다.
- **자동/수동 커밋 토글.** 수동이면 결과를 확인한 뒤 커밋 또는 롤백한다.
- 잊힌 트랜잭션은 유휴 시간 뒤 **롤백**한다 (커밋이 아니다)
- JWT 인증 + 역할 기반 권한 (viewer / operator / editor / admin)

#### 데이터 파이프라인
- 드래그앤드롭 캔버스(React Flow)로 DAG 를 구성해 배치 실행
- 커넥터 플러그인 — MySQL · PostgreSQL · MSSQL · MongoDB · S3 · 로컬파일
- 변환 노드 — 필터 · 필드 매핑 · 격리 샌드박스에서 도는 **Python 전처리** · 조건 분기
- 증분(watermark) 적재, 체크포인트 기반 재시작, 팬아웃 스풀링
- Cron 스케줄러, 실행 이력·노드별 로그, WebSocket 실시간 진행률
- 노드 결과 참조 문법 `${노드이름.컬럼}`

#### 실시간 수집
- **CDC (Debezium)** — MySQL · PostgreSQL · MSSQL 소스, Kafka 토픽을 구독하는 Sink Worker
- **SymmetricDS 동기화** — 원본이 CDC 를 못 쓸 때의 트리거 기반 경로 (MSSQL → PostgreSQL)

#### SAP
- 전용 사이드카로 NW RFC SDK 를 격리
- BAPI 호출 · `RFC_READ_TABLE` (512자 행폭 자동 분할, 72자 WHERE 분할)
- SDK 없이 개발·CI 가 가능한 목 백엔드 — **512자 제약을 실제와 동일하게 강제한다**

#### AI 어시스턴트
- 자연어 → SQL 생성 · 실행 계획 기반 튜닝 · 오류 수정 · 차트 · 보고서
- **모델이 커넥터 플러그인이다** — Gemini · Bedrock · **Ollama(로컬 오픈웨이트)**
- 상용 API 없이 `docker compose --profile ai` 만으로 동작한다

#### MCP
- 기능을 MCP tool 로 노출해 UI 와 LLM/에이전트가 **같은 서비스 계층**을 재사용한다

[0.1.0]: https://github.com/SurvivorsStudio/ditter/releases/tag/v0.1.0
