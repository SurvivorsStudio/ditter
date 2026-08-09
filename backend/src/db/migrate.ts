import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * 번호를 매긴 SQL 파일을 순서대로 한 번씩 적용한다.
 *
 * 팀원끼리 "테이블 상황"을 맞추는 장치가 이것 하나다. 로컬 SQLite 파일은 커밋되지 않으므로
 * (`.gitignore`), 각자 백엔드를 기동하면 자기 파일이 저장소의 마이그레이션 목록까지 따라온다.
 * 주고받을 것도, 손으로 칠 DDL 도 없다.
 *
 * 어긋난 상태는 **조용히 넘어가지 않고 기동을 멈춘다.** 로컬 DB 는 언제든 버릴 수 있는 파일이라
 * (지우고 다시 기동하면 끝) 애매하게 굴러가는 것보다 멈추는 편이 싸다.
 */

const FILE_NAME_PATTERN = /^(\d{3,})_[a-z0-9-]+\.sql$/;

export function runMigrations(db: DatabaseSync, migrationsDir: string): string[] {
  ensureMigrationTable(db);

  const available = readMigrationFiles(migrationsDir);

  // 무엇을 적용할지 정하는 것과 실제로 적용하는 것을 **같은 트랜잭션 안에** 둔다. 밖에서 읽고
  // 안에서 쓰면 그 사이가 비는데, 백엔드와 워커는 같은 파일을 공유하는 것이 전제라(sqlite.ts)
  // 둘이 비슷한 시점에 기동하면 양쪽 다 같은 파일을 "아직 안 됐다"고 판단해 각자 적용한다.
  //
  // `BEGIN` 이 아니라 `BEGIN IMMEDIATE` 인 이유: 기본값(deferred)은 첫 쓰기 시점에야 잠금을
  // 잡으러 가는데, 그 사이 다른 쪽이 커밋했으면 SQLite 는 busy_timeout 을 기다려주지 않고 곧바로
  // 실패한다. 처음부터 쓰기 잠금을 잡아야 뒤에 온 쪽이 busy_timeout(5초, sqlite.ts) 만큼 기다린
  // 뒤, 앞선 쪽이 남긴 결과를 아래 readAppliedNames 에서 실제로 다시 읽게 된다.
  db.exec('BEGIN IMMEDIATE');
  try {
    const applied = readAppliedNames(db);
    assertConsistent(available, applied);

    const pending = available.filter((file) => !applied.includes(file.name));
    for (const file of pending) {
      applyOne(db, file);
    }

    db.exec('COMMIT');
    return pending.map((file) => file.name);
  } catch (cause) {
    rollbackQuietly(db);
    throw cause;
  }
}

/**
 * 되돌리기가 실패해도 **원래 오류를 덮지 않는다.**
 *
 * `catch` 안에서 그냥 `ROLLBACK` 을 부르면, 되돌릴 트랜잭션이 이미 없을 때 그 자체가 예외를
 * 던져 진짜 원인을 밀어낸다. 그러면 어느 파일에서 왜 실패했는지가 사라지고
 * `cannot rollback - no transaction is active` 한 줄만 남는다.
 */
function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // 되돌릴 것이 없다는 뜻이다. 알릴 내용이 아니라 삼킨다 — 알려야 할 것은 바깥의 원래 오류다.
  }
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

type MigrationFile = { name: string; order: number; sql: string };

/**
 * 내용까지 여기서 미리 읽는다. 트랜잭션을 연 뒤에 파일을 읽으면, 읽기가 실패하는 동안 쓰기 잠금을
 * 붙잡고 있게 된다.
 */
function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!existsSync(migrationsDir)) return [];

  const files: MigrationFile[] = [];
  for (const name of readdirSync(migrationsDir)) {
    if (!name.endsWith('.sql')) continue;

    const match = FILE_NAME_PATTERN.exec(name);
    if (match === null) {
      throw new Error(
        `마이그레이션 파일 이름 규칙에 맞지 않습니다: ${name} (예: 001_create-connections.sql)`,
      );
    }
    files.push({
      name,
      order: Number(match[1]),
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    });
  }

  files.sort((a, b) => a.order - b.order);
  assertNoDuplicateOrder(files);
  return files;
}

/**
 * 두 사람이 각자 브랜치에서 같은 번호를 쓰고 머지하면 적용 순서가 파일 이름에 따라 갈린다 —
 * 사람마다 다른 스키마가 나오는 가장 흔한 경로다. 머지 직후 기동에서 바로 잡는다.
 */
function assertNoDuplicateOrder(files: MigrationFile[]): void {
  for (let i = 1; i < files.length; i += 1) {
    const previous = files[i - 1]!;
    const current = files[i]!;
    if (previous.order === current.order) {
      throw new Error(
        `마이그레이션 번호가 겹칩니다: ${previous.name} · ${current.name}. ` +
          `나중에 만든 쪽의 번호를 뒤로 밀어 이름을 바꾸세요.`,
      );
    }
  }
}

function readAppliedNames(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
  return rows.map((row) => String((row as { name: unknown }).name));
}

function assertConsistent(available: MigrationFile[], applied: string[]): void {
  // 내 DB 에만 있고 저장소에는 없는 마이그레이션 — 보통 최신 브랜치에서 기동해 본 뒤 예전
  // 브랜치로 돌아온 경우다. 이 상태로 두면 코드보다 앞선 스키마 위에서 개발하게 된다.
  const names = new Set(available.map((file) => file.name));
  const unknown = applied.filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `로컬 DB 가 저장소보다 앞서 있습니다 (적용됐지만 파일이 없음: ${unknown.join(', ')}). ` +
        `브랜치를 확인하거나, 로컬 DB 파일을 지우고 다시 기동하세요.`,
    );
  }

  // 이미 적용한 것보다 앞 번호가 새로 나타난 경우 — 머지로 끼어든 마이그레이션이다. 그냥
  // 적용하면 내 DB 의 적용 순서가 남들과 달라진다.
  const highestApplied = available
    .filter((file) => applied.includes(file.name))
    .reduce((max, file) => Math.max(max, file.order), 0);
  const outOfOrder = available.filter(
    (file) => !applied.includes(file.name) && file.order < highestApplied,
  );
  if (outOfOrder.length > 0) {
    throw new Error(
      `순서를 건너뛴 마이그레이션이 있습니다 (${outOfOrder.map((file) => file.name).join(', ')}). ` +
        `로컬 DB 파일을 지우고 다시 기동하면 처음부터 순서대로 적용됩니다.`,
    );
  }
}

/**
 * 트랜잭션은 열지 않는다 — runMigrations 이 이번 기동 전체를 하나로 감싼다. 그래서 한 파일이
 * 절반만 적용되는 일도, 앞 파일만 적용된 채 뒤 파일에서 멈추는 일도 없다.
 */
function applyOne(db: DatabaseSync, file: MigrationFile): void {
  try {
    db.exec(file.sql);
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
      file.name,
      new Date().toISOString(),
    );
  } catch (cause) {
    throw new Error(`마이그레이션 적용 실패: ${file.name}`, { cause });
  }
}
