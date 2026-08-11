import { buildApp } from './app.ts';
import { readDatabaseConfig, readServerConfig } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { openDatabase } from './db/sqlite.ts';

const serverConfig = readServerConfig(process.env);
const databaseConfig = readDatabaseConfig(process.env);

// 스키마를 먼저 맞춘 뒤에 요청을 받는다. 어긋난 스키마 위에서 절반쯤 동작하는 것보다 기동이
// 실패하는 편이 낫다 — 로컬 DB 파일은 언제든 지우고 다시 만들 수 있다(backend/migrations/README.md).
const db = openDatabase(databaseConfig.file);
const applied = runMigrations(db, databaseConfig.migrationsDir);

// 적용 결과를 반드시 남긴다. 남의 마이그레이션이 내 DB 에 조용히 반영되면, 스키마가 언제 바뀌었는지
// 아무도 모르는 채로 데이터가 달라진다. `docker compose logs backend` 에서 바로 보이게 한다.
if (applied.length > 0) {
  console.log(`[migrate] ${applied.length}개 적용: ${applied.join(', ')}`);
}

const app = buildApp();

await app.listen({ host: serverConfig.host, port: serverConfig.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    db.close();
    void app.close();
  });
}
