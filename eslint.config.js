import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Node 스크립트가 쓰는 전역들. `globals` 패키지를 들이는 대신 쓰는 것만 적는다
// (docs/policy/supply-chain-security.md S1 — 의존성을 늘리지 않는 것이 가장 강력한 방어다).
const nodeScriptGlobals = {
  console: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node 런타임에서 직접 도는 스크립트들. `process`·`console`·타이머가 전역으로 있다.
    // 앱 소스(`.ts`)는 타입 검사가 이 역할을 하므로 여기 넣지 않는다.
    files: ['**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: nodeScriptGlobals,
    },
  },
  {
    rules: {
      // docs/conventions/typescript-style.md — `any` 를 쓰지 않는다. 모르면 `unknown` 으로 받는다.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
