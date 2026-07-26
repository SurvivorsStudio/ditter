import { defineConfig } from 'vitest/config';

// STEP 0 시점에는 테스트가 순수 모듈 단위뿐이라 루트 설정 하나로 전 워크스페이스를 돌린다.
// 프런트엔드에 DOM 렌더링 테스트가 생기면(STEP 2) 워크스페이스별 설정으로 쪼갠다.
//
// include 는 cwd 기준으로 풀린다. 워크스페이스 디렉토리에서 실행하면
// (`npm test --workspace=backend`) 그 디렉토리 아래만, 루트에서 실행하면 전체가 대상이 된다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
