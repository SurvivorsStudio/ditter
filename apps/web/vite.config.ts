import react from '@vitejs/plugin-react'
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 개발 중에는 API 를 프록시해 CORS 와 WebSocket 오리진 문제를 함께 없앤다
      '/api': {
        target: process.env.VITE_API_BASE ?? 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 커버리지는 `npm run test:coverage` 로만 켠다(`npm test` 는 그대로 빠르다).
    // 하한은 실측보다 조금 낮게 둔 **바닥**이다 — 내려가면 CI 가 막고, 올라가면 숫자를 올린다.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // 엔트리·타입선언·테스트 자신은 셀 대상이 아니다.
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'text-summary'],
      // 층마다 하한이 다르다. 로직 계층(store·api)은 실제로 테스트가 있어 높게 걸고,
      // 화면 컴포넌트(canvas·pages·components)는 렌더 테스트가 없어 전역 바닥만 적용된다.
      // 한 숫자로 뭉치면 store 가 무너져도 컴포넌트 몇 줄이 늘어난 것으로 가려진다.
      thresholds: {
        lines: 15,
        'src/store/**': { lines: 92 },
        'src/api/**': { lines: 55 },
        // 사전(messages/)은 데이터라 실행 줄이 거의 없고, 로직(locale·t)은 전부 테스트가 있다.
        'src/i18n/**': { lines: 90 },
      },
    },
  },
})
