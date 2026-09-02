/** 허용 명령 칩 (api/statements.ts). 칩 옆 짧은 말과 툴팁 한 문장. */
export const statements = {
  'stmt.select.hint': ['조회', 'Read'],
  'stmt.insert.hint': ['행 추가', 'Insert rows'],
  'stmt.update.hint': ['행 수정', 'Update rows'],
  'stmt.delete.hint': ['행 삭제', 'Delete rows'],
  'stmt.merge.hint': ['수정+추가', 'Upsert'],
  'stmt.create.hint': ['생성', 'Create'],
  'stmt.alter.hint': ['스키마 변경', 'Alter schema'],
  'stmt.drop.hint': ['테이블 삭제', 'Drop tables'],
  'stmt.truncate.hint': ['전체 삭제', 'Truncate'],

  'stmt.select.detail': ['데이터를 읽습니다.', 'Reads data.'],
  'stmt.insert.detail': ['테이블에 행을 추가합니다.', 'Adds rows to a table.'],
  'stmt.update.detail': ['기존 행의 값을 바꿉니다.', 'Changes values of existing rows.'],
  'stmt.delete.detail': [
    '조건에 맞는 행을 지웁니다 — 되돌릴 수 없습니다.',
    'Deletes matching rows — irreversible.',
  ],
  'stmt.merge.detail': [
    '키가 있으면 수정하고 없으면 추가합니다 (upsert).',
    'Updates when the key exists, inserts otherwise (upsert).',
  ],
  'stmt.create.detail': ['테이블·인덱스 등을 만듭니다.', 'Creates tables, indexes, etc.'],
  'stmt.alter.detail': [
    '테이블 구조를 바꿉니다 — 기존 파이프라인이 깨질 수 있습니다.',
    'Changes table structure — existing pipelines may break.',
  ],
  'stmt.drop.detail': [
    '테이블을 통째로 지웁니다 — 되돌릴 수 없습니다.',
    'Drops whole tables — irreversible.',
  ],
  'stmt.truncate.detail': [
    '테이블의 모든 행을 지웁니다 — 되돌릴 수 없습니다.',
    'Removes every row in a table — irreversible.',
  ],

  'stmt.mutedRun': [
    '{stmt} 를 꺼 두었습니다 — 실행하지 않았습니다. 상단의 {stmt} 태그를 눌러 다시 켜세요.',
    '{stmt} is muted — nothing was executed. Click the {stmt} tag above to re-enable it.',
  ],
} as const
