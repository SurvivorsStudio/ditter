# 커넥터 계약

파이프라인 확장의 핵심이다. **신규 저장소 지원은 구현체 하나를 추가하는 일**이어야 하고, 그러려면
계약이 먼저 고정돼야 한다.

## 인터페이스

```py
# packages/pipeline_connectors/types.py

from typing import AsyncIterator, Literal, Protocol
from pydantic import BaseModel

ConnectorType = Literal["postgres", "s3", "local_file", "http_json"]
WriteMode = Literal["append", "upsert", "overwrite"]


class RecordBatch(BaseModel):
    """커넥터가 주고받는 유일한 데이터 단위. 배치 = 레코드 배열 + 소속 정보"""
    rows: list[dict[str, object]]
    schema_: TableSchema | None = None
    # 이 배치까지 읽은 워터마크 값. 소스가 채우고 엔진이 커밋 시점에 사용한다
    watermark: WatermarkValue | None = None


class TableReadSpec(BaseModel):
    kind: Literal["table"] = "table"
    table: str
    params: dict[str, object] = {}


class QueryReadSpec(BaseModel):
    kind: Literal["query"] = "query"
    query: str
    params: dict[str, object] = {}


class FunctionReadSpec(BaseModel):
    kind: Literal["function"] = "function"
    fn: str
    params: dict[str, object] = {}


# 소스를 지정하는 방법은 셋 중 하나다 (서로 배타적, discriminated union)
ReadSpec = TableReadSpec | QueryReadSpec | FunctionReadSpec


class Connector(Protocol):
    type: ConnectorType

    async def test_connection(self) -> HealthResult: ...
    async def discover_schema(self, table: str | None = None) -> list[TableSchema]: ...

    def read(self, spec: ReadSpec) -> AsyncIterator[RecordBatch]:
        """소스: 비동기 제너레이터로 스트리밍한다. 전량을 메모리에 올리지 않는다"""
        ...

    async def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        """타깃: 배치 단위 쓰기"""
        ...

    async def close(self) -> None: ...
```

### 계약이 강제하는 것

- **`read`는 반드시 `AsyncIterator`다.** 리스트를 반환하는 커넥터는 계약 위반이다. 전량 로드는
  실행 엔진의 스트리밍 설계([execution-engine.md](execution-engine.md))를 통째로 무력화한다.
- **`function`은 MVP에서 쓰지 않는다.** SAP BAPI 같은 "테이블도 쿼리도 아닌 소스" 자리로 미리
  열어둔 것이다. 나중에 추가하면 `ReadSpec`을 union에 끼워 넣느라 모든 커넥터를 건드리게 된다.
- **커넥터별 옵션은 `params`로만 전달한다.** 인터페이스에 커넥터 전용 인자를 추가하지 않는다.
  하나 추가하는 순간 나머지 커넥터 전부가 그 인자를 무시해야 하는 관계가 된다.
- **`close()`는 항상 호출된다.** 실행이 실패해도 `finally`에서 부른다. 접속 풀이 새면 프로덕션
  DB의 커넥션 상한을 갉아먹는다 ([query-safety-limits.md](../policy/query-safety-limits.md)).

## 소스 커넥터는 읽기 전용 어댑터 위에 얹는다

`postgres` 소스 커넥터는 **자체 접속을 만들지 않는다.** [STEP 1](../todo/step-01-db-connection.md)에서
만든 DB 어댑터 인터페이스를 그대로 쓴다. 이유는 하나다 — 읽기 전용 강제, `statement_timeout`,
풀 상한이 전부 그 어댑터에 붙어 있기 때문이다. 파이프라인이 자체 접속을 열면 그 방어가 전부
우회된다.

단 하나 예외가 있다. 어댑터가 콘솔용으로 거는 **`max_rows`(응답 행 수 상한)는 이 경로에 걸지
않는다** — 스트리밍에는 "응답"이라는 단위가 없고, 걸면 대량 적재가 조용히 잘린다. 그 자리를
대신하는 것은 **한 배치의 크기 상한**이다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)
규칙 8, [connections](../schema/connections.md)의 `max_rows`).

`ReadSpec`이 `kind: 'query'`인 경우 **콘솔과 동일한 AST 검증기를 통과해야 한다.** 파이프라인
소스라고 예외를 두지 않는다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)).

## 레지스트리와 지연 로딩

```py
# packages/pipeline_connectors/registry.py

import importlib
from typing import Callable

_MODULE_PATHS: dict[ConnectorType, str] = {
    "postgres":   "pipeline_connectors.postgres",
    "s3":         "pipeline_connectors.s3",
    "local_file": "pipeline_connectors.local_file",
    "http_json":  "pipeline_connectors.http_json",
}


def build(type_: ConnectorType, config: "ConnectorConfig") -> Connector:
    path = _MODULE_PATHS.get(type_)
    if path is None:
        raise UnknownConnectorError(type_)
    module = importlib.import_module(path)  # 여기서 처음 로드된다
    factory: Callable[["ConnectorConfig"], Connector] = module.factory
    return factory(config)
```

