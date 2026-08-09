/** 프로세스 경계에서 환경변수를 읽어 내부 타입으로 좁힌다. */

import { join } from 'node:path';

export type ServerConfig = {
  host: string;
  port: number;
};

export type DatabaseConfig = {
  /** 로컬 메타 저장소(SQLite) 파일 경로. 대상 PostgreSQL 이 아니다. */
  file: string;
  /** 기동할 때 적용할 마이그레이션 SQL 이 있는 디렉터리. */
  migrationsDir: string;
};

export function readServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    // 기본값은 루프백이다. 인증은 STEP 8 에서야 붙으므로, 같은 네트워크에 노출하는 선택은
    // 기본값이 아니라 명시적 설정이어야 한다. 컨테이너는 docker-compose.yml 의 backend
    // 서비스가 HOST=0.0.0.0 을 직접 지정한다.
    host: readEnv(env.HOST) ?? '127.0.0.1',
    port: parsePort(readEnv(env.PORT)) ?? 4000,
  };
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  // 기본 경로는 cwd 가 아니라 이 파일 위치를 기준으로 잡는다. 백엔드는 루트에서
  // (`npm run dev --workspace=backend`) 도, backend/ 안에서도 실행되기 때문에 cwd 기준으로
  // 두면 사람마다 다른 파일을 열게 된다.
  //
  // `backend/` 아래에 두는 이유는 컨테이너에 bind mount 되는 경로가 여기라서다
  // (docker-compose.yml). 저장소 루트에 두면 컨테이너 안에만 생겼다가 재생성 때 사라진다.
  const backendDir = join(import.meta.dirname, '..');

  return {
    file: readEnv(env.DITTER_SQLITE_PATH) ?? join(backendDir, 'data', 'ditter.sqlite'),
    migrationsDir: readEnv(env.DITTER_MIGRATIONS_DIR) ?? join(backendDir, 'migrations'),
  };
}

/**
 * 빈 문자열은 "설정하지 않음"으로 취급한다. `.env` 에서 항목은 남기고 값만 지우는
 * (`HOST=`) 편집이 흔한데, 그대로 넘기면 Node 가 주소 미지정으로 보고 모든 인터페이스에
 * 바인딩한다 — 위의 루프백 기본값이 조용히 뒤집힌다.
 */
function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 가 올바른 포트 번호가 아닙니다: ${value}`);
  }
  return port;
}
