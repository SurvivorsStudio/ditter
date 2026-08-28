# build context 는 저장소 루트
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
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
COPY apps/worker/pyproject.toml /app/apps/worker/
RUN mkdir -p /app/apps/connectors/src/eai_connectors \
             /app/apps/api/src/eai_api \
             /app/apps/worker/src/eai_worker \
 && touch /app/apps/connectors/src/eai_connectors/__init__.py \
          /app/apps/api/src/eai_api/__init__.py \
          /app/apps/worker/src/eai_worker/__init__.py \
 && pip install --upgrade pip \
 && pip install /app/apps/connectors /app/apps/api /app/apps/worker

# --- 2단계: 실제 소스 ---
# 자주 바뀌는 것을 뒤에 둔다. 의존성은 이미 깔려 있으므로 --no-deps 로 코드만 덮어쓴다.
COPY apps/connectors/src/ /app/apps/connectors/src/
COPY apps/api/src/ /app/apps/api/src/
COPY apps/worker/src/ /app/apps/worker/src/
RUN pip install --no-deps --force-reinstall \
      /app/apps/connectors /app/apps/api /app/apps/worker

RUN useradd --create-home --uid 10001 eai && chown -R eai:eai /app
USER eai

# Celery 워커가 살아 있는지 확인 (broker 왕복)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD celery -A eai_worker.celery_app:app inspect ping -d celery@$HOSTNAME || exit 1

CMD ["celery", "-A", "eai_worker.celery_app:app", "worker", "-l", "info", "-Q", "eai.default"]
