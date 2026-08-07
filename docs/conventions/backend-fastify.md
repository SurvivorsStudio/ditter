# 백엔드 (Fastify) 컨벤션

## 요청 스키마 검증

- 모든 라우트에 JSON Schema(Ajv)로 요청/응답 스키마를 명시하고, `additionalProperties: false`를 기본으로 둔다.
- JSON Schema 검증만으로는 prototype pollution이 막히지 않는다 — 이유와 실제 방어 메커니즘은 [supply-chain-security.md의 S8](../policy/supply-chain-security.md) 참고.

## prototype pollution 방어 (S8)

- Fastify의 `onProtoPoisoning: 'error'` 설정이 기본값으로 켜져 있는지 **직접 확인**한다(버전마다 다를 수 있으므로 가정하지 않는다).
- 외부 입력을 객체에 병합할 때는 `Object.create(null)`로 만든 객체를 대상으로 하거나, 안전이 검증된 병합 유틸을 쓴다.

## 내부 쿼리 작성 원칙 (P1)

- Fastify 라우트/서비스가 직접 짜는 카탈로그 조회 쿼리는 파라미터 바인딩을 강제하고, 문자열 연결로 SQL을 조립하지 않는다.
- 이 원칙과 사용자가 직접 입력하는 SQL(P2)의 구분은 [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) 참고.

## 서비스 계층 분리

- 순수 비즈니스 로직(컨텍스트 빌더, AST 검증, 위험 판정 규칙)은 Fastify 라우트 핸들러 안에 직접 짜지 않는다. Fastify를 import하지 않는 순수 함수/서비스로 분리하고, 라우트 핸들러는 이를 호출만 한다. ([project-structure.md](project-structure.md) 참고)
- 이렇게 분리해야 라우트 없이도 유닛 테스트가 가능하고, mock 데이터로 병렬 개발이 가능하다.

## 관련

- 담당 STEP: [1A](../todo/step-01a-connection-registry.md)(첫 라우트 · 스키마 검증 · S8 · P1), [step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md)(서비스 계층 분리)
- [../policy/supply-chain-security.md](../policy/supply-chain-security.md)
