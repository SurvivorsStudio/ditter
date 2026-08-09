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
