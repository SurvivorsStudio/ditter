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

# docker-compose.yml 이 `packages/shared-types/dist` 를 익명 볼륨으로 선언한다(호스트
# bind mount 가 컨테이너 산출물을 가리지 않게). 그 볼륨은 지금 이 시점의 소유권(node,
# uid 1000)을 그대로 물려받아 초기화되는데, 컨테이너를 다른 uid(`DEV_UID` — 리눅스에서
# 호스트 소유자와 맞추는 값)로 띄우면 그 uid 가 못 쓴다 — 컨테이너가 뜰 때마다 이 build 를
# 다시 돌리므로 매번 걸린다. 어떤 uid 로 뜨더라도 쓸 수 있게 미리 열어 둔다.
#
# `backend/node_modules`·`packages/shared-types/node_modules` 도 같은 이유로 익명
# 볼륨이지만 여기서는 손대지 않는다 — npm 워크스페이스가 의존성을 루트 node_modules 로
# 전부 호이스팅해서 이 경로 자체가 이미지 안에 존재하지 않고(런타임에 빈 디렉터리로
# 새로 생긴다), 아무도 거기에 쓰지 않는다.
RUN chmod -R a+rwX packages/shared-types/dist

EXPOSE 4000
CMD ["node", "backend/src/index.ts"]
