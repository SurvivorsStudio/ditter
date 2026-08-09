import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * DITTER 의 로컬 메타 저장소(SQLite)를 연다.
 *
 * 스키마는 `docs/schema` 에 있다. **대상 PostgreSQL 이 아니다** — 그쪽은 DITTER 가 읽기만 하고
 * 스키마를 만들지 않는다.
 *
 * 외부 의존성을 쓰지 않고 Node 내장 `node:sqlite` 를 쓴다. 백엔드를 빌드 없이 실행하는 것과 같은
 * 이유이며(`docs/policy/supply-chain-security.md`), 드라이버가 반환하는 행이 null-prototype 이라
 * `__proto__` 오염 경로가 하나 줄어드는 것도 이 선택에 맞는다.
 */
export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  applyPragmas(db);
  return db;
}

/**
 * 백엔드와 워커가 **같은 파일을 공유**하는 것이 전제라, 아래 두 PRAGMA 는 선택이 아니다
 * (`docs/schema/README.md`, `docs/pipeline/README.md` 「메타 저장을 SQLite 로 두는 것의 한계」).
 */
function applyPragmas(db: DatabaseSync): void {
  // 읽는 쪽과 쓰는 쪽이 서로를 막지 않게 한다. 기본 journal 모드로는 워커가 상태를 갱신하는
  // 동안 백엔드의 조회가 통째로 막힌다.
  db.exec('PRAGMA journal_mode = WAL');

  // 그래도 쓰기끼리는 경합한다. 즉시 SQLITE_BUSY 로 죽는 대신 잠시 기다린다.
  db.exec('PRAGMA busy_timeout = 5000');

  // SQLite 는 외래키를 접속마다 켜야 한다. 끄면 docs/schema 의 관계가 문서상으로만 존재한다.
  db.exec('PRAGMA foreign_keys = ON');
}
