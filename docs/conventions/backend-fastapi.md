# 백엔드 (FastAPI) 컨벤션

## 요청 스키마 검증

- 모든 라우트에 **Pydantic v2 모델**로 요청/응답 스키마를 명시하고, 기본을 `model_config = ConfigDict(extra="forbid")`로 둔다 — 스키마에 없는 필드가 섞여 들어오면 그 자리에서 거부한다.
- 경로/쿼리 파라미터도 FastAPI의 타입 힌트 기반 검증에 맡기고, 핸들러 안에서 손으로 다시 파싱하지 않는다.

## 입력을 그대로 객체에 병합하지 않는다 (S8의 Python 대응)

Node/Fastify 세계의 prototype pollution은 Python에는 그대로 존재하지 않는다(`__proto__` 체인이
없다). 하지만 **같은 계열의 실수**는 그대로 옮겨온다 — 검증되지 않은 딕셔너리를 객체 생성자에
그대로 흘려보내는 것.

- 외부 입력(JSON body)을 SQLAlchemy 모델이나 내부 객체에 `Model(**request_dict)` 식으로 통째로
  풀어넣지 않는다. **먼저 Pydantic 모델로 검증**하고, 그 모델이 허용한 필드만 명시적으로
  옮긴다.
- `model_validate()`에 `strict=True`를 기본으로 고려한다. 느슨한 타입 강제(문자열 `"123"` →
  정수 123 등)가 필요한 경계는 어디인지 의식적으로 결정한다.
- 커넥터 config처럼 **커넥터 종류마다 허용 키가 달라지는 자유 형식 딕셔너리**(파이프라인,
  [connector-contract.md](../pipeline/connector-contract.md))는 특히 주의한다. 화이트리스트
  없이 그대로 저장하거나 그대로 하위 커넥터 생성자에 넘기지 않는다.

## 내부 쿼리 작성 원칙 (P1)

- 백엔드 라우트/서비스가 직접 짜는 카탈로그 조회 쿼리(`information_schema`, `pg_catalog` 등)는
  SQLAlchemy Core의 파라미터 바인딩(`text(...).bindparams(...)` 또는 쿼리 빌더)을 강제하고,
  f-string·`%` 포맷팅으로 SQL을 조립하지 않는다.
- 이 원칙과 사용자가 직접 입력하는 SQL(P2)의 구분은 [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) 참고.

## 서비스 계층 분리

- 순수 비즈니스 로직(컨텍스트 빌더, AST 검증, 위험 판정 규칙)은 라우트 핸들러 안에 직접 짜지 않는다. **FastAPI를 import하지 않는 순수 함수/모듈**로 분리하고, 라우트 핸들러는 이를 호출만 한다 (`Depends`도 이 계층에는 두지 않는다 — 순수 함수는 인자를 직접 받는다). ([project-structure.md](project-structure.md) 참고)
- 이렇게 분리해야 ASGI 앱을 띄우지 않고도(`TestClient` 없이) 유닛 테스트가 가능하고, mock 데이터로 병렬 개발이 가능하다.

## 비동기 경계

- DB I/O(psycopg3, SQLAlchemy 비동기 세션)와 외부 API 호출(AI 모델)은 `async def` 핸들러 아래에서 일관되게 `await`한다. 동기 드라이버를 async 핸들러 안에서 그대로 부르면 이벤트 루프를 막는다 — 불가피하면 `run_in_threadpool`로 명시적으로 뺀다.
- 파이프라인 커넥터의 `read()`도 같은 이유로 **비동기 제너레이터**(`AsyncIterator`)로 정의한다 ([connector-contract.md](../pipeline/connector-contract.md)).

## 관련

- 담당 STEP: [1A](../todo/step-01a-connection-registry.md)(첫 라우트 · 스키마 검증 · P1), [step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md)(서비스 계층 분리)
- [../policy/supply-chain-security.md](../policy/supply-chain-security.md)
