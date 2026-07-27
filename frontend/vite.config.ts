import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// 환경변수는 저장소 루트의 `.env` 에서 읽는다. Vite 는 기본적으로 이 설정 파일이 있는
// 디렉토리(frontend/)만 env 파일 후보로 보고, 거기서 읽은 `VITE_*` 값을 `process.env` 에
// 넣지도 않는다 — 그래서 `process.env.VITE_*` 로는 `.env` 의 값이 보이지 않는다.
// 백엔드는 `node --env-file-if-exists=../.env` 로 같은 파일을 읽으므로 여기서 대칭을 맞춘다.
const repoRoot = path.resolve(import.meta.dirname, '..');

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
      host: env.VITE_DEV_HOST ?? '127.0.0.1',
      port: 5173,
      proxy: {
        // 로컬은 localhost, docker compose 안에서는 서비스 이름(backend)으로 붙는다.
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
