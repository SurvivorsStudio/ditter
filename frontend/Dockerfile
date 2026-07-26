# 빌드 컨텍스트는 저장소 루트다 (모노레포 워크스페이스 전체가 필요하다).
# STEP 0 의 compose 는 로컬 개발용이라 Vite dev 서버를 그대로 띄운다.
# 프로덕션 정적 빌드·서빙은 STEP 10 에서 다룬다.
FROM node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# docs/policy/supply-chain-security.md S2·S5 — lockfile 고정 + 설치 스크립트 차단.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY frontend frontend

RUN npm run build --workspace=packages/shared-types

# S7 — non-root 로 실행한다.
USER node

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=frontend"]
