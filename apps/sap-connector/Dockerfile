# SAP RFC 전용 사이드카 (설계 문서 §2, §3)
#
# ── NW RFC SDK 는 이 이미지에 포함되어 있지 않다 ──
# SAP NetWeaver RFC SDK 는 SAP 고객/파트너만 SAP Software Download Center 에서
# 받을 수 있는 독점 바이너리다. 저장소에 커밋할 수도, pip 로 받을 수도 없다.
#
# 운영 이미지를 만들려면:
#   1) SAP Software Download Center 에서 "SAP NW RFC SDK 7.50" (Linux x86_64) 다운로드
#   2) 받은 nwrfcsdk 를 이 디렉터리의 vendor/ 에 풀어 넣는다
#        apps/sap-connector/vendor/nwrfcsdk/{lib,include}
#   3) `docker build --build-arg WITH_NWRFC=1 ...` 로 빌드
#
# WITH_NWRFC=0(기본)이면 SDK 없이 빌드되고, 목 백엔드로만 동작한다.
# 목 백엔드는 512자 행폭·72자 OPTIONS 제약을 실제와 똑같이 재현하므로
# 파이프라인 저작과 분할 로직 검증은 SDK 없이도 가능하다.

FROM python:3.14-slim

ARG WITH_NWRFC=0

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk \
    LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# SDK 는 있을 때만 복사된다. vendor/ 가 비어 있어도 빌드가 깨지지 않도록
# 더미 파일과 함께 받는다.
COPY apps/sap-connector/vendor* /tmp/vendor/
RUN if [ "$WITH_NWRFC" = "1" ]; then \
      if [ ! -d /tmp/vendor/nwrfcsdk ]; then \
        echo "ERROR: WITH_NWRFC=1 인데 vendor/nwrfcsdk 가 없습니다." >&2; exit 1; \
      fi; \
      mkdir -p /usr/local/sap && cp -r /tmp/vendor/nwrfcsdk /usr/local/sap/ && \
      echo "/usr/local/sap/nwrfcsdk/lib" > /etc/ld.so.conf.d/nwrfcsdk.conf && ldconfig && \
      pip install --upgrade pip && pip install pyrfc; \
    else \
      echo "NW RFC SDK 없이 빌드합니다 — 목 백엔드 전용 이미지입니다."; \
    fi \
 && rm -rf /tmp/vendor

COPY apps/sap-connector/pyproject.toml /app/
COPY apps/sap-connector/src/ /app/src/
COPY apps/sap-connector/fixtures/ /app/fixtures/

RUN pip install --upgrade pip && pip install /app

RUN useradd --create-home --uid 10001 eai && chown -R eai:eai /app
USER eai

EXPOSE 8100

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -fsS http://localhost:8100/health || exit 1

CMD ["uvicorn", "eai_sap.main:app", "--host", "0.0.0.0", "--port", "8100"]
