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

/**
 * **문장 맨 앞** — 파일 처음이거나 `;` 뒤, 사이의 공백·주석은 건너뛴다.
 *
 * 아래 두 검사가 이 위치에 오는 것만 보는 이유는 `CREATE TRIGGER ... FOR EACH ROW BEGIN ... END`
 * 를 막지 않기 위해서다 — 트리거 본문의 `BEGIN` 은 문장 중간에 온다.
 */
const STATEMENT_START = String.raw`(?:^|;)(?:\s|--[^\n]*|/\*[\s\S]*?\*/)*`;

/**
 * 파일이 스스로 트랜잭션을 다루는 것을 막는다 (backend/migrations/README.md 규칙 4).
 *
 * runMigrations 이 기동 전체를 하나의 트랜잭션으로 감싸므로, 파일 안에서 그 트랜잭션을 끝내면
 * 뒤따르는 문장과 적용 기록이 트랜잭션 밖으로 새어 나간다 — 되돌릴 수 없게 되고, 실패했는데도
 * 적용된 것으로 기록되는 상태가 남는다. 문서로만 금지하면 지켜졌는지 아무도 확인하지 않는다.
 *
 * 트리거 끝의 `END` 는 트랜잭션 제어가 아니므로 `END` 단독은 대상에서 빼고 `END TRANSACTION`
 * 만 본다.
 */
const TRANSACTION_CONTROL_PATTERN = new RegExp(
  `${STATEMENT_START}(BEGIN|COMMIT|END\\s+TRANSACTION|ROLLBACK|SAVEPOINT|RELEASE)\\b`,
  'i',
);

/**
 * 같은 트랜잭션 때문에 **효과가 사라지는** 문장을 막는다.
 *
 * 위 트랜잭션 제어문과 달리 이쪽은 파일이 규칙을 어긴 것이 아니다. 트랜잭션 안이라 동작하지
 * 않을 뿐인데, 그 실패 방식이 서로 다르고 둘 다 사람을 속인다:
 *
 * - `VACUUM` — `cannot VACUUM from within a transaction` 으로 실패한다. 오류가 러너의 트랜잭션을
 *   가리키지 않아 파일 쪽 문제로 오해하기 쉽다.
 * - `PRAGMA foreign_keys` — **오류 없이 무시된다.** SQLite 가 권장하는 테이블 재구성 절차는
 *   `PRAGMA foreign_keys=off` 를 트랜잭션 **밖에서** 먼저 실행할 것을 요구하는데, 여기서는 그
 *   1단계가 조용히 넘어간다. 껐다고 믿은 채 뒤따르는 DROP TABLE 이 돌아 엉뚱한 외래키 오류가
 *   난다 — 원인을 찾기 가장 어려운 종류다.
 *
 * 그래서 조용한 실패를 기동 시점의 시끄러운 실패로 바꾼다. 이 모듈이 이미 택한 태도와 같다.
 *
 * `PRAGMA` 는 **`foreign_keys` 만** 겨냥한다. `PRAGMA user_version` 처럼 트랜잭션 안에서 정상
 * 동작하는 것까지 막으면 쓸 수 있는 문장을 괜히 잃는다.
 */
const NO_EFFECT_IN_TRANSACTION_PATTERN = new RegExp(
  `${STATEMENT_START}(VACUUM|PRAGMA\\s+(?:[a-z_][a-z0-9_]*\\s*\\.\\s*)?foreign_keys)\\b`,
  'i',
);

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
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    assertNoTransactionControl(name, sql);
    assertNoStatementWithoutEffect(name, sql);
    files.push({ name, order: Number(match[1]), sql });
  }

  files.sort((a, b) => a.order - b.order);
  assertNoDuplicateOrder(files);
  return files;
}

function assertNoTransactionControl(name: string, sql: string): void {
  const match = TRANSACTION_CONTROL_PATTERN.exec(sql);
  if (match === null) return;

  const keyword = match[1]!.replace(/\s+/g, ' ').toUpperCase();
  throw new Error(
    `마이그레이션 파일 안에서 트랜잭션을 직접 다루면 안 됩니다: ${name} (${keyword}). ` +
      `적용하는 쪽이 파일 전체를 하나의 트랜잭션으로 감쌉니다 — 파일이 트랜잭션을 끝내면 ` +
      `되돌릴 수 없게 되고, 실패한 마이그레이션이 적용된 것으로 기록됩니다.`,
  );
}

function assertNoStatementWithoutEffect(name: string, sql: string): void {
  const match = NO_EFFECT_IN_TRANSACTION_PATTERN.exec(sql);
  if (match === null) return;

  const keyword = match[1]!.replace(/\s+/g, ' ').toUpperCase();
  throw new Error(
    `트랜잭션 안에서는 효과가 없는 문장입니다: ${name} (${keyword}). ` +
      `기동 한 번에 적용되는 파일 전체가 하나의 트랜잭션이라, VACUUM 은 실행 자체가 막히고 ` +
      `PRAGMA foreign_keys 는 오류 없이 무시됩니다 — 껐다고 믿은 채 뒤따르는 문장이 그대로 돕니다. ` +
      `테이블을 재구성해야 한다면 외래키를 켠 채로, 참조하는 테이블까지 같은 파일 안에서 함께 옮기세요.`,
  );
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
