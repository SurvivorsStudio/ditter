# 빌드 컨텍스트는 저장소 루트다 (모노레포 워크스페이스 전체가 필요하다).
FROM node:26-alpine

# S7 — non-root 로 실행한다. 설치까지 전부 node 계정으로 돌려 /app 이 처음부터 node 소유가
# 되게 한다. STEP 1 에서 로컬 SQLite 파일·로그가 작업 트리에 생겨도 권한 문제가 없고,
# 설치 후 `chown -R` 로 넘길 때처럼 의존성 트리가 레이어에 중복 복사되지도 않는다.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# 워크스페이스 매니페스트만 먼저 복사해 의존성 레이어를 캐시한다.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared-types/package.json packages/shared-types/
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node frontend/package.json frontend/

# docs/policy/supply-chain-security.md S2·S5 — lockfile 고정 + 설치 스크립트 차단.
RUN npm ci --ignore-scripts

COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node packages/shared-types packages/shared-types
COPY --chown=node:node backend backend

RUN npm run build --workspace=packages/shared-types

# 컨테이너는 root 로 시작해 진입점 스크립트가 익명 볼륨(node_modules · dist)의 소유권을
# 목표 uid(`DEV_UID` — 리눅스에서 호스트 저장소 소유자와 맞추는 값)로 정리한 뒤,
# su-exec 로 권한을 낮춰 실제 앱을 그 uid 로 실행한다. 그 이유와 build 시점 chmod 로는
# 왜 부족한지는 docker-entrypoint-dev.sh 의 주석 참고. 앱 프로세스 자체는 여전히
# non-root 로 도니 S7 은 그대로 지켜진다.
USER root
RUN apk add --no-cache su-exec
COPY backend/docker-entrypoint-dev.sh /usr/local/bin/docker-entrypoint-dev.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-dev.sh
ENTRYPOINT ["docker-entrypoint-dev.sh"]

EXPOSE 4000
CMD ["node", "backend/src/index.ts"]
