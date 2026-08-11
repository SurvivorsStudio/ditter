# STEP 9C · DAG 스펙과 저장

> **상위**: [STEP 9 · 파이프라인 기반](step-09-pipeline-foundation.md)
> **시작 조건**: **DAG 스펙(Pydantic 모델)은 mock으로 선행**. 저장·검증 구현은 [9A](step-09a-write-boundary.md) 이후

## 목표

파이프라인 하나를 **자료구조로 표현하고, 저장하고, 검증**한다. 이 스펙을 백엔드(저장)·
워커(실행)가 읽고, 프런트(캔버스)는 여기서 파생된 타입을 읽는다.

## ⚡ DAG 스펙 자체는 순수 타입이라 먼저 짤 수 있다

[9B](step-09b-connectors.md)와 같은 이유다. 다만 **저장 검증은 9A가 만든 `role`·`adapter_type`을
읽어야** 하므로 그 부분만 9A를 기다린다.

## 하는 일

- 공유 Python 패키지(`packages/dag-spec`)에 **Pydantic v2 DAG 모델 한 벌**
  ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)) — 백엔드·워커가 같은 정의를 import 한다.
  프런트엔드는 백엔드 OpenAPI 스펙에서 생성한 타입을 쓴다
  ([project-structure.md](../conventions/project-structure.md#프런트엔드-백엔드-타입-공유)).
  **복제하면 반드시 어긋난다**
- **파싱 헬퍼가 모델 타입을 인자로 받을 때 `type[BaseModel]`이 아니라 `TypeVar` 바운드로 받는다.**
  전자는 반환 타입이 `BaseModel`로 좁아져 서브클래스 필드 접근이 막히고, DAG 노드마다 필드가
  달라 이 실수가 곧장 타입 체커 무력화로 이어진다 ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)의
  예시)
- **노드 타입 ↔ `adapter_type` 대응표**를 `packages/dag-spec`에서 파생시킨다. 화면과 백엔드가
  각자 매핑을 만들면 어긋난다 — `target.file` ↔ `local_file`처럼 이름이 다른 쌍이 있다
- `note.*`는 **`NOTE_KINDS` 한 상수**에 모으고 위상 정렬·실행·DAG 검증·노드 수 집계에서 일괄
  제외한다. 지점마다 하드코딩하면 하나를 빼먹고, "메모를 붙였더니 검증에 실패한다"가 된다
- `pipelines` · `pipeline_runs` · `pipeline_run_logs` 테이블 ([schema](../schema/README.md)).
  `pipelines.activated_by` · `activated_at`은 `status`를 `active`로 올릴 때 채우고 **CHECK로 강제**한다
- **저장 시 검증 + 실행 직전 재검증** — 커넥션 `role`, `adapter_type` 일치, 소스 쿼리 AST
  ([1B](step-01b-readonly-validator.md)의 검증기를 **그대로** 쓴다). 저장 이후 커넥션의 역할이나
  종류가 바뀌었을 수 있으므로 두 번 한다

## 완료 조건

1. `packages/dag-spec`의 Pydantic 정의 **한 벌**로 백엔드·워커가 같은 DAG를 파싱하고, 프런트는
   거기서 생성된 타입을 쓴다.
2. 타깃 노드에 `role='source'` 커넥션을 붙인 정의가 **저장 거부**된다.
3. `source.postgres` 노드에 `http_json` 커넥션을 붙인 정의가 **저장 거부**된다.
4. 소스 `query`에 `WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`를 넣으면
   **저장 단계에서 거부**된다.
5. `note.memo`·`note.group`을 붙여도 검증이 실패하지 않고, 노드 수 집계에도 잡히지 않는다.
6. `status='active'`인데 `activated_by`가 빈 행을 만들 수 없다.

**2·3·4는 회귀 테스트로 고정한다.**

## 관련 문서

- [dag-and-nodes.md](../pipeline/dag-and-nodes.md) — 노드 종류·검증 규칙의 **유일한** 목록
- [pipelines](../schema/pipelines.md) · [pipeline_runs](../schema/pipeline-runs.md)
