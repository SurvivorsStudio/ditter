# 감사 로그 (P7)

## 왜 필요한가

기능이라기보다 **신뢰의 근거**다. "누가 언제 무슨 쿼리를 돌렸는지 다 남습니다"가 있어야 회사가 프로덕션에 붙이는 걸 허락한다. "회사가 AI에게 프로덕션 접근을 못 주는 이유를 해결한다"는 제품 스토리의 절반이 여기서 나온다.

## 원칙

- 누가·언제·무슨 쿼리를 실행했는지 기록한다.
- SQLite에 **append-only(추가만 가능)**로 기록한다.
- **앱에서 삭제 API를 만들지 않는다.** 지울 수 있으면 감사 로그가 아니다.

## 파이프라인 실행도 감사 대상이다

[파이프라인(F7)](../pipeline/README.md)도 프로덕션 DB에 쿼리를 날린다. 콘솔에서 실행하지 않았다는 이유로 빠지면 감사 로그의 완결성이 깨진다.

- **소스 읽기**는 실행(run) 단위로 한 건 남긴다. 배치마다 남기면 감사 로그가 파이프라인 로그에 파묻힌다.
- **타깃 쓰기**는 콘솔에서 불가능한 동작이므로 더 자세히 남긴다 — 커넥션·대상·모드·행수·파이프라인 버전까지. 항목은 [pipeline-write-boundary.md](pipeline-write-boundary.md) 규칙 7에 있다.
- 파이프라인 실행 상세 로그(`pipeline_run_logs`)는 **감사 로그가 아니다.** 용도도 보존 정책도 다르며, append-only·삭제 불가 원칙을 대신하지 못한다.

## 완결성 검증

실행된 모든 쿼리가 감사 로그에 남고, 앱을 통해서는 어떤 경로로도 지울 수 없어야 한다. 파이프라인 실행 경로로 들어온 쿼리도 마찬가지다.

## 관련

- 담당 STEP: [step-08-audit-log-auth.md](../todo/step-08-audit-log-auth.md)
- [authentication-authorization.md](authentication-authorization.md)
- [pipeline-write-boundary.md](pipeline-write-boundary.md) (P9)
