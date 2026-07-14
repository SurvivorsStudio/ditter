# 프런트엔드 (React + Vite) 컨벤션

## 스택

- React + Vite + TypeScript
- 에디터: CodeMirror 6 (SQL 문법 하이라이팅)
- 3분할 레이아웃: 에디터 / 결과 / 사이드바

## 자동완성 기대치

CodeMirror 6 기반 SQL 자동완성은 STEP 1의 스키마 API를 물려 테이블·컬럼 수준까지는 잘 동작한다. 다음은 처음부터 완벽을 기대하지 않는다:

- 별칭(alias) 해석
- 서브쿼리 스코프
- CTE를 인지하는 자동완성

이 한계를 알고 UI 기대치를 설계한다 (예: 에러 메시지나 빈 자동완성 목록에 과도하게 대응 로직을 만들지 않는다).

## 자격증명은 화면에 나타나지 않는다

접속 정보(비밀번호 등)는 서버에만 있다. 접속 선택 UI는 저장된 접속 이름만 노출하고, 비밀번호 입력/표시 필드를 두지 않는다. ([credential-management.md](../policy/credential-management.md))

## AI 관련 UI 원칙

- AI가 제안한 쿼리는 **항상 사용자 확인 후에만** 실행된다. "제안 → 자동 실행"으로 이어지는 흐름을 만들지 않는다.
- 위험 경고, AI 대안 제시, diff 표시는 [step-05-risk-prediction.md](../todo/step-05-risk-prediction.md), [step-06-explain-tuning.md](../todo/step-06-explain-tuning.md)의 데모 흐름을 그대로 따른다: 조회 시도 → 위험 경고 → AI 대안 → 안전한 실행.

## 관련

- 담당 STEP: [step-02-web-console.md](../todo/step-02-web-console.md)
