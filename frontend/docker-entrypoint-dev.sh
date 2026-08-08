#!/bin/sh
# 컨테이너 진입점 — 항상 root 로 시작해서 익명 볼륨의 소유권을 목표 uid 로 맞춘 뒤
# su-exec 로 권한을 낮춰 실제 앱을 그 uid 로 실행한다.
#
# 왜 이게 필요한가: 이미지 빌드 시점에 chmod 를 해 두는 방식은 그 시점에 이미
# 존재하는 디렉터리에만 적용된다. 익명 볼륨(node_modules · dist)은 컨테이너를
# 재생성해도 내용이 유지되므로, 예전 uid(DEV_UID)로 뜬 적이 있는 볼륨을 다른 uid 로
# 다시 띄우면 그 사이에 새로 생긴 하위 디렉터리는 옛 uid 소유로 남는다. 특히 Vite 는
# 기동할 때마다 `node_modules/.vite-temp` 에 설정 번들 임시 파일을 쓰는데, 그
# 디렉터리 자체가 이전 uid 로 이미 만들어져 있으면 새 uid 는 그 파일의 소유자가
# 아니므로 chmod 조차 할 권한이 없다 — 그래서 root 로 시작해 그 제약 없이 소유권
# 자체를 넘겨준다. 실제 앱 프로세스는 이 스크립트가 끝나면 non-root(기본 1000)로
# 넘어가므로 S7(non-root 실행)은 그대로 지켜진다.
set -e

TARGET_UID="${DEV_UID:-1000}"
TARGET_GID="${DEV_GID:-1000}"

# docker-compose.yml 이 frontend 서비스에 선언한 익명 볼륨만 정리한다. bind mount 되는
# 소스 디렉터리(frontend/src 등)는 호스트 소유자를 그대로 물려받아야 하므로 대상이 아니다.
chown -R "$TARGET_UID:$TARGET_GID" \
  /app/frontend/node_modules \
  /app/packages/shared-types/node_modules \
  /app/packages/shared-types/dist

exec su-exec "$TARGET_UID:$TARGET_GID" "$@"
