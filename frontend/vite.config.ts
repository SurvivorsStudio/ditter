import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 로컬은 localhost, docker compose 안에서는 서비스 이름(backend)으로 붙는다.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    // 기본값은 루프백이다. dev 서버는 아래 proxy 로 /api 를 백엔드에 그대로 넘기므로,
    // 여기를 열면 백엔드의 루프백 바인딩(backend/src/config.ts)까지 함께 우회된다.
    // 인증은 STEP 8 에서야 붙는다. 컨테이너는 docker-compose.yml 의 frontend 서비스가
    // VITE_DEV_HOST=0.0.0.0 을 직접 지정한다.
    host: process.env.VITE_DEV_HOST ?? '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
