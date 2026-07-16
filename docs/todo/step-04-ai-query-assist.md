# STEP 4 · AI 쿼리 작성 보조 (`F2` 완성)

**시작 조건**: STEP 2 + STEP 3

## 목표

"지난달 가입한 회원 중 결제한 사람"이라고 한국어로 쓰면 AI가 SQL로 만들어 준다. 또는 이미 쓴 SQL을 개선해 준다.

**중요한 건 "어떤 AI냐"가 아니라 "무엇을 알고 있느냐"다.** ChatGPT는 우리 테이블 이름도 모른다. 우리는 STEP 3에서 만든 실제 스키마·인덱스·통계를 넘기므로, **존재하는 테이블과 컬럼으로 된 SQL**이 나온다.

## 하는 일

- 자연어 → SQL 생성. STEP 3의 컨텍스트를 프롬프트에 주입
- 작성 중인 SQL 개선 제안
- AI 출력을 정해진 스키마로 검증. **검증 실패 시 원본 쿼리를 그대로 반환**한다
- **AI가 만든 SQL도 신뢰하지 않는다.** STEP 1의 AST 검증기를 통과시킨 뒤에만 실행 가능하게

## 완료 조건

자연어 요청을 넣으면 실제 존재하는 테이블·컬럼으로 된 SQL이 나오고, 사용자가 확인 후 실행할 수 있다.

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md)
- [ai-context-and-safety.md](../policy/ai-context-and-safety.md)
