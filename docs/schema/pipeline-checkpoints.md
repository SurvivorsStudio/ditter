# pipeline_checkpoints

증분 적재의 워터마크. **"지난번에 어디까지 읽었나"** 하나를 저장한다.
[STEP 11 파이프라인 운영](../todo/step-11-pipeline-operations.md)에서 만든다.

작은 테이블이지만 **잘못 다루면 데이터가 조용히 유실되는** 유일한 테이블이다. 규칙은
[execution-engine.md](../pipeline/execution-engine.md)의 워터마크 절에 있다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `pipeline_id` | INTEGER | NOT NULL, FK → `pipelines.id` | |
| `node_id` | TEXT | NOT NULL | 소스 노드 ID. 소스가 여럿이면 워터마크도 여럿이다 |
| `state` | TEXT (JSON) | NOT NULL | 워터마크 값 — **타입 태그 포함** (아래 참고) |
| `updated_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | 마지막 전진 시각 |

- UNIQUE `(pipeline_id, node_id)` — 소스 노드마다 하나씩.

## `state`에 타입 태그를 붙인다

```json
{ "column": "updated_at", "type": "timestamptz", "value": "2026-08-06T01:23:45.678Z" }
```

JSON에는 timestamp도 Decimal도 없다. 값만 저장하면 다음 실행에서 문자열로 되살아나
`updated_at > '2026-08-06...'` 비교가 **조용히** 어긋난다. 에러가 나면 차라리 낫다 — 이 실패는
아무 소리 없이 잘못된 행 집합을 가져온다.

`type`은 CDC 오프셋을 넣게 될 자리이기도 하다. 지금은 워터마크만 쓴다.

## 전진 규칙 (하드 룰)

> **모든 타깃이 성공한 뒤에만 전진한다.**

타깃 하나라도 실패하면 워터마크는 **그대로 둔다.** 미리 올리면 실패한 구간을 다음 실행이 건너뛰고,
그 구간은 **재실행해도 복구되지 않는다.**

- 전진은 run 종료 시점에 **한 번**, 단일 트랜잭션으로 한다. 배치마다 갱신하지 않는다.
- `full_refresh` 실행이 성공하면 이번 실행의 최대값으로 갱신한다 (초기화가 아니다).
- 워터마크를 화면에서 **볼 수 있어야 하고, 관리자가 수동으로 되돌릴 수 있어야 한다.** 되돌리기가
  없으면 "며칠치를 다시 적재해야 한다"에 대응할 방법이 DB를 직접 여는 것밖에 없다.
- 수동 변경은 감사 로그에 남긴다.

## 관계

- `pipeline_id` → [pipelines](pipelines.md)`.id`

## 비고

- 파이프라인 정의에서 소스 노드가 삭제되면 해당 체크포인트도 정리한다. 노드 ID가 재사용되면
  엉뚱한 워터마크를 물려받는다.
- 소스 노드의 워터마크 컬럼을 바꾸면 **체크포인트를 초기화해야 한다.** `id` 기준으로 쌓인 값을
  `updated_at` 비교에 그대로 쓰면 비교가 성립하지 않는다. 컬럼 변경 시 화면에서 경고한다.
