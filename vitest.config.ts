import { defineConfig } from 'vitest/config';

// STEP 0 시점에는 테스트가 순수 모듈 단위뿐이라 루트 설정 하나로 전 워크스페이스를 돌린다.
// 프런트엔드에 DOM 렌더링 테스트가 생기면(STEP 2) 워크스페이스별 설정으로 쪼갠다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{backend,frontend,packages}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
