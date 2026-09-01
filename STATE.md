# STATE

**다국어(ko/en)** 작업. 2026-09-01 기준. 규칙과 배경은 `CLAUDE.md` §27 에 있다 — 여기는
"어디까지 했고 다음은 무엇인가"만 적는다.

## 끝난 것

| 범위 | 상태 |
|---|---|
| 프론트 UI 문구 전체 | 완료 (남은 47건은 전부 의도된 것 — 아래 참조) |
| AI 답변 언어 | 완료 (`AiChatRequest.locale` → `_ANSWER_LANG`) |
| 백엔드 `schemas/dag.py` | 완료 (파이프라인 검증 문구 전부) |
| 백엔드 `services/sync_service.py` | 완료 (착수 점검 + 예외) |
| 백엔드 `services/pipeline_service.py` | 실행 게이트 래퍼만 (나머지는 미착수) |
| 프론트 → 서버 언어 전달 | 완료 (`client.ts` 의 두 fetch 자리) |

**화면에서 확인되는 것** — EN 으로 바꾼 뒤:
1. 빈 파이프라인 검증 → "There are no nodes"
2. 타깃 없이 실행 → "This pipeline cannot run — …"
3. 동기화 착수 점검 모달 → 항목 이름·설명이 영어

## 검증 방법

`uv` 가 이 머신에 없어 임시 venv 에 넣어 썼다. **전역 환경은 건드리지 않았다.**

```bash
python3 -m venv /tmp/toolvenv && /tmp/toolvenv/bin/pip install uv
cd apps/api && /tmp/toolvenv/bin/uv run --extra dev pytest -q --cov
cd apps/web && npx tsc -b --force && npm run lint && npm test && npm run build
```

**웹 타입체크는 `npx tsc -b --force` 로 한다.** `tsconfig.json` 이 `files: []` +
references 라 `tsc --noEmit` 은 아무것도 검사하지 않고 조용히 통과한다.

로컬 실행은 `.env` 가 있어야 한다(`.env.example` 복사 후 `EAI_LOCAL_SECRET_KEY`·
`EAI_JWT_SECRET` 두 개를 채운다). 이미 만들어 두었고 `EAI_AUTH_ENABLED=false` 다.

```bash
docker compose up -d postgres redis api web    # web :5173 · api :8000
```

## 남은 것

### 1. 백엔드 나머지 서비스 (다음 배치 후보)

사용자에게 가는 한국어가 남은 곳, 건수 순:
`connection_service`(48) · `cdc_service`(22) · `duck_service`(21) · `user_service`(9) ·
`routers/connections`(7) · `routers/auth`·`auth/rbac` 의 `HTTPException` 4곳.

`HTTPException` 4곳은 **아주 싸다** — 발생 시점 번역이라 핸들러가 필요 없다.
`connection_service` 는 `health_message` 를 DB 에 저장하므로 그 자리만 빼야 한다.

### 2. 저장되는 문구 (별건 — 스키마 변경)

`run_logs.message` · `runs.error` · `sync_streams.error` · `stream.config["notes"]` ·
`connections.health_message`. 쓰는 시점과 읽는 시점의 사람이 달라 지금 구조로는
번역이 **틀린다.** code + params 로 저장하고 읽을 때 렌더해야 한다.

### 3. 커넥터 문구 (`apps/connectors/`)

워커와 공유하는 패키지라 2번과 함께 다뤄야 한다. 502 응답은 아직 한국어다.

### 4. 환경 — unixODBC 미설치

`apps/connectors` 의 `test_mssql_mongo.py::TestMsSql` 3건이 이 맥에서 실패한다
(`pyodbc` 가 `libodbc.2.dylib` 을 못 연다). **코드 문제가 아니다** — CI(ubuntu)는
`unixodbc-dev` 를 설치하므로 거기서는 통과한다. 로컬에서 돌리려면 `brew install unixodbc`.

### 5. 일부러 한국어로 남긴 것 (스캔에 잡히지만 정상)

- `canvas/nodeCatalog.tsx` 36건 — category 식별자(**값**이다). 화면은 `CATEGORY_KEY` 로 번역한다.
- `AiFixPanel`·`NotebookAi` 3건 — AI 프롬프트 시드.
- `연합 조회`(DUCK_MARKER_NAME) 2건 — 프로토콜 이름.
- 언어 토글의 `'한'` 2건 — 다른 언어의 이름이라 번역 대상이 아니다.
- `main.tsx`·`api/client.ts` 2건 — 개발자용 콘솔/부팅 오류.
- 백엔드 `logger` 포맷 문자열 전부 — 운영자용 로그.
