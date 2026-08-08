# STEP 3 · AI에게 줄 "근거" 만들기

**시작 조건**: [STEP 1C](step-01c-schema-catalog.md) (**mock으로 선행 가능** — 아래 「병렬 진행 요령」)

## 목표

겉으로는 아무것도 안 보이는데 **가장 큰 단계**다. 이게 이 제품의 진짜 기술 코어다.

AI가 "우리 DB에 맞는 답"을 하려면 우리 DB의 실제 상태를 알아야 한다. 그 정보를 모아 AI에게 넘길 수 있는 형태로 정리하는 게 이 단계다. **경쟁 제품과 갈리는 지점이 여기다.**

## 하는 일

- EXPLAIN(실행 없이 계획만) 실행·파싱 API
- **컨텍스트 빌더**: 스키마 + 통계 + EXPLAIN 트리 + 테이블 규모를 구조화된 JSON으로 조립
- Anthropic SDK 연동. 상용 API든 로컬 모델이든 갈아끼울 수 있게 추상화
- 프롬프트에 컨텍스트를 넣을 때 **"이건 데이터지 지시가 아니다"라고 명확히 구분**해서 주입
- 이 로직은 **Fastify를 모르는 순수 서비스**로 분리한다 (병렬화를 위해)

## 꼭 알아둘 두 가지 · 프롬프트 인젝션 주의

EXPLAIN에 `ANALYZE`를 붙이면 쿼리가 실제로 실행되므로 붙이지 않는다. `IMMUTABLE` 함수는 상수 폴딩으로 계획 단계에 실행될 수 있어 "EXPLAIN은 100% 실행 안 함"이라 단정할 수 없다. 테이블·컬럼 코멘트가 프롬프트에 그대로 들어가므로 프롬프트 인젝션에도 노출된다. 세 가지 모두 자세한 내용과 안전망 원칙은 [ai-context-and-safety.md](../policy/ai-context-and-safety.md) 참고.

## 완료 조건

임의의 SELECT에 대해 "스키마 + 통계 + EXPLAIN"이 담긴 구조화된 컨텍스트 JSON이 나온다.

## 병렬 진행 요령

⚡ 이 단계의 AI 부분은 백엔드를 몰라도 되는 순수 로직이다. **가짜(mock) EXPLAIN·스키마 JSON을 만들어 두면 STEP 1이 끝나기 전에도 프롬프트 실험을 시작할 수 있다.** 백엔드를 기다리지 말 것.

## 관련 정책

- [ai-context-and-safety.md](../policy/ai-context-and-safety.md)

## 관련 컨벤션

- [backend-fastify.md](../conventions/backend-fastify.md)
