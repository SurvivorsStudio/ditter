/** 노드 팔레트 카탈로그 — canvas/nodeCatalog.tsx 의 titleKey/hintKey 가 여기를 가리킨다.
 *
 *  title 은 팔레트 표시이자 **새 노드의 기본 이름 시드**다 (canvasStore.uniqueLabel).
 *  생성 시점의 언어로 이름이 박히고, 기존 파이프라인에 저장된 이름은 건드리지 않는다 —
 *  `${노드이름.컬럼}` 참조는 사용자가 화면에서 보는 그 라벨을 쓰므로 자기모순이 없다. */
export const nodes = {
  'nodeCategory.trigger': ['트리거', 'Triggers'],
  'nodeCategory.source': ['소스', 'Sources'],
  'nodeCategory.transform': ['변환', 'Transforms'],
  'nodeCategory.target': ['타깃', 'Targets'],
  'nodeCategory.note': ['주석', 'Notes'],

  'nodeGroup.cdc': ['실시간 (CDC)', 'Real-time (CDC)'],
  'nodeGroup.sync': ['실시간 동기화', 'Real-time sync'],

  'node.trigger.schedule.title': ['스케줄 (Cron)', 'Schedule (Cron)'],
  'node.trigger.schedule.hint': ['주기 실행', 'Periodic runs'],
  'node.trigger.manual.title': ['수동 실행', 'Manual run'],
  'node.trigger.manual.hint': ['버튼 트리거', 'Button trigger'],
  'node.trigger.api.title': ['API 호출', 'API call'],
  'node.trigger.api.hint': ['외부에서 값 받아 실행', 'Run with caller-supplied values'],
  'node.trigger.cdc.title': ['CDC 스트림', 'CDC stream'],
  'node.trigger.cdc.hint': ['상시 실시간 수집', 'Always-on real-time capture'],
  'node.trigger.sync.title': ['실시간 동기화', 'Real-time sync'],
  'node.trigger.sync.hint': ['원본 트리거로 상시 복제', 'Continuous replication via source triggers'],

  'node.source.mysql.title': ['MySQL', 'MySQL'],
  'node.source.mysql.hint': ['테이블 조회', 'Table reads'],
  'node.source.postgres.title': ['PostgreSQL', 'PostgreSQL'],
  'node.source.postgres.hint': ['테이블/쿼리', 'Table / query'],
  'node.source.mssql.title': ['MSSQL', 'MSSQL'],
  'node.source.mssql.hint': ['테이블/쿼리', 'Table / query'],
  'node.source.mongo.title': ['MongoDB', 'MongoDB'],
  'node.source.mongo.hint': ['컬렉션', 'Collections'],
  'node.source.sap.title': ['SAP (RFC)', 'SAP (RFC)'],
  'node.source.sap.hint': ['BAPI / RFC_READ', 'BAPI / RFC_READ'],
  'node.source.cdc.mysql.title': ['MySQL (CDC)', 'MySQL (CDC)'],
  'node.source.cdc.mysql.hint': ['binlog 실시간 변경', 'Real-time binlog changes'],
  'node.source.cdc.postgres.title': ['PostgreSQL (CDC)', 'PostgreSQL (CDC)'],
  'node.source.cdc.postgres.hint': ['WAL 논리복제', 'WAL logical replication'],
  'node.source.cdc.mssql.title': ['MSSQL (CDC)', 'MSSQL (CDC)'],
  'node.source.cdc.mssql.hint': ['SQL Server CDC', 'SQL Server CDC'],
  'node.source.sync.mssql.title': ['MSSQL (실시간 동기화)', 'MSSQL (real-time sync)'],
  'node.source.sync.mssql.hint': ['트리거 기반 · CDC 불필요', 'Trigger-based · no CDC required'],

  'node.transform.filter.title': ['필터', 'Filter'],
  'node.transform.filter.hint': ['조건 필터링', 'Conditional filtering'],
  'node.transform.map.title': ['필드 매핑', 'Field mapping'],
  'node.transform.map.hint': ['컬럼 변환', 'Column transforms'],
  'node.transform.python.title': ['Python 코드', 'Python code'],
  'node.transform.python.hint': ['전처리 스크립트', 'Preprocessing script'],
  'node.logic.switch.title': ['스위치', 'Switch'],
  'node.logic.switch.hint': ['조건 분기', 'Conditional branching'],

  'node.target.db.title': ['Target DB', 'Target DB'],
  'node.target.db.hint': ['Upsert 적재', 'Upsert load'],
  'node.target.mongo.title': ['MongoDB', 'MongoDB'],
  'node.target.mongo.hint': ['컬렉션 적재', 'Collection load'],
  'node.target.s3.title': ['Amazon S3', 'Amazon S3'],
  'node.target.s3.hint': ['Parquet 적재', 'Parquet load'],
  'node.target.file.title': ['로컬 파일', 'Local file'],
  'node.target.file.hint': ['테스트용 파일 저장', 'File output for testing'],
  'node.target.response.title': ['API 응답', 'API response'],
  'node.target.response.hint': ['호출자에게 결과 반환', 'Return results to the caller'],
  'node.target.sync.db.title': ['동기화 타깃 DB', 'Sync target DB'],
  'node.target.sync.db.hint': ['SymmetricDS 직송', 'Direct delivery via SymmetricDS'],

  'node.note.memo.title': ['메모', 'Memo'],
  'node.note.memo.hint': ['캔버스 주석 (실행 안 함)', 'Canvas note (not executed)'],
  'node.note.group.title': ['그룹 영역', 'Group frame'],
  'node.note.group.hint': ['노드를 사각형으로 묶어 구분', 'Box nodes together visually'],

  'node.paletteHeader': ['노드', 'Nodes'],
  'node.paletteDrag': ['{title} — 캔버스로 드래그하세요', '{title} — drag onto the canvas'],
  'node.switch.case': ['분기 {n}', 'Branch {n}'],
  'node.switch.default': ['그 외', 'Otherwise'],
  'node.defaultLabel': ['노드', 'Node'],

  /** Python 전처리 골격 — 생성 시점 언어로 코드에 박힌다 (nodeCatalog.defaultPycode). */
  'node.pycode.row': [
    `# 각 레코드(row: dict)를 받아 변환해 돌려줍니다.
# None 을 반환하면 그 행은 제외됩니다.
# pandas 사용 가능: import pandas as pd
# 그 외: datetime, re, json, math, hashlib, decimal, base64, uuid 등 (표준 모듈 일부)
def transform(row):
    return row
`,
    `# Receives each record (row: dict), transforms it, and returns it.
# Return None to drop the row.
# pandas is available: import pandas as pd
# Also: datetime, re, json, math, hashlib, decimal, base64, uuid, etc. (subset of stdlib)
def transform(row):
    return row
`,
  ],
  'node.pycode.batch': [
    `# 전체 행을 pandas DataFrame(df)으로 한 번에 받아 처리합니다.
# DataFrame 을 반환하세요 (groupby·정렬·중복제거 등).
import pandas as pd

def transform_batch(df):
    return df
`,
    `# Receives all rows at once as a pandas DataFrame (df).
# Return a DataFrame (groupby, sort, dedupe, ...).
import pandas as pd

def transform_batch(df):
    return df
`,
  ],
} as const
