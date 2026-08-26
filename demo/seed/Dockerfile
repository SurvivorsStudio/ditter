FROM python:3.12-slim

# MSSQL 은 pyodbc + msodbcsql18 로 붙는다. pymssql 이 더 가볍지만 클라이언트 인코딩
# 변환을 거쳐 한글이 깨질 여지가 있고, 본체(apps/api)도 pyodbc 를 쓰므로 같은 경로로 둔다.
# 드라이버 이름("ODBC Driver 18 for SQL Server")도 여기서 함께 검증되는 셈이다.
#
# libgssapi-krb5-2 를 **명시적으로** 설치한다. curl 의 의존으로 딸려 들어오는데,
# `apt-get autoremove` 를 돌리면 함께 사라진다. 그러면 unixODBC 가 드라이버 파일은
# 있는데도 "file not found" 라고만 말해(의존 라이브러리 누락을 그렇게 보고한다)
# 원인을 엉뚱한 데서 찾게 된다. 그래서 autoremove 도 쓰지 않는다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg ca-certificates unixodbc \
 && curl -sSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 libgssapi-krb5-2 \
 && apt-get purge -y curl gnupg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      "pymysql==1.1.1" "cryptography>=42" "psycopg[binary]==3.2.3" "pyodbc==5.2.0"

WORKDIR /app
COPY generate.py /app/generate.py
CMD ["python", "-u", "/app/generate.py"]
