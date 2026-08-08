# STEP 9D · 실행 엔진과 워커

> **상위**: [STEP 9 · 파이프라인 기반](step-09-pipeline-foundation.md)
> **시작 조건**: [9A](step-09a-write-boundary.md) + [9B](step-09b-connectors.md) + [9C](step-09c-dag-spec.md)

## 목표

**화면 없이** 파이프라인 한 개를 실제로 돌린다. STEP 9의 완료 조건이 실제로 확인되는 곳이다.

**타깃에 처음으로 쓰는 코드다.** [9A](step-09a-write-boundary.md)가 끝나기 전에 시작하지 않는다.

## 하는 일

- Redis + BullMQ 배선. **백엔드는 워커 코드를 import 하지 않는다** — 잡 이름(`pipeline.execute`)과
  페이로드만 큐에 넣는다 ([project-structure.md](../conventions/project-structure.md))
- `worker/` 워크스페이스를 만들고 **루트 `package.json`의 `workspaces`에 등록**한다
- **타깃 주도 pull 스트리밍 엔진** ([execution-engine.md](../pipeline/execution-engine.md)) — 타깃이
  배치를 당겨오게 한다. 소스가 밀어내면 타깃이 느릴 때 중간 결과가 메모리에 쌓인다
- 노드 구현: extract · transform(filter/map) · load
- **워커는 큐 페이로드를 그대로 믿지 않고 DAG를 다시 파싱한다.** 큐에 들어간 시점과 실행 시점
  사이에 정의가 바뀌었을 수 있다
- `overwrite` 규칙 — **DB는 첫 배치에서만** truncate(배치마다 비우면 마지막 배치만 남는다),
  S3·파일은 `run_id=` prefix 선정리
- **같은 파이프라인 동시 실행 잠금** (Redis, TTL + 갱신) — 수동·스케줄·재시도 **모든 진입 경로**가
  같은 잠금을 통과한다. 잠겨 있으면 큐에 넣지 않고 즉시 거절한다
- 파이프라인 실행의 **소스 읽기(run 단위 한 건)·타깃 쓰기(타깃마다 한 건)를 감사 로그에 기록** —
  `audit_logs`의 `pipeline_*` · `write_*` 컬럼 ([audit-logs.md](../schema/audit-logs.md))
- 진행률은 Redis에, **노드 상태가 바뀔 때만** SQLite에. SQLite는 WAL + `busy_timeout`

## 완료 조건

CLI나 API 호출만으로 다음이 된다. **이것이 STEP 9 전체의 완료 조건이다.**

1. `role='source'` 커넥션에서 테이블 하나를 읽어 `role='target'` 커넥션에 `upsert`로 적재한다.
2. 같은 실행을 두 번 돌려도 타깃 결과가 같다 (멱등).
3. 같은 파이프라인을 동시에 두 번 트리거하면 **두 번째가 거절된다.**
4. 실행 결과가 `pipeline_runs`에 남고, 소스 읽기·타깃 쓰기가 **감사 로그에 남는다.**
5. 실행 중 워커를 죽였다가 다시 띄워도 잠금이 풀린다.

**3은 회귀 테스트로 고정한다.**

## 리뷰 게이트

🔒 **2인 리뷰 필수** — 타깃에 실제로 문장을 내보내는 코드다. 커넥터가 만든 세 가지 외의 문장이
나가지 않는지, 감사 로그가 빠지지 않는지를 본다.

## 관련 문서

- [execution-engine.md](../pipeline/execution-engine.md) — 실행 규칙 전문
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 7 (감사 로그)
