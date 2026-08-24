# SymmetricDS 사이드카 — 공식 이미지에 JDBC 드라이버만 얹는다.
#
# 드라이버를 볼륨으로 붙이지 않는 이유가 있다. SymmetricDS 의 클래스패스 디렉터리는
# `/opt/symmetric-ds/lib` 인데 거기에 Jetty·Spring 등 **100개 넘는 jar 가 이미 들어 있다.**
# 호스트 디렉터리를 그 위에 마운트하면 그것들이 전부 가려져 서버가 뜨지 못한다.
# COPY 는 덮지 않고 더하기만 하므로 안전하다.
#
# 공식 이미지에는 SQL Server·PostgreSQL 드라이버가 **없다** (h2 만 있다).
# `sync/symmetricds/lib/` 에 jar 를 넣고 다시 빌드하면 이 자리로 들어간다.

ARG SYMMETRIC_VERSION=3.15
FROM jumpmind/symmetricds:${SYMMETRIC_VERSION}

# lib/ 에 README.md 만 있어도 COPY 는 성공한다 (드라이버는 나중에 넣어도 된다).
COPY sync/symmetricds/lib/ /opt/symmetric-ds/lib/
