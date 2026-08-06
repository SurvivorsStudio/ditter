# 파이프라인 배포 · 운영

파이프라인이 붙으면 **컨테이너 두 종류가 늘어난다** — Redis(큐)와 Worker(실행). 기존
`docker-compose.yml`의 `db · backend · frontend` 구성 위에 얹는다.

## 컨테이너 구성

| 서비스 | 역할 | 파이프라인 없이도 필요한가 |
|---|---|---|
| `db` | 로컬 개발용 대상 PostgreSQL | 기존 |
| `backend` | Fastify — REST · WebSocket · 큐 enqueue | 기존 |
| `frontend` | React + Vite | 기존 |
| **`redis`** | 잡 큐 · 진행률 · 실행 잠금 | **신규** |
| **`worker`** | BullMQ 워커 — DAG 실행 | **신규** |
| **`scheduler`** | cron 트리거 폴링 | **신규** (워커에 합칠 수도 있다 — 아래 참고) |

### scheduler를 워커에 합칠 것인가

BullMQ의 repeatable job을 쓰면 별도 스케줄러 프로세스 없이 큐 자체가 cron을 관리한다. **MVP는
이쪽을 택한다** — 프로세스가 하나 줄고, 스케줄과 큐가 같은 곳에 있어 상태가 갈라지지 않는다.

대신 지켜야 할 것: repeatable job의 키는 **파이프라인 ID + cron 식**으로 만들고, 스케줄을 바꾸면
**기존 repeatable job을 제거한 뒤 다시 등록한다.** 안 그러면 옛 스케줄이 유령처럼 남아 같은
파이프라인이 두 스케줄로 돈다.

## 환경변수

기존 `.env.example` 규칙을 그대로 따른다 — 접두사를 붙이지 않고, 실제 자격증명은 저장소에 두지
않는다.

```bash
# 큐
REDIS_URL=redis://127.0.0.1:6379

# 워커
WORKER_CONCURRENCY=2              # 명시한다. 기본값에 맡기지 않는다 (execution-engine.md)
WORKER_QUEUES=pipeline.default    # 무거운 커넥터는 별도 큐로 분리

# 파이프라인 파일 경로
PIPELINE_SPOOL_DIR=/var/lib/ditter/spool     # 팬아웃 스풀 임시 파일
PIPELINE_FILE_ROOT=/var/lib/ditter/exports   # 로컬 파일 타깃 격리 루트

# 오브젝트 스토리지 타깃 (쓰는 경우에만)
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL=                 # MinIO 등 S3 호환 저장소를 쓸 때
```

### `PIPELINE_FILE_ROOT`는 격리 루트다

로컬 파일 타깃이 쓸 수 있는 경로는 **이 루트 하위로 한정한다.** 사용자가 노드 설정에 넣은 경로를
그대로 이어 붙이지 않는다.

- 경로를 정규화(resolve)한 뒤 **루트 하위인지 검사**한다. `../` 로 빠져나가는 경로를 거부한다.
- 심볼릭 링크로 루트 밖을 가리키는 경우도 막는다.
- 이 검사는 **커넥터가 아니라 그보다 안쪽에서** 한다. 커넥터 구현이 늘어날 때마다 같은 검사를
  다시 짜게 두지 않는다.

`PIPELINE_SPOOL_DIR`도 같다. 스풀 파일 이름은 run ID로 만들고 사용자 입력을 섞지 않는다.

## 워커 컨테이너 운영

| 항목 | 방침 | 왜 |
|---|---|---|
| 동시성 | `WORKER_CONCURRENCY`로 명시 (기본 2) | 미지정 시 SQLite 잠금 경합 + 메모리 압박 |
| 확장 | **replicas 위주** | 한 프로세스의 동시성을 올리는 것보다 예측 가능하다 |
| mem/CPU limit | 컨테이너에 **건다** | 큰 적재 하나가 호스트를 잡아먹지 않게 |
| 실행 사용자 | **non-root** | STEP 12 컨테이너 하드닝과 동일 기준 |
| 베이스 이미지 | 최소 이미지 + Trivy 스캔 | [supply-chain-security.md](../policy/supply-chain-security.md) S7 |
| 종료 | `SIGTERM`에 **graceful shutdown** | 진행 중 배치를 끝내고 잠금을 반납한 뒤 종료 |

### graceful shutdown을 대충 하면

워커를 강제 종료하면 Redis 잠금이 TTL 만료까지 남고, 그동안 해당 파이프라인은 실행할 수 없다.
반대로 잠금을 안 걸고 죽으면 stalled 잡이 재개되면서 **같은 파이프라인이 겹쳐 돈다.** 종료
시그널을 받으면 새 잡을 받지 않고, 진행 중 잡을 끝내고, 잠금을 반납한 뒤 나간다.

## SQLite와 워커

메타 저장이 SQLite인 데서 오는 제약이다. 자세한 배경은
[README.md](README.md#️-메타-저장을-sqlite로-두는-것의-한계) 참고.

- **WAL 모드 + `busy_timeout`을 켠다.** 이건 선택이 아니다.
- SQLite 파일은 백엔드·워커가 **같은 볼륨**을 봐야 한다. 컨테이너를 나눴다면 볼륨을 공유한다.
- 워커를 **여러 호스트로 흩는 순간 SQLite는 끝난다.** 그때는 메타 저장을 PostgreSQL로 옮긴다 —
  메타 저장 접근을 인터페이스 뒤에 둔 이유가 이것이다.

## 개발 명령어

```bash
# 전체 기동 (db · backend · frontend · redis · worker)
docker compose up -d

# 일상 개발 — 인프라만 컨테이너, 앱은 호스트에서
docker compose up -d db redis
npm run dev                # 백엔드 :4000 + 프런트 :5173
npm run dev:worker         # 파이프라인 워커
```

## 관련

- [execution-engine.md](execution-engine.md) — 여기 설정들이 지탱하는 실행 규칙
- [supply-chain-security.md](../policy/supply-chain-security.md) — 컨테이너 하드닝 기준
- 담당 STEP: [step-11-pipeline-operations.md](../todo/step-11-pipeline-operations.md)
