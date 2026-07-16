# STEP 0 · 개발 환경 만들기

**시작 조건**: 없음. 여기서 시작한다.

## 목표

팀 전원이 같은 바닥 위에서 작업하게 만든다. 아직 제품 기능은 없다.

## 하는 일

- 저장소 세팅, TypeScript 모노레포, 공유 타입 패키지, lint/format
- CI 파이프라인: 빌드·테스트
- **CI에 보안 게이트를 지금 심는다.**
  - `npm ci --ignore-scripts` (악성 설치 스크립트 차단)
  - `npm audit --audit-level=high` (취약 패키지 검사)
  - Dependabot
- Docker + `docker compose`로 앱과 로컬 PostgreSQL이 함께 뜨게
- 오픈소스 라이선스 선택, 이슈·PR 템플릿

## 완료 조건

`docker compose up` 한 줄로 빈 앱이 뜬다. CI가 초록불이다.

## 왜 지금인가

나중에 보안 게이트를 넣으면 이미 설치된 수백 개 의존성을 되짚어야 한다. 처음에 심으면 공짜다.

## 관련 정책

- [supply-chain-security.md](../policy/supply-chain-security.md)
