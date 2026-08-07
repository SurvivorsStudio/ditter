# 쿼리 부하 방어 (P5)

읽기 전용이라도 무거운 쿼리 하나가 서비스를 느리게 만들 수 있다. 부하 자체를 막는 정책이다.

## 적용해야 할 제한

- `statement_timeout` — **롤(role) 레벨로 서버가 강제**하도록 설정한다. 앱 레벨 timeout만 믿지 않는다.
- 반환 행 수 제한
- 커넥션 풀 상한

## timeout은 필요조건이지 충분조건이 아니다

`statement_timeout`이 있어도 쿼리가 timeout에 걸리기 전까지 이미 서버 자원을 크게 잡아먹을 수 있다. 그래서 [실행 전 위험 예측](../todo/step-05-risk-prediction.md)으로 애초에 위험한 쿼리를 실행 전에 걸러내는 것이 더 중요하다. timeout은 마지막 안전망이지 주된 방어 수단이 아니다.

## 통계 신선도

EXPLAIN의 예상 행수·비용은 DB 통계에 의존한다. 통계가 낡으면 추정이 크게 틀린다. **마지막 ANALYZE 시각을 항상 함께 노출**해서 사용자가 판단할 수 있게 한다.

## 예측 가능한 것과 불가능한 것

| 예측 가능 (EXPLAIN으로 알 수 있음) | 예측 불가능 (실행해봐야 앎) |
|---|---|
| 큰 테이블 풀스캔 | 락 경합 |
| 예상 비용·행수 급증 | 리플리카 지연 |
| 인덱스 미사용 조인 | 실제 동시성 문제 |

락 경합과 리플리카 지연은 런타임 동시성 현상이라 실행 전 예측이 원리적으로 불가능하다. "실행 전 예측"의 범위를 **플랜 기반 비용**으로 정직하게 한정한다. 이걸 넘어서 홍보하면 안 된다.

## 관련

- 담당 STEP: [1A](../todo/step-01a-connection-registry.md)(풀 상한) · [1C](../todo/step-01c-schema-catalog.md)(timeout·행수), [step-05-risk-prediction.md](../todo/step-05-risk-prediction.md)
- [read-only-enforcement.md](read-only-enforcement.md)
