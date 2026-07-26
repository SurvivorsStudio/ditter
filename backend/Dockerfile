# 빌드 컨텍스트는 저장소 루트다 (모노레포 워크스페이스 전체가 필요하다).
FROM node:26-alpine

WORKDIR /app

# 워크스페이스 매니페스트만 먼저 복사해 의존성 레이어를 캐시한다.
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# docs/policy/supply-chain-security.md S2·S5 — lockfile 고정 + 설치 스크립트 차단.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY backend backend

RUN npm run build --workspace=packages/shared-types

# S7 — non-root 로 실행한다.
USER node

EXPOSE 4000
CMD ["node", "backend/src/index.ts"]
