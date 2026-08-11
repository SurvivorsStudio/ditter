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
 * 파일이 스스로 트랜잭션을 다루는 것을 막는다 (backend/migrations/README.md 규칙 4).
 *
 * runMigrations 이 기동 전체를 하나의 트랜잭션으로 감싸므로, 파일 안에서 그 트랜잭션을 끝내면
 * 뒤따르는 문장과 적용 기록이 트랜잭션 밖으로 새어 나간다 — 되돌릴 수 없게 되고, 실패했는데도
 * 적용된 것으로 기록되는 상태가 남는다. 문서로만 금지하면 지켜졌는지 아무도 확인하지 않는다.
 *
 * 단독 `END` 도 막는다 — SQLite 에서 `COMMIT` 과 **같은 뜻**이다. 다만 트리거 본문을 닫는 `END`
 * 가 같은 모양이라, 지금 트리거 본문 안인지를 기억하며 트리거 **밖에** 홀로 선 것만 고른다
 * (findTransactionControl). 예전에는 그 둘을 구분할 수 없어 단독 `END` 를 통째로 뺐는데, 그래서
 * 파일 안의 `END;` 한 줄이 바깥 트랜잭션을 끝내고도 검사를 통과했다 — 뒤 파일이 실패해도 앞
 * 내용이 남고, 실패한 마이그레이션이 적용된 것으로 기록됐다. 이 검사가 막으려던 상황 그 자체다.
 *
 * 아래 패턴들은 sticky(`y`) 라 statementStarts 가 알려준 **문장 맨 앞에서만** 맞춰본다.
 */
const TRANSACTION_CONTROL_PATTERN =
  /(BEGIN|COMMIT|END\s+TRANSACTION|ROLLBACK|SAVEPOINT|RELEASE)\b/iy;

/**
 * 키워드 사이에 올 수 있는 것 — 공백과 주석.
 *
 * 세 갈래 모두 **어느 위치에서든 맞는 방법이 하나뿐**이어야 한다. 그렇지 않으면 뒤따르는
 * `TRIGGER` 가 안 맞을 때(`CREATE … TABLE` 처럼 흔한 경우다) 정규식이 가능한 조합을 전부
 * 되짚어보며 폭주한다. 블록 주석 안을 게으른 `[\s\S]*?` 로 두면 그 자리에서 끝낼 수도, 뒤의
 * 닫는 기호를 넘어 다음 주석까지 삼킬 수도 있어 경우의 수가 주석 개수만큼 생기고, 바깥 `+` 와
 * 곱해져 사실상 멈춘다 — `CREATE` 뒤에 주석 5000개를 둔 파일이 끝나지 않았다. 그래서 별표를
 * 만나되 닫는 기호는 아닐 때만 넘어가는 형태로 적어 갈림길을 없앤다. 한 줄 주석도 `[^\n]` 이
 * 줄을 못 넘고 `\n` 이 필수라 같은 성질을 갖는다.
 */
const KEYWORD_GAP = String.raw`(?:\s|--[^\n]*\n|/\*(?:[^*]|\*(?!/))*\*/)+`;

/**
 * 트리거를 만드는 문장의 머리. 이 문장 다음부터 트리거 본문으로 본다.
 *
 * `IF NOT EXISTS` 는 `TRIGGER` **뒤에** 오므로 여기서 볼 것이 없다.
 */
const TRIGGER_HEAD_PATTERN = new RegExp(
  `CREATE${KEYWORD_GAP}(?:(?:TEMP|TEMPORARY)${KEYWORD_GAP})?TRIGGER\\b`,
  'iy',
);

/** 트리거 본문 안에서는 본문을 닫는 `END`, 밖에서는 `COMMIT` 인 `END`. */
const END_PATTERN = /END\b/iy;

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
const NO_EFFECT_IN_TRANSACTION_PATTERN =
  /(VACUUM|PRAGMA\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?foreign_keys)\b/iy;

/** 여는 기호 → 닫는 기호. SQLite 가 인정하는 문자열·식별자 인용 방식 전부다. */
const QUOTE_PAIRS: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' };

/**
 * **실행되는 문장이 시작되는 위치**만 모은다.
 *
 * 위 두 검사가 문장 맨 앞만 보는 이유는 `CREATE TRIGGER ... FOR EACH ROW BEGIN ... END` 를 막지
 * 않기 위해서다 — 트리거 본문의 `BEGIN` 은 문장 중간에 온다.
 *
 * 정규식으로 `;` 를 찾아 문장 경계로 삼던 방식을 버리고 한 번 훑는 방식으로 바꿨다. 정규식은
 * **주석과 문자열 안에 있는 `;` 도 문장 경계로 셌기 때문**이다. 그래서 금지어를 왜 쓰면 안 되는지
 * 적어둔 주석 한 줄(`-- BEGIN; COMMIT 을 파일에 쓰지 않는다`)이나, 값에 세미콜론이 들어간
 * INSERT(`VALUES ('a; ROLLBACK')`) 가 기동을 막았다. 러너의 오류 메시지와 README 규칙 4 가 그
 * 단어들을 그대로 언급하니 주석에 옮겨 적기 쉬운 말이고, 실제로 밟기 쉬운 경로였다.
 *
 * 여기서는 지금 주석 안인지 인용부호 안인지를 기억하며 지나가므로 그 구간의 `;` 는 세지 않는다.
 * 작은따옴표·큰따옴표·백틱은 같은 기호를 두 번 써서 이스케이프하는 SQLite 규칙(`'it''s'`)을
 * 따르고, 대괄호 식별자에는 이스케이프가 없다. 닫히지 않은 구간은 파일 끝까지로 본다 — 어차피
 * 적용할 때 SQLite 가 문법 오류로 잡는다.
 */
