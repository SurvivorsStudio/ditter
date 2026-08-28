# 기여 안내

ditter 에 관심을 가져 주어 고맙다. 이 문서는 **어디를 먼저 읽고, 무엇을 지키면 되는지**만
짧게 정리한다. 자세한 내용은 각 항목이 가리키는 문서가 단일 출처(SSOT)다.

## 먼저 읽을 것

| 궁금한 것 | 문서 |
|---|---|
| 이 프로젝트가 무엇인가 · 어떻게 띄우나 | [README.md](README.md) |
| 왜 그렇게 만들었나 (설계 결정과 그 근거) | [CLAUDE.md](CLAUDE.md) |
| 커밋·브랜치·머지 규칙 | [docs/conventions/commit-convention.md](docs/conventions/commit-convention.md) |
| 취약점을 발견했을 때 | [SECURITY.md](SECURITY.md) |
| 직접 굴려 보고 싶을 때 | [demo/README.md](demo/README.md) |

**`CLAUDE.md` 를 권한다.** 도구용 이름이 붙어 있지만 실제로는 이 저장소에서 가장 두꺼운 설계
문서다. 각 절 끝에 **「여기서 하지 않은 것」** 이 있고 *왜* 하지 않았는지가 적혀 있다 — 기여를
시작하기 전에 그 절을 보면 이미 검토된 길인지 알 수 있다.

## 개발 환경

```bash
cp .env.example .env    # 필수 값 2개를 채운다 (파일 안에 생성 명령이 있다)
docker compose up -d --build
```

호스트에서 직접 돌리는 방법과 첫 관리자 계정 만들기는 [README 「빠른 시작」](README.md#빠른-시작)에 있다.

> `.env.example` 은 **docker compose 가 읽는다.** `cd apps/api && uvicorn ...` 처럼 호스트에서
> 직접 돌릴 때는 그 파일을 읽지 않는다(pydantic 은 프로세스의 현재 디렉터리에서 `.env` 를 찾는다).

## 무엇부터 손대면 좋은가

- [`good first issue`](https://github.com/SurvivorsStudio/ditter/labels/good%20first%20issue)
  라벨이 붙은 이슈
- 새 **커넥터** 추가 — `BaseConnector` 계약만 구현하면 되고, 기존 구현체가 좋은 본보기다
  (`apps/connectors/src/eai_connectors/`)
- 문서 오류·부정확한 설명. 작아 보여도 실제로 도움이 된다

## 작업 흐름

1. **이슈를 먼저 연다.** 큰 변경은 방향부터 맞추는 편이 서로 시간을 아낀다.
2. `main` 에서 브랜치를 딴다. prefix 는 **`feature/`·`fix/`·`bug/`** 만 쓴다.
3. 커밋을 **영역별로 나눈다.** 한 커밋에는 한 영역만 담는다.

   | 영역 | 경로 |
   |---|---|
   | api | `apps/api/` |
   | web | `apps/web/` |
   | worker | `apps/worker/` |
   | connectors | `apps/connectors/` (공유 라이브러리) |
   | sap-connector | `apps/sap-connector/` |
   | cdc · sync | `cdc/` · `sync/` |
   | docs | `docs/` · `README.md` · `CLAUDE.md` |

   `apps/connectors/` 계약을 바꾸면서 소비 측(`api`·`worker`)도 고쳤다면
   **커넥터 커밋을 먼저** 올린다.
4. 바꾼 영역의 테스트와 린트를 돌린다(아래).
5. PR 을 연다. 템플릿의 체크리스트를 채운다.

커밋 메시지는 Conventional Commits 다 — `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문.
타입은 `fix` `feat` `docs` `build` `refactor` `test` `chore` 만 쓴다.
**본문에는 무엇이 아니라 왜를 적는다.** 무엇은 diff 가 말해 준다.

## 테스트 · 린트

바꾼 영역만 돌리면 된다. `<영역>` 은 `connectors`·`api`·`worker`·`sap-connector`.

```bash
cd apps/<영역> && uv run --extra dev pytest -q && uv run --extra dev ruff check .
```

```bash
cd apps/web && npm test && npm run lint && npm run build
```

CI 가 PR 마다 위 전부를 강제한다. **mypy 는 아직 게이트가 아니다**(`src` 기준 잔여가 있다) —
현황은 [README 「테스트·품질」](README.md#테스트--품질)의 표에 있다.

> macOS 에서 MSSQL 커넥터 테스트가 `libodbc` 를 못 찾아 실패하면 `brew install unixodbc`.

## 코드 규칙

- **Python** — ruff(포맷+린트), 타입힌트 필수. 예외는 도메인 예외로 감싼다.
- **TypeScript** — eslint + prettier, `any` 금지, API 응답은 zod 로 검증.
- **새 커넥터·새 노드에는 단위 테스트를 함께 넣는다.**
- **시크릿·자격증명은 코드·로그·테스트 픽스처 어디에도 남기지 않는다.**
- **임포트는 싸게 유지한다.** 모듈 최상위에서 무거운 초기화를 하면 Celery 워커가 fork 할 때
  드러난다 (`CLAUDE.md` §15 에 실제로 겪은 사례가 있다).

### 한쪽만 고치면 어긋나는 것들

프런트와 백엔드에 **같은 상수가 복제**되어 있는 자리가 있다. 의도된 중복이지만 한쪽만 고치면
화면에는 보이는데 서버가 거부한다.

| 상수 | 백엔드 | 프런트 |
|---|---|---|
| 허용 SQL 명령 | `services/connection_service.py` | `api/statements.ts` |
| 연합 조회 지원 타입 | `services/duck_service.py` | `canvas/duckRefs.ts` |
| 동기화 채널·용도 | `schemas/dag.py` | `api/types.ts` |
| 역할 계층 | `auth/rbac.py` 의 `_IMPLIES` | `api/auth.ts` 의 `can()` |
| 변수 치환 문법 | `schemas/variables.py` | `canvas/variables.ts` |

마지막 항목은 **양쪽 테스트에 같은 사례를 넣어 함께 깨지도록** 되어 있다. 문법을 건드리면
그 관행을 유지해 달라.

## 도움이 필요하면

- 사용법·설계 질문 → [이슈](https://github.com/SurvivorsStudio/ditter/issues/new/choose)를 연다
- 보안 문제 → 공개 이슈로 올리지 말고 [SECURITY.md](SECURITY.md) 를 따른다

기여자는 [행동 강령](CODE_OF_CONDUCT.md)을 지킬 것으로 기대한다.
