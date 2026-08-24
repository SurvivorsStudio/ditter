# Debezium 커넥터 설정 (참고용)

이 디렉터리의 `*.example.json` 은 **사람이 읽는 참고 자료**다. 실행 시점의 커넥터 설정은
API 가 `apps/api/src/eai_api/services/cdc_connect.py` 의 `build_connector_config()` 로
**코드에서 생성**해 Kafka Connect(:8083)에 등록한다.

코드로 만드는 이유:
- API 컨테이너 이미지는 `apps/…` 만 복사하므로 이 디렉터리를 런타임에 읽을 수 없다.
- 접속 정보·테이블 목록·삭제 처리 방식이 연결/노드 설정에서 와서 매 스트림마다 달라진다.

두 파일은 `build_connector_config()` 가 만들어내는 결과와 같은 모양이다 — 필드가 바뀌면
양쪽을 함께 고친다.

## 커넥터 이름·토픽 규칙
- 커넥터 이름: `eai.<stream_id>`
- topic.prefix: `eai_<stream_id>` (하이픈 → 언더스코어)
- 발행 토픽: `eai_<stream_id>.<schema_or_db>.<table>`

## 지원 소스
- **MySQL** (`mysql.example.json`) — binlog. `database.server.id` 필요.
- **PostgreSQL** (`postgres.example.json`) — 논리복제(pgoutput). slot·publication 스트림별 유일.
- **SQL Server / MSSQL** (`mssql.example.json`) — `database.names`(복수) 사용, 스키마 이력 토픽 필요.
  기본 스키마는 `dbo`. `never` 스냅샷은 SQL Server 에 없어 `no_data` 로 대체된다.
  - **전제조건**: 소스에서 **SQL Server Agent 실행** + `sys.sp_cdc_enable_db` +
    테이블별 `sys.sp_cdc_enable_table` 로 CDC 를 미리 켜야 한다. (운영 설정이라 코드가 강제하지 않음)
  - 사내 자체서명 인증서: `database.encrypt`(연결 SSL 플래그) + `database.trustServerCertificate`(연결 '서버 인증서 신뢰')로 조정.

## 삭제 처리 (기획안 §5.2)
`ExtractNewRecordState` SMT 의 `delete.handling.mode` 로 표현한다.
- `soft`(기본): `rewrite` — 삭제된 행을 `__deleted=true` 로 남긴다
- `hard`: `none` — tombstone 을 흘려 Sink 가 실제 삭제하게 한다
- `ignore`: `drop` — 삭제 이벤트를 버린다
