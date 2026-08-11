# Python 스타일 (백엔드·워커)

**백엔드**(FastAPI)와 **워커**(Celery)는 Python으로 개발한다. 프런트엔드는 TypeScript이므로 이
문서의 대상이 아니다 — 그쪽은 [typescript-style.md](typescript-style.md) 참고.

## 툴체인

TypeScript 쪽의 tsc/ESLint/Prettier/npm에 대응하는 도구를 고정해 둔다. 도구가 여러 개로 늘면
"어느 걸 믿어야 하나"가 갈린다.

| 역할 | 도구 | TS 쪽 대응 |
|---|---|---|
| 패키지·가상환경·lockfile | **uv** | npm + `package-lock.json` |
| 린트·포맷 | **ruff** | ESLint + Prettier |
| 타입 검사 | **mypy** (`strict = true`) | `tsc --strict` |
| 테스트 | **pytest** | Vitest |

`uv.lock`은 커밋 대상이다 — [supply-chain-security.md](../policy/supply-chain-security.md)의
lockfile 고정 원칙(S2)이 언어를 가리지 않는다.

## 기본 원칙

- **타입 힌트를 전부 채우고 `mypy --strict`를 CI 게이트로 강제한다.** `Any`를 쓰지 않는다 — 타입을 모르면 `object`로 받고 좁혀서 쓴다.
- **외부 경계를 넘는 데이터는 전부 Pydantic v2 모델로 검증한다** — API 요청/응답, 큐 페이로드, DAG 스펙, 커넥터 config. 검증되지 않은 `dict[str, Any]`를 내부 함수로 넘기지 않는다.
- **DAG 스펙은 `packages/`의 공유 Python 패키지에 Pydantic v2 모델로 한 벌만 둔다.** 백엔드·워커가 같은 정의를 import한다. 정의를 복제하면 반드시 어긋난다 ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)).
- 워커는 큐에서 꺼낸 페이로드를 그대로 믿지 않고 **`model_validate()`로 다시 검증한다.** 백엔드가 검증했더라도, enqueue 시점과 실행 시점 사이에 스펙 버전이 달라질 수 있다.

## 명명

- 파일·모듈명: snake_case (`query_risk_detector.py`)
- 클래스: PascalCase
- 함수·변수: snake_case
- DB 관련 개념은 PostgreSQL 용어를 그대로 쓴다 (예: `explain_plan`, `seq_scan`, `statement_timeout`) — 자체 용어로 재작명해서 문서와 코드 사이 용어가 갈리지 않게 한다.
- API 응답 JSON은 **`camelCase`로 직렬화한다** (Pydantic의 `alias_generator=to_camel` + `populate_by_name=True`). 프런트가 TypeScript 관례를 그대로 쓸 수 있게, snake_case↔camelCase 변환을 프런트 쪽에 떠넘기지 않는다.

## 에러 처리

- 발생할 수 없는 상황에 대한 방어 코드를 넣지 않는다. 시스템 경계(사용자 입력, DB 응답, AI 응답, 외부 API, 큐 페이로드)에서만 검증한다.
- **`except Exception: pass`로 실패를 삼키지 않는다.** 특히 [read-only-enforcement.md](../policy/read-only-enforcement.md)의 AST 검증, [ai-context-and-safety.md](../policy/ai-context-and-safety.md)의 AI 출력 검증처럼 보안·안전과 직결된 검증은 실패 시 명확한 실패 경로(차단, 원본 반환)를 타야 하며 조용히 통과시키면 안 된다.
- 예외는 구체적인 타입으로 잡는다. `except Exception`으로 뭉뚱그리면 재시도해도 소용없는 에러(인증 실패, 권한 없음)와 재시도할 만한 에러(일시적 네트워크 오류)가 같은 경로를 탄다 — 이 구분이 실제로 중요한 지점은 [execution-engine.md](../pipeline/execution-engine.md)의 재시도 정책이다.

## 동기/비동기 경계

- I/O 바운드 코드(DB 쿼리, 외부 API 호출)는 `async def`로 일관되게 작성한다. 동기 라이브러리를 async 함수 안에서 그대로 호출해 이벤트 루프를 막지 않는다.
- Celery 태스크 자체는 동기 함수다 — 태스크 내부에서 비동기 코드를 돌려야 하면 `asyncio.run()`으로 경계를 명시적으로 긋는다. 태스크 함수 시그니처를 async로 만들지 않는다(Celery가 기본 지원하지 않는다).

## 관련

- [typescript-style.md](typescript-style.md) — 프런트엔드 컨벤션
- [backend-fastapi.md](backend-fastapi.md)
- [project-structure.md](project-structure.md)
