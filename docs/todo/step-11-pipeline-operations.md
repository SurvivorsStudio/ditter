# STEP 11 · 파이프라인 운영

**시작 조건**: STEP 10

> **F7 데모 범위 결정 (2026-08-12)**: 라이브 데모 시연에는 이 STEP을 넣지 않는다(캔버스 구성
> + 1회 실행까지만 시연). 다만 STEP 12·13의 시작 조건에는 여전히 걸려 있으므로 **제출 전에는
> 완료해야 한다** — 우선순위를 낮출 뿐 범위에서 빼는 게 아니다. ([todo README](README.md#팀이-먼저-결정해야-할-것))

## 목표

파이프라인을 **한 번 돌리는 것**에서 **계속 돌아가게 두는 것**으로 옮긴다. 스케줄, 증분 적재,
재시작이 여기서 붙는다.

이 STEP이 없으면 F7은 "수동으로 한 번 옮기는 기능"에 그친다. **증분 적재가 없으면 프로덕션에 못
붙인다** — 매 실행이 풀스캔이 되기 때문이다.

## 하는 일

### 스케줄

- Celery Beat로 cron 스케줄 실행 ([deployment.md](../pipeline/deployment.md))
- `pipelines.timezone` 기준으로 cron 해석 — **서머타임에 실행이 밀리거나 겹치지 않게**
- 스케줄 변경 시 **기존 반복 잡을 제거한 뒤 재등록** (유령 스케줄 방지)
- `status='active'`인 파이프라인만 스케줄 대상

### 증분 적재 (워터마크)

- `pipeline_checkpoints` 테이블 ([schema](../schema/pipeline-checkpoints.md))
- **타입 태그를 포함해** 저장 — 값만 저장하면 다음 비교가 조용히 어긋난다
- **모든 타깃이 성공한 뒤에만 전진.** run 종료 시점에 한 번, 단일 트랜잭션
- `full_refresh` 실행 — 워터마크 무시하고 전량, 성공 시 최대값으로 갱신
- 워터마크를 **화면에서 보고, 관리자가 수동으로 되돌릴 수 있게** 한다 (감사 로그에 기록)

### 재시작과 재시도

- 노드 단위 재시도 + 지수 백오프
- **재시도해도 소용없는 에러는 즉시 실패** — 인증 실패, 없는 테이블, 권한 없음
- 체크포인트 기준 재시작 (`trigger='retry'`인 새 run)
- 실행 취소

### 팬아웃 스풀

- 분기 지점에서 JSONL 스풀로 받아 **소스를 정확히 한 번만** 읽는다
- 타깃은 순차 실행
- 스풀 파일은 run 종료 시 성공·실패 무관하게 정리
- 스풀 경로는 `PIPELINE_SPOOL_DIR` 하위로 격리, 파일명에 사용자 입력을 섞지 않는다

### 운영 배선

- `redis` · `worker` 컨테이너를 `docker-compose.yml`에 추가
- `WORKER_CONCURRENCY` **명시** + 컨테이너 mem/CPU limit
- **graceful shutdown** — `SIGTERM`에 진행 중 배치를 끝내고 잠금을 반납한 뒤 종료
- SQLite WAL 모드 + `busy_timeout` 확인
- `PIPELINE_FILE_ROOT` 경로 격리 검사 (정규화 후 루트 하위 확인, 심볼릭 링크 포함)

## 완료 조건

1. cron 스케줄로 파이프라인이 **사람 손 없이** 반복 실행된다.
2. 증분 적재가 동작한다 — 두 번째 실행이 **새 행만** 가져온다.
3. 타깃 하나를 일부러 실패시키면 **워터마크가 전진하지 않는다.** 고친 뒤 재실행하면 실패 구간이
   **유실 없이** 적재된다.
4. 워터마크 값이 타입 태그와 함께 저장돼 있고, 화면에서 보인다.
5. 한 소스가 두 타깃으로 갈라지는 파이프라인에서 **소스 쿼리가 한 번만 실행된다.** 확인은 대상
   DB의 `pg_stat_statements`로 하는데, **이 확장은 기본으로 켜져 있지 않다**
   ([STEP 7](step-07-operations-monitoring.md)) — 확인은 확장을 켜 둔 **데모·개발 DB에서** 한다.
   확장이 없는 환경에서는 감사 로그의 소스 읽기 기록 건수로 대신 센다.
6. 실행 중 워커 컨테이너를 재시작해도 잠금이 풀리고 재개된다.
7. 워터마크를 수동으로 되돌리면 **감사 로그에 한 건** 남는다
   (`pipeline_trigger='watermark_reset'` — [audit-logs.md](../schema/audit-logs.md)).

**3번이 이 STEP의 하드 게이트다.** 워터마크 전진 규칙이 깨지면 데이터가 조용히 유실되고, 그건
사용자가 한참 뒤에야 발견한다.

## 관련 문서

- [execution-engine.md](../pipeline/execution-engine.md)
- [deployment.md](../pipeline/deployment.md)
- [pipeline-checkpoints](../schema/pipeline-checkpoints.md)