function statementStarts(sql: string): number[] {
  const starts: number[] = [];
  let expectingStart = true;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index]!;

    if (char === '-' && sql[index + 1] === '-') {
      const lineEnd = sql.indexOf('\n', index);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      const commentEnd = sql.indexOf('*/', index + 2);
      index = commentEnd === -1 ? sql.length : commentEnd + 2;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === ';') {
      expectingStart = true;
      index += 1;
      continue;
    }

    if (expectingStart) {
      starts.push(index);
      expectingStart = false;
    }

    const closer = QUOTE_PAIRS[char];
    index = closer === undefined ? index + 1 : skipQuoted(sql, index, closer);
  }

  return starts;
}

/** 인용 구간의 **끝 다음** 위치를 돌려준다. */
function skipQuoted(sql: string, openIndex: number, closer: string): number {
  let index = openIndex + 1;
  while (index < sql.length) {
    if (sql[index] === closer) {
      // 같은 기호가 붙어 나오면 닫은 것이 아니라 이스케이프다 (`'it''s'`). 대괄호는 해당 없다.
      if (closer !== ']' && sql[index + 1] === closer) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

/** 이 문장 맨 앞에 걸린 키워드를 오류 메시지에 쓸 형태로 돌려준다. */
function matchKeywordAt(sql: string, start: number, pattern: RegExp): string | null {
  pattern.lastIndex = start;
  const match = pattern.exec(sql);
  return match === null ? null : match[1]!.replace(/\s+/g, ' ').toUpperCase();
}

/** 이 문장 맨 앞에 패턴이 맞는지만 본다. */
function matchesAt(sql: string, start: number, pattern: RegExp): boolean {
  pattern.lastIndex = start;
  return pattern.test(sql);
}

/** 문장 맨 앞에 걸린 첫 금지 키워드를 오류 메시지에 쓸 형태로 돌려준다. */
function findStatementKeyword(sql: string, pattern: RegExp): string | null {
  for (const start of statementStarts(sql)) {
    const keyword = matchKeywordAt(sql, start, pattern);
    if (keyword !== null) return keyword;
  }
  return null;
}

/**
 * 트랜잭션 제어문을 찾는다. 단독 `END` 는 **트리거 본문 밖**에 있을 때만 걸린다.
 *
 * 트리거 본문 안의 문장들도 statementStarts 에 잡힌다 — 본문의 `;` 뒤가 새 문장 시작이 되기
 * 때문이다. 그래도 검사는 문장 **맨 앞**만 보므로 `SELECT RAISE(ROLLBACK, …)` 같은 본문 문장은
 * 걸리지 않는다. 본문 맨 앞에 진짜 트랜잭션 제어문이 오는 것은 유효한 SQL 이 아니라, 그대로
 * 막아도 쓸 수 있는 문장을 잃지 않는다.
 *
 * 트리거가 닫히지 않은 채 파일이 끝나면 그 상태로 끝난다. 문장 목록이 유한하므로 더 볼 것이
 * 없고, 그런 파일은 어차피 적용할 때 SQLite 가 문법 오류로 잡는다.
 */
function findTransactionControl(sql: string): string | null {
  let insideTrigger = false;

  for (const start of statementStarts(sql)) {
    // 트리거 안이든 밖이든 `COMMIT`·`BEGIN` 같은 것은 그대로 막는다. 여기를 트리거 상태에
    // 걸어두면 트리거 머리를 잘못 읽은 순간 진짜 제어문까지 함께 놓친다.
    const keyword = matchKeywordAt(sql, start, TRANSACTION_CONTROL_PATTERN);
    if (keyword !== null) return keyword;

    if (insideTrigger) {
      if (matchesAt(sql, start, END_PATTERN)) insideTrigger = false;
      continue;
    }
    if (matchesAt(sql, start, TRIGGER_HEAD_PATTERN)) {
      insideTrigger = true;
      continue;
    }
    if (matchesAt(sql, start, END_PATTERN)) return 'END';
  }

  return null;
}

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
  const keyword = findTransactionControl(sql);
  if (keyword === null) return;

  // `END` 만으로도 걸리는 이유는 한 번 더 짚어준다 — 트랜잭션 제어문으로 읽히지 않는 모양이라
  // 메시지에 키워드만 적어두면 왜 멈췄는지 알기 어렵다.
  const hint =
    keyword === 'END'
      ? ` 단독 END 는 SQLite 에서 COMMIT 과 같은 뜻입니다 — 트리거 본문을 닫는 END 는 걸리지 않습니다.`
      : '';

  throw new Error(
    `마이그레이션 파일 안에서 트랜잭션을 직접 다루면 안 됩니다: ${name} (${keyword}). ` +
      `적용하는 쪽이 파일 전체를 하나의 트랜잭션으로 감쌉니다 — 파일이 트랜잭션을 끝내면 ` +
      `되돌릴 수 없게 되고, 실패한 마이그레이션이 적용된 것으로 기록됩니다.${hint}`,
  );
}

function assertNoStatementWithoutEffect(name: string, sql: string): void {
  const keyword = findStatementKeyword(sql, NO_EFFECT_IN_TRANSACTION_PATTERN);
  if (keyword === null) return;

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