**드라이버는 `importlib.import_module()`로 지연 로딩한다.** 레지스트리를 import 했다고 해서
`boto3`가 같이 올라오면 안 된다.

원본 청사진이 이 규칙을 둔 이유는 그대로 유효하다 — **Celery의 `fork()` 안정성**이다. 워커
프로세스가 `fork()`로 자식을 띄울 때, 무거운 드라이버(특히 네이티브 확장을 물고 있는 것)가 이미
import돼 있으면 자식 프로세스로 그 상태가 통째로 복제되며 드물게 데드락·커넥션 핸들 오염을
일으킨다. 지연 로딩하면 실제로 그 커넥터를 쓰는 태스크가 실행될 때만, 그 워커 프로세스에서만
로드된다.

추가 이유(스택이 TypeScript였을 때도 유효했던 것들):

- 백엔드는 커넥터 목록만 알면 되고 드라이버는 필요 없다 — 기동 시간과 메모리를 낭비할 이유가 없다.
- 평가되는 모듈이 적을수록 공급망 노출면이 좁다 ([supply-chain-security.md](../policy/supply-chain-security.md)).
- 특정 커넥터를 안 쓰는 배포에서 그 드라이버를 optional dependency(uv의 extras)로 뺄 수 있다.

## 신규 커넥터 추가 절차

네 군데를 **동시에** 건드려야 한다. 하나라도 빠지면 화면에는 보이는데 저장이 안 되거나, 저장은
되는데 필드가 안 보인다.

| # | 위치 | 하는 일 |
|---|---|---|
| 1 | `packages/pipeline_connectors/<name>.py` | `Connector` 구현 + 팩토리 export |
| 2 | `registry.py`의 `_MODULE_PATHS` | 지연 로더 등록 |
| 3 | 백엔드 config 모델 (Pydantic) | 이 커넥터가 받는 config 키를 필드로 선언 — 이게 화이트리스트다 (`extra="forbid"`) |
| 4 | 프런트 `connectorFields.ts` | 설정 패널에 그릴 필드 선언 |

**3번과 4번은 반드시 짝이다.** 프런트에 필드를 추가하고 백엔드 모델을 안 고치면 값이 조용히
버려진다. 언어가 갈려 **한 곳에서 파생**시킬 수는 없으므로(TS ↔ Python), 대신:

- 백엔드가 `GET /connector-types/{type}` 같은 엔드포인트로 **커넥터별 config 필드 목록을
  런타임에 노출**한다(Pydantic 모델의 JSON Schema).
- 프런트의 `connectorFields.ts`는 그 스키마의 키 집합과 **테스트에서 대조**한다 — 한쪽에만 필드가
  있으면 그 테스트가 실패한다. "필드 선언을 한 곳에서 파생시킨다"는 원칙을 "선언은 따로 두되
  어긋나면 테스트가 잡는다"로 바꾼 것이다.

## 시크릿 취급

커넥터 config 중 다음 키는 **저장 시 자동으로 분리 암호화**하고, API 응답에 **절대 포함하지
않는다.**

```
password · secretAccessKey · sessionToken · privateKey · passphrase · apiToken
```

- 암호화 메커니즘은 새로 만들지 않는다. [자격증명 관리(P4)](../policy/credential-management.md)의
  기존 방식을 그대로 쓴다.
- 응답 직렬화에서 제외하는 것에 그치지 않고, **키 목록을 한 곳에 두고 직렬화 계층에서 강제**한다.
  새 커넥터가 새 시크릿 키를 들고 오면 그 목록에 추가하는 것이 체크리스트에 포함된다.
- 로그·에러 메시지에도 나가지 않아야 한다. 커넥터가 던지는 에러에 config를 통째로 붙이지 않는다.

## 테스트 요건

- 각 커넥터는 **`read`가 배치를 여러 번 yield 하는지** 검증한다(한 번에 다 주면 스트리밍이 아니다).
- `write`의 세 모드가 **멱등한지** 검증한다 — 같은 배치를 두 번 써도 결과가 같아야 한다
  (`append` 제외).
- 소스 커넥터는 **DML이 담긴 `ReadSpec`을 거부하는지** 검증한다. 이건 회귀 테스트로 고정한다
  ([testing.md](../conventions/testing.md)).
- 실패 시 `close()`가 호출되는지 검증한다.

## 관련

- [execution-engine.md](execution-engine.md) — 이 계약을 소비하는 쪽
- [read-only-enforcement.md](../policy/read-only-enforcement.md) — 소스 읽기에 적용되는 방어
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) — `write`가 허용되는 범위
- 담당 STEP: [9B 커넥터 패키지](../todo/step-09b-connectors.md)
