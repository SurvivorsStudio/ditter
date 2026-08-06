# 자격증명 관리 (P4)

## 원칙

- DB 접속 정보(비밀번호 등)는 **서버에만** 보관한다. 브라우저로 절대 내려보내지 않는다.
- 로그에 접속 정보를 평문으로 남기지 않는다.
- SQLite에 저장 시 암호화한다.

## 키 관리 방침을 얼버무리지 마라

"SQLite 저장 시 암호화"라고만 쓰면 반쪽이다. **암호화 키가 어디 있는가?**

앱이 복호화할 수 있으면 키도 접근 가능하다. 키가 같은 호스트의 환경변수에 있으면 방어 이득이 제한적이다. 다음 중 하나를 **명시적으로** 선택하고 방침으로 남긴다:

- 외부 시크릿 관리(예: OS 키체인, 별도 시크릿 매니저)를 쓴다
- 또는 "평문 + 파일 권한 + 감사"로 정직하게 간다 — 이 경우 그렇다고 문서에 명시한다

> **팀 결정 필요**: 자격증명 암호화 키 관리 방침은 개발 착수 전에 팀이 합의해야 한다. ([todo README](../todo/README.md) "팀이 먼저 결정해야 할 것" 참고)

## 커넥터 시크릿도 같은 방식으로 다룬다

[파이프라인(F7)](../pipeline/README.md)의 커넥터 설정에는 DB 비밀번호 외의 시크릿이 섞여 들어온다. **파이프라인용 암호화 메커니즘을 새로 만들지 않는다** — 위 방침을 그대로 적용한다.

다음 키는 저장 시 분리 암호화하고, **API 응답·로그·에러 메시지 어디에도 포함하지 않는다.**

```
password · secretAccessKey · sessionToken · privateKey · passphrase · apiToken
```

- 이 키 목록은 **한 곳에 두고 직렬화 계층에서 강제**한다. 각 라우터가 알아서 빼게 두면 새 엔드포인트에서 샌다.
- 새 커넥터가 새 시크릿 키를 들고 오면 **이 목록에 추가하는 것이 커넥터 추가 체크리스트에 포함된다** ([connector-contract.md](../pipeline/connector-contract.md)).
- 커넥터가 던지는 에러에 config 객체를 통째로 붙이지 않는다.

## 리뷰 게이트

🔒 자격증명 처리 구현은 읽기 전용 강제와 함께 **2인 리뷰 필수** 대상이다.

## 관련

- 담당 STEP: [step-01-db-connection.md](../todo/step-01-db-connection.md), [step-09-pipeline-foundation.md](../todo/step-09-pipeline-foundation.md)
- [pipeline-write-boundary.md](pipeline-write-boundary.md) (P9)
