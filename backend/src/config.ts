/** 프로세스 경계에서 환경변수를 읽어 내부 타입으로 좁힌다. */

export type ServerConfig = {
  host: string;
  port: number;
};

export function readServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    // 컨테이너 안에서는 0.0.0.0 으로 바인딩해야 외부에서 접근된다.
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT) ?? 4000,
  };
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 가 올바른 포트 번호가 아닙니다: ${value}`);
  }
  return port;
}
