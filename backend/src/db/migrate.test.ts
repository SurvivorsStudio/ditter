import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { runMigrations } from './migrate.ts';
import { openDatabase } from './sqlite.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ditter-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String((row as { name: unknown }).name));
}

test('마이그레이션을 번호 순서대로 적용한다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '002_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)',
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
  });

  expect(runMigrations(db, dir)).toEqual(['001_create-a.sql', '002_create-b.sql']);
  expect(tableNames(db)).toContain('a');
  expect(tableNames(db)).toContain('b');
});

test('두 번째 기동에서는 아무것도 다시 적용하지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({ '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });

  runMigrations(db, dir);

  // 다시 돌면 CREATE TABLE 이 중복으로 실패한다 — 통과한다는 것 자체가 건너뛰었다는 증거다.
  expect(runMigrations(db, dir)).toEqual([]);
});

test('새로 추가된 마이그레이션만 이어서 적용한다', () => {
  const db = openDatabase(':memory:');
  const first = migrationsDir({ '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });
  runMigrations(db, first);

  const second = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
    '002_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)',
  });
  expect(runMigrations(db, second)).toEqual(['002_create-b.sql']);
});

test('실패한 마이그레이션은 통째로 취소되고 기록도 남지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_broken.sql': 'CREATE TABLE ok (id INTEGER PRIMARY KEY); CREATE TABLE ok (id INTEGER);',
  });

  expect(() => runMigrations(db, dir)).toThrow(/001_broken\.sql/);
  // 앞 문장이 만든 테이블까지 되돌아가야 한다. 남으면 다음 기동에서 다시 실패한다.
  expect(tableNames(db)).not.toContain('ok');
  expect(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toMatchObject({ c: 0 });
});

test('번호가 겹치면 기동을 멈춘다 — 사람마다 적용 순서가 갈리는 경로다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
    '001_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)',
  });

  expect(() => runMigrations(db, dir)).toThrow(/번호가 겹칩니다/);
});

test('이름 규칙에 맞지 않는 .sql 은 조용히 건너뛰지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({ 'create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });

  expect(() => runMigrations(db, dir)).toThrow(/이름 규칙/);
});

test('로컬 DB 가 저장소보다 앞서 있으면 멈춘다', () => {
  const db = openDatabase(':memory:');
  const ahead = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
    '002_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)',
  });
  runMigrations(db, ahead);

  const behind = migrationsDir({ '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });
  expect(() => runMigrations(db, behind)).toThrow(/앞서 있습니다/);
});

test('머지로 끼어든 앞 번호 마이그레이션을 그냥 적용하지 않는다', () => {
  const db = openDatabase(':memory:');
  const before = migrationsDir({ '002_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)' });
  runMigrations(db, before);

  const merged = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
    '002_create-b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY)',
  });
  expect(() => runMigrations(db, merged)).toThrow(/순서를 건너뛴/);
});

test('마이그레이션 디렉터리가 없어도 기동을 막지 않는다', () => {
  const db = openDatabase(':memory:');

  expect(runMigrations(db, join(tmpdir(), 'ditter-does-not-exist'))).toEqual([]);
});

test('파일 안에서 트랜잭션을 직접 다루면 기동을 멈춘다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\nCOMMIT;',
  });

  // 그대로 두면 COMMIT 이 바깥 트랜잭션을 끝내버려, 실패한 마이그레이션이 적용된 것으로
  // 기록되고 되돌리기마저 불가능해진다.
  expect(() => runMigrations(db, dir)).toThrow(/트랜잭션을 직접 다루면 안 됩니다.*COMMIT/s);
  expect(tableNames(db)).not.toContain('a');
  expect(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toMatchObject({ c: 0 });
});

test('주석 뒤에 숨은 트랜잭션 제어문도 잡는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': '-- 여기서부터 직접 감싼다\nBEGIN;\nCREATE TABLE a (id INTEGER);',
  });

  expect(() => runMigrations(db, dir)).toThrow(/트랜잭션을 직접 다루면 안 됩니다.*BEGIN/s);
});

test('트리거의 BEGIN … END 는 막지 않는다 — 트랜잭션 제어가 아니다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_trigger.sql': `
      CREATE TABLE a (id INTEGER PRIMARY KEY, touched_at TEXT);
      CREATE TRIGGER a_touch AFTER INSERT ON a
      FOR EACH ROW
      BEGIN
        UPDATE a SET touched_at = 'now' WHERE id = NEW.id;
      END;
    `,
  });

  expect(runMigrations(db, dir)).toEqual(['001_trigger.sql']);
  db.prepare('INSERT INTO a (id) VALUES (1)').run();
  expect(db.prepare('SELECT touched_at FROM a WHERE id = 1').get()).toMatchObject({
    touched_at: 'now',
  });
});

test('VACUUM 은 기동을 멈춘다 — 트랜잭션 안에서는 실행 자체가 막힌다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\nVACUUM;',
  });

  // 그냥 두면 `cannot VACUUM from within a transaction` 이 나는데, 그 메시지는 러너가 감싼
  // 트랜잭션을 가리키지 않아 파일 쪽 문제로 오해하게 된다.
  expect(() => runMigrations(db, dir)).toThrow(/효과가 없는 문장입니다.*VACUUM/s);
});

