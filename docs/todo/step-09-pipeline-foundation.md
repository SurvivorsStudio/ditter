# STEP 9 · 파이프라인 기반

**시작 조건**: STEP 1 + STEP 8

STEP 1의 DB 어댑터·커넥션 관리를 물려받고, STEP 8의 인증·감사 로그가 서 있어야 한다. **쓰기가
생기는 첫 STEP이므로 인증 없이 진행하지 않는다.**

## 목표

**화면 없이** 파이프라인 한 개를 정의하고 실행할 수 있게 만든다. 커넥터 계약, DAG 스펙, 실행
엔진, 워커까지 — 캔버스는 [STEP 10](step-10-pipeline-canvas.md)에서 얹는다.

STEP 1이 "DB를 안전하게 읽는 능력"이었다면, 이 STEP은 **"그 읽기를 반복 가능하게 만드는
능력"**이다. 그리고 STEP 1과 마찬가지로 **뒤따르는 모든 것의 병목**이다.

## 작업 분할 — 네 문서로 나눈다

STEP 9는 다른 STEP 하나의 서너 배 분량이고, 그중 절반은 나머지를 기다리지 않아도 되는
순수 로직이다. 그래서 넷으로 나눈다.

| 문서 | 내용 | 시작 조건 |
|---|---|---|
| [9A 쓰기 경계 긋기](step-09a-write-boundary.md) | `role` 분리 · 라우터 앞단 차단 · 관리자 제한 | STEP 1 + 8 |
| [9B 커넥터 패키지](step-09b-connectors.md) | `Connector` 계약 + 4종. **mock 선행 가능** | 없음 |
| [9C DAG 스펙과 저장](step-09c-dag-spec.md) | Pydantic DAG 모델 · 테이블 · 저장 검증. **스펙은 mock 선행 가능** | 스펙 없음 / 검증 9A |
| [9D 실행 엔진과 워커](step-09d-execution-engine.md) | Celery · pull 스트리밍 · 잠금 · 감사 기록 | 9A + 9B + 9C |

```
        ┌──▶ 9B 커넥터 ─────────┐
(mock)  ├──▶ 9C DAG 스펙 ───────┤
        │         ▲             ├──▶ 9D 실행 엔진 · 워커
STEP 1+8 ──▶ 9A 쓰기 경계 ──────┘
```

**순서 규칙은 하나뿐이다 — 9A가 9D보다 먼저 끝난다.** 9D는 타깃에 실제로 쓰는 코드라서, 경계가
서기 전에 만들면 "일단 되게 만들고 나중에 막자"가 되고 그러면 안 막힌다. 9B·9C는 타깃에 쓰지
않으므로 병렬로 가도 되고, **순수 타입·순수 로직 부분은 STEP 1이 끝나기 전부터** 착수한다
([todo README](README.md)의 「지금 당장 착수할 것」 6번).

## 완료 조건

CLI나 API 호출만으로 다음이 된다.

1. `role='source'` 커넥션에서 테이블 하나를 읽어 `role='target'` 커넥션에 `upsert`로 적재한다.
2. 같은 실행을 두 번 돌려도 타깃 결과가 같다 (멱등).
3. 같은 파이프라인을 동시에 두 번 트리거하면 **두 번째가 거절된다.**
4. 콘솔의 쿼리 실행 API에 타깃 커넥션을 넣으면 **거부된다.**
5. 소스 `query`에 `WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`를 넣으면
   **저장 단계에서 거부된다.**
6. 실행 결과가 `pipeline_runs`에 남고, 소스 읽기·타깃 쓰기가 감사 로그에 남는다.

네 문서의 완료 조건을 전부 만족하면 위가 자동으로 만족된다 — 4는 9A, 5는 9C, 나머지는 9D가 담당한다.

## 리뷰 게이트

🔒 **쓰기 경계(P9) 구현은 2인 리뷰 필수다.** [STEP 1](step-01-db-connection.md)의 읽기 전용
강제·자격증명 처리와 같은 등급으로 취급한다. 여기가 뚫리면 읽기 전용 콘솔이 쓰기 가능한 콘솔이
된다.

리뷰 대상은 **9A와 9D**다. 9A는 경계를 긋는 코드, 9D는 그 경계를 실제로 넘나드는 코드다.

위 완료 조건 3·4·5는 **회귀 테스트로 고정한다** ([testing.md](../conventions/testing.md)).

## 관련 문서

- [docs/pipeline](../pipeline/README.md) — 기능 전체 설계
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) (P9)
- [read-only-enforcement.md](../policy/read-only-enforcement.md) (P3)
- [credential-management.md](../policy/credential-management.md) (P4)
