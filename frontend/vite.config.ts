import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// 환경변수는 저장소 루트의 `.env` 에서 읽는다. Vite 는 기본적으로 이 설정 파일이 있는
// 디렉토리(frontend/)만 env 파일 후보로 보고, 거기서 읽은 `VITE_*` 값을 `process.env` 에
// 넣지도 않는다 — 그래서 `process.env.VITE_*` 로는 `.env` 의 값이 보이지 않는다.
// 백엔드는 `node --env-file-if-exists=../.env` 로 같은 파일을 읽으므로 여기서 대칭을 맞춘다.
const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * 빈 문자열은 "설정하지 않음"으로 취급한다. `.env` 에서 항목은 남기고 값만 지우는
 * (`VITE_DEV_HOST=`) 편집이 흔한데, 그대로 넘기면 dev 서버가 루프백이 아니라 모든
 * 인터페이스에 바인딩된다 — 기본값이 안전한 쪽으로 되돌아가야 한다.
 */
function readEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export default defineConfig(({ mode }) => {
  // loadEnv 는 파일에서 읽은 값을 먼저 넣고 실제 환경변수를 나중에 덮어쓴다. 그래서
  // docker-compose.yml 이 지정하는 VITE_DEV_HOST=0.0.0.0 이 `.env` 파일 값보다 우선한다.
  const env = loadEnv(mode, repoRoot, 'VITE_');

  return {
    plugins: [react()],
    // 클라이언트 코드의 `import.meta.env` 도 같은 파일을 보게 맞춘다 (`VITE_` 접두사만 노출된다).
    envDir: repoRoot,
    server: {
      // 기본값은 루프백이다. dev 서버는 아래 proxy 로 /api 를 백엔드에 그대로 넘기므로,
      // 여기를 열면 백엔드의 루프백 바인딩(backend/src/config.ts)까지 함께 우회된다.
      // 인증은 STEP 8 에서야 붙는다. 컨테이너는 docker-compose.yml 의 frontend 서비스가
      // VITE_DEV_HOST=0.0.0.0 을 직접 지정한다.
      host: readEnv(env.VITE_DEV_HOST) ?? '127.0.0.1',
      port: 5173,
      // 컨테이너에서 돌 때는 bind mount 로 소스를 본다. 호스트(macOS·Windows)의 파일 변경은
      // inotify 이벤트로 컨테이너 안에 전달되지 않아, 폴링을 켜지 않으면 저장해도 HMR 이 돌지
      // 않는다. 폴링은 CPU 를 계속 쓰므로 호스트에서 직접 돌릴 때는 켜지 않는다 —
      // docker-compose.yml 의 frontend 서비스만 VITE_DEV_POLL 을 지정한다.
      // `watch` 키 자체를 넣지 않아야 Vite 의 기본 감시자(chokidar)가 그대로 붙는다. Vite 는
      // `watch: null` 을 "파일 감시를 끈다"로 해석하므로(청크 소스의 `serverConfig.watch !== null
      // ? chokidar.watch(...) : createNoopWatcher(...)`), null 을 넣으면 호스트 직접 실행 경로의
      // HMR 이 통째로 죽는다. `exactOptionalPropertyTypes`(tsconfig.base.json) 때문에
      // `watch: undefined` 로도 못 고치므로 조건부 스프레드로 키 자체를 뺀다.
      ...(readEnv(env.VITE_DEV_POLL) === 'true'
        ? { watch: { usePolling: true, interval: 300 } }
        : {}),
      proxy: {
        // 로컬은 localhost, docker compose 안에서는 서비스 이름(backend)으로 붙는다.
        '/api': {
          target: readEnv(env.VITE_API_PROXY_TARGET) ?? 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
