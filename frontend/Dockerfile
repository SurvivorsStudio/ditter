# 빌드 컨텍스트는 저장소 루트다 (모노레포 워크스페이스 전체가 필요하다).
# STEP 0 의 compose 는 로컬 개발용이라 Vite dev 서버를 그대로 띄운다.
# 프로덕션 정적 빌드·서빙은 STEP 10 에서 다룬다.
FROM node:26-alpine

# S7 — non-root 로 실행한다. 설치까지 전부 node 계정으로 돌려 /app 이 처음부터 node 소유가
# 되게 한다. Vite dev 서버는 기동할 때 설정을 번들링해 vite.config.ts 옆에
# vite.config.ts.timestamp-*.mjs 를 쓰므로 작업 트리에 쓰기 권한이 필요하다.
# 설치를 root 로 하고 나중에 `chown -R` 로 넘기면 의존성 트리 전체가 레이어에 한 번 더
# 복사된다 (실측 +170MB).
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared-types/package.json packages/shared-types/
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node frontend/package.json frontend/

# docs/policy/supply-chain-security.md S2·S5 — lockfile 고정 + 설치 스크립트 차단.
RUN npm ci --ignore-scripts

COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node packages/shared-types packages/shared-types
COPY --chown=node:node frontend frontend

RUN npm run build --workspace=packages/shared-types

# docker-compose.yml 이 이 경로들을 익명 볼륨으로 선언한다(호스트 bind mount 가 컨테이너
# 산출물을 가리지 않게). 그 볼륨은 지금 이 시점의 소유권(node, uid 1000)을 그대로 물려받아
# 초기화되는데, 컨테이너를 다른 uid(`DEV_UID` — 리눅스에서 호스트 소유자와 맞추는 값)로
# 띄우면 그 uid 가 못 쓴다. `dist` 는 컨테이너가 뜰 때마다 이 build 를 다시 돌리므로 매번
# 걸리고, `frontend/node_modules` 는 npm 워크스페이스 호이스팅 때문에 이미지에 원래
# 존재하지 않는데 Vite 가 의존성 사전 번들링 캐시(`node_modules/.vite`)를 거기 쓰려고
# 시도한다 — 실측: `mkdir -p` 없이 두면 `EACCES: permission denied, mkdir
# '.../node_modules/.vite/deps_temp_...'` 로 매 리로드마다 에러가 난다(화면 자체는
# 캐시 없이도 뜨지만 계속 에러가 쌓인다). 어떤 uid 로 뜨더라도 쓸 수 있게 미리 만들어 연다.
#
# `packages/shared-types/node_modules` 는 같은 익명 볼륨 목록에 있지만 손대지 않는다 —
# 마찬가지로 이미지에 존재하지 않는 경로이고, node_modules 하위이니 같은 이유로 안전할
# 것 같지만 실제로 거기에 쓰는 동작은 확인되지 않았다.
RUN mkdir -p frontend/node_modules && \
    chmod -R a+rwX packages/shared-types/dist frontend/node_modules

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=frontend"]
