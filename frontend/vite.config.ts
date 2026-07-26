import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 로컬은 localhost, docker compose 안에서는 서비스 이름(backend)으로 붙는다.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
