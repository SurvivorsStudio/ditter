# build context 는 저장소 루트 (connectors 를 함께 복사해야 하므로)
FROM python:3.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

# MSSQL 커넥터용 ODBC 드라이버 (Phase 2). pyodbc 는 시스템 드라이버가 있어야 동작한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg apt-transport-https \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- 1단계: 의존성만 ---
# pyproject 만 복사하고 **빈 패키지**를 만들어 설치한다. 목적은 의존성 해결뿐이다.
# 이 레이어는 pyproject 가 바뀔 때만 깨지므로, 코드를 고쳐도 pip install 이 다시 돌지 않는다.
# (소스를 먼저 COPY 하면 한 줄만 고쳐도 여기가 통째로 무효화되어 매번 몇 분씩 걸린다.)
COPY apps/connectors/pyproject.toml /app/apps/connectors/
COPY apps/api/pyproject.toml /app/apps/api/
RUN mkdir -p /app/apps/connectors/src/eai_connectors /app/apps/api/src/eai_api \
 && touch /app/apps/connectors/src/eai_connectors/__init__.py \
          /app/apps/api/src/eai_api/__init__.py \
 && pip install --upgrade pip \
 && pip install /app/apps/connectors /app/apps/api

# --- DuckDB 연합 조회 확장 ---
# 첫 조회 때 확장 저장소에서 내려받는 대신 이미지에 구워 둔다. 폐쇄망에서도 돌고,
# 첫 조회가 네트워크를 기다리지 않는다 (services/duck_service 의 _new_hub).
# 이 경로는 런타임에도 설정으로 넘어간다 — 환경변수 이름을 바꾸면 양쪽을 함께 고칠 것.
# mssql 은 커뮤니티 확장이라 플랫폼 빌드가 없을 수 있다 → 없으면 경고만 남기고 넘어간다
# (그 타입 연결을 실제로 쓸 때만 실패하고, MySQL·PostgreSQL 은 계속 돈다).
ENV EAI_DUCKDB_EXTENSION_DIR=/opt/duckdb/extensions
COPY apps/api/scripts/bake_duckdb_extensions.py /tmp/
RUN mkdir -p $EAI_DUCKDB_EXTENSION_DIR \
 && python /tmp/bake_duckdb_extensions.py \
 && rm /tmp/bake_duckdb_extensions.py \
 && chmod -R a+rX /opt/duckdb

# --- 2단계: 실제 소스 ---
# 자주 바뀌는 것을 뒤에 둔다. 의존성은 이미 깔려 있으므로 --no-deps 로 코드만 덮어쓴다.
COPY apps/connectors/src/ /app/apps/connectors/src/
COPY apps/api/src/ /app/apps/api/src/
RUN pip install --no-deps --force-reinstall /app/apps/connectors /app/apps/api

COPY apps/api/alembic.ini /app/apps/api/
COPY apps/api/migrations/ /app/apps/api/migrations/

WORKDIR /app/apps/api

# 루트로 서비스를 돌리지 않는다
RUN useradd --create-home --uid 10001 eai && chown -R eai:eai /app
USER eai

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "eai_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