test('PRAGMA foreign_keys 는 기동을 멈춘다 — 조용히 무시되는 쪽이라 더 위험하다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': 'PRAGMA foreign_keys = OFF;\nCREATE TABLE a (id INTEGER PRIMARY KEY);',
  });

  // 트랜잭션 안에서는 오류 없이 무시된다. 껐다고 믿은 채 뒤따르는 문장이 돌면 엉뚱한 외래키
  // 오류가 나고, 원인이 이 한 줄이라는 것을 알아채기 어렵다.
  expect(() => runMigrations(db, dir)).toThrow(/효과가 없는 문장입니다.*PRAGMA FOREIGN_KEYS/s);
});

test('트랜잭션 안에서 정상 동작하는 다른 PRAGMA 는 막지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': 'PRAGMA user_version = 3;\nCREATE TABLE a (id INTEGER PRIMARY KEY);',
  });

  expect(runMigrations(db, dir)).toEqual(['001_x.sql']);
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
});

// 아래 세 개는 검사기가 **주석 본문**을 실행되는 문장으로 착각하지 않는지 본다. 금지어를 왜
// 쓰면 안 되는지 주석으로 적어두는 것은 마이그레이션에서 자연스러운 일이고(README 규칙 4 와
// 러너의 오류 메시지가 그 단어들을 그대로 언급한다), 그때마다 백엔드가 뜨지 못하면 안 된다.

test('주석 안에 적힌 VACUUM 은 막지 않는다 — 실행되는 문장이 아니다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': '-- VACUUM 은 러너가 막는다\nCREATE TABLE a (id INTEGER PRIMARY KEY);',
  });

  expect(runMigrations(db, dir)).toEqual(['001_x.sql']);
});

test('주석 안에 적힌 PRAGMA foreign_keys 도 막지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': '-- PRAGMA foreign_keys 는 트랜잭션 안이라 무시된다\nCREATE TABLE a (id INTEGER);',
  });

  expect(runMigrations(db, dir)).toEqual(['001_x.sql']);
});

test('세미콜론 뒤에 오는 주석 안의 금지어도 막지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql':
      'CREATE TABLE a (id INTEGER PRIMARY KEY);\n-- 참고: VACUUM 은 여기서 못 쓴다\nCREATE TABLE b (id INTEGER);',
  });

  expect(runMigrations(db, dir)).toEqual(['001_x.sql']);
  expect(tableNames(db)).toContain('b');
});

test('이름 안에 키워드가 들어간 컬럼은 막지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_x.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY, rollback_at TEXT, begin_at TEXT)',
  });

  expect(runMigrations(db, dir)).toEqual(['001_x.sql']);
});

test('뒤 파일이 실패하면 앞 파일까지 통째로 취소된다 — 기동 하나가 한 트랜잭션이다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({
    '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
    '002_broken.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)',
  });

  expect(() => runMigrations(db, dir)).toThrow(/002_broken\.sql/);
  // 앞 파일만 적용된 채로 남으면, 고쳐서 다시 띄울 때 001 이 이미 반영된 상태와 부딪힌다.
  expect(tableNames(db)).not.toContain('a');
  expect(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toMatchObject({ c: 0 });
});

test('실패한 원래 오류가 되돌리기 오류에 덮이지 않는다', () => {
  const db = openDatabase(':memory:');
  const dir = migrationsDir({ '001_broken.sql': 'SELECT this_is_not_valid_sql(' });

  // `cannot rollback - no transaction is active` 같은 SQLite 메시지가 아니라, 어느 파일에서
  // 왜 실패했는지가 그대로 나와야 한다.
  expect(() => runMigrations(db, dir)).toThrow(/마이그레이션 적용 실패: 001_broken\.sql/);
});

test('실패해도 트랜잭션이 열린 채 남지 않는다', () => {
  const db = openDatabase(':memory:');
  const broken = migrationsDir({ '001_broken.sql': 'SELECT this_is_not_valid_sql(' });
  expect(() => runMigrations(db, broken)).toThrow();

  // 열린 트랜잭션이 남아 있으면 다음 기동이 `cannot start a transaction within a transaction`
  // 으로 죽는다 — 실패를 고쳐도 프로세스를 새로 띄우기 전까지 회복되지 않는다는 뜻이다.
  const fixed = migrationsDir({ '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });
  expect(runMigrations(db, fixed)).toEqual(['001_create-a.sql']);
});

test('적용을 마친 뒤 잠금을 남기지 않아 다음 접속이 이어받는다', () => {
  // 백엔드와 워커가 같은 파일을 공유하는 것이 전제다(sqlite.ts). 앞선 쪽이 쓰기 잠금을 붙잡은
  // 채로 끝나면 뒤에 오는 쪽은 기동조차 못 한다.
  const dir = migrationsDir({ '001_create-a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY)' });
  const file = join(dir, 'shared.sqlite');

  const first = openDatabase(file);
  expect(runMigrations(first, dir)).toEqual(['001_create-a.sql']);

  const second = openDatabase(file);
  expect(runMigrations(second, dir)).toEqual([]);
  expect(tableNames(second)).toContain('a');

  first.close();
  second.close();
});
