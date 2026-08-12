# TypeScript 스타일 (프런트엔드)

**프런트엔드**(React + Vite 웹 콘솔 + 파이프라인 캔버스)는 TypeScript로 개발한다. 백엔드·워커는
Python이므로 이 문서의 대상이 아니다 — 그쪽은 [python-style.md](python-style.md) 참고.

## 기본 원칙

- `strict` 모드를 켠 상태로 개발한다. `any`를 쓰지 않는다 — 타입을 모르면 `unknown`으로 받고 좁혀서 쓴다.
- 백엔드가 노출하는 타입(스키마 조회 결과, EXPLAIN 트리, DAG 스펙 등)은 **직접 다시 선언하지 않는다.** 백엔드의 OpenAPI 스펙에서 생성한 타입을 import해서 쓴다 — 생성 방식은 [project-structure.md](project-structure.md#프런트엔드-백엔드-타입-공유) 참고.
- 외부 입력(사용자 쿼리, AI 응답, API 응답)은 경계에서 스키마로 검증한 뒤에만 내부 타입으로 취급한다. "일단 캐스팅해서 통과시키고 나중에 확인"하지 않는다.
- lint/format 도구는 CI 게이트로 강제한다 (STEP 0에서 세팅). 로컬에서 통과하지 않는 코드는 커밋하지 않는다.

## 명명

- 파일명: kebab-case (`query-editor-pane.tsx`)
- 타입/인터페이스/클래스: PascalCase
- 변수/함수: camelCase
- DB 관련 개념은 PostgreSQL 용어를 그대로 쓴다 (예: `explainPlan`, `seqScan`, `statementTimeout`) — 자체 용어로 재작명해서 문서와 코드 사이 용어가 갈리지 않게 한다. 백엔드는 Python(snake_case)이지만 **API 응답은 백엔드가 직렬화 시점에 이미 `camelCase`로 내려준다** ([python-style.md](python-style.md)) — OpenAPI에서 생성된 타입도 이미 camelCase이므로, **프런트는 이름 규칙을 변환하지 않는다.** 변환 레이어를 만들면 생성된 타입과 런타임 데이터가 어긋난다.

## 에러 처리

- 발생할 수 없는 상황에 대한 방어 코드를 넣지 않는다. 시스템 경계(사용자 입력, API 응답, AI 응답)에서만 검증한다.
- 실패를 삼키지 않는다. 특히 [ai-context-and-safety.md](../policy/ai-context-and-safety.md)의 AI 출력 검증처럼 보안·안전과 직결된 검증은 실패 시 명확한 실패 경로(차단, 원본 반환)를 타야 하며 조용히 통과시키면 안 된다.

## 관련

- [project-structure.md](project-structure.md)
- [python-style.md](python-style.md) — 백엔드·워커 컨벤션
