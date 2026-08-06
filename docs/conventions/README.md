# DITTER 개발 컨벤션

DITTER는 TypeScript 모노레포로 개발한다 (React + Vite 프런트엔드, Fastify 백엔드, PostgreSQL 대상, SQLite 로컬 저장). 이 문서들은 그 스택에서 지켜야 할 컨벤션을 다룬다.

[파이프라인 기능(F7)](../pipeline/README.md)은 별도 프로젝트로 설계됐던 Python 기반 청사진에서 왔지만, **DITTER 안에서는 예외 없이 이 컨벤션을 따른다** — 큐는 BullMQ, 검증은 zod, 워커도 같은 모노레포의 TypeScript 패키지다. 스택 대응표는 [pipeline/README.md](../pipeline/README.md#청사진--ditter-스택-대응)에 있다.

## 목록

| 문서 | 다루는 내용 |
|---|---|
| [typescript-style.md](typescript-style.md) | 언어 레벨 스타일: strict 모드, 명명, 에러 처리 원칙 |
| [project-structure.md](project-structure.md) | 모노레포 구성, DB 어댑터 인터페이스, 컨텍스트 빌더 분리 |
| [backend-fastify.md](backend-fastify.md) | Fastify 스키마 검증, prototype pollution 방어, 서비스 계층 분리 |
| [frontend-react.md](frontend-react.md) | React + Vite + CodeMirror 6 구조, 자동완성 기대치, AI UI 원칙 |
| [testing.md](testing.md) | 위험 판정 회귀 테스트, 읽기 전용 강제 테스트, mock 기반 병렬 개발 |
| [commit-convention.md](commit-convention.md) | 커밋 분리 기준(영역별), 브랜치·머지 정책, 커밋 메시지 포맷 |

## 컨벤션의 근거

여기 적힌 규칙 대부분은 임의의 스타일 취향이 아니라 [docs/policy](../policy/README.md)의 보안·안전 정책을 코드로 지키기 위한 것이다. 예를 들어:

- "AI 출력을 절대 그대로 실행하지 않는다"는 컨벤션은 [ai-context-and-safety.md](../policy/ai-context-and-safety.md) 정책에서 나온다.
- "DB 어댑터 인터페이스로 감싼다"는 컨벤션은 멀티 DB 확장성 스토리와 직결된다 ([step-13-demo-submission.md](../todo/step-13-demo-submission.md)).
- "Fastify를 모르는 순수 서비스로 분리한다"는 컨벤션은 mock 기반 병렬 개발([step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md))을 가능하게 하기 위함이다.

컨벤션과 정책이 충돌하는 것처럼 보이면 정책이 우선이다.

## 관련 문서

- [docs/todo](../todo/README.md) — 이 컨벤션이 적용되는 개발 단계
- [docs/policy](../policy/README.md) — 컨벤션의 근거가 되는 보안·데이터 취급 정책
- [docs/pipeline](../pipeline/README.md) — 파이프라인 기능의 설계와 그것이 요구하는 추가 규칙
