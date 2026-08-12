# STEP 9B · 커넥터 패키지

> **상위**: [STEP 9 · 파이프라인 기반](step-09-pipeline-foundation.md)
> **시작 조건**: **없음 — mock으로 선행한다** (실제 접속 연결은 [1A](step-01a-connection-registry.md) 이후)

## 목표

`Connector` 계약을 고정하고 커넥터 4종을 구현한다. **신규 저장소 지원이 "구현체 하나 추가"가
되려면 계약이 먼저 굳어야 한다.**

## ⚡ 이 문서는 STEP 1·8을 기다리지 않는다

`Connector` 인터페이스와 `ReadSpec`은 **순수 타입**이고, 커넥터 구현은 백엔드도 Celery도 모르는
**순수 라이브러리**다. [todo README](README.md)의 「지금 당장 착수할 것」 6번이 가리키는 것이
이 문서다 — **이게 늦으면 STEP 9~11이 통째로 밀린다.**

## 하는 일

- `packages/pipeline-connectors` 패키지 + `Connector` 프로토콜(Python `Protocol`)
  ([connector-contract.md](../pipeline/connector-contract.md))
- 레지스트리 + **`importlib.import_module()` 지연 로딩** — 레지스트리를 import 했다고 AWS SDK가
  같이 올라오면 안 된다
- 커넥터 4종: `postgres`(소스·타깃) · `s3` · `local_file` · `http_json`
- **`read`는 반드시 `AsyncIterator`다.** 리스트를 반환하면 계약 위반이고, 실행 엔진의 스트리밍
  설계가 통째로 무력화된다
- **소스 커넥터는 자체 접속을 열지 않는다.** [1A](step-01a-connection-registry.md)의 DB 어댑터를
  경유한다 — 읽기 전용 강제·`statement_timeout`·풀 상한이 전부 거기 붙어 있다. 단 콘솔용
  `max_rows`는 이 경로에 걸지 않고 **배치 크기 상한**으로 대체한다
  ([P9 규칙 8](../policy/pipeline-write-boundary.md))
- `write`는 `append` · `upsert` · `overwrite` **세 가지뿐**이다. 식별자는 화이트리스트 검증 후
  인용(quote)하고, 값은 전부 파라미터 바인딩 (P9 규칙 3)
- **`close()`는 실패 경로에서도 반드시 호출된다.** 접속 풀이 새면 프로덕션 DB의 커넥션 상한을 갉아먹는다
- 시크릿 키 목록에 커넥터별 키를 추가 ([credential-management.md](../policy/credential-management.md))

## 완료 조건

[connector-contract.md](../pipeline/connector-contract.md)의 테스트 요건을 만족한다.

1. 각 커넥터의 `read`가 배치를 **여러 번 yield** 한다 (한 번에 다 주면 스트리밍이 아니다).
2. `write`의 `upsert`·`overwrite`가 **멱등**하다 — 같은 배치를 두 번 써도 결과가 같다.
3. 소스 커넥터가 **DML이 담긴 `ReadSpec`을 거부**한다 (회귀 테스트로 고정).
4. 실패 시 `close()`가 호출된다.
5. 레지스트리를 import 해도 **쓰지 않는 커넥터의 드라이버가 로드되지 않는다.**

## 관련 문서

- [connector-contract.md](../pipeline/connector-contract.md) — 계약 전문
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 3·8
