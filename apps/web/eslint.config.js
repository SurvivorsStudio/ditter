import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { window: 'readonly', document: 'readonly', console: 'readonly', WebSocket: 'readonly',
                 fetch: 'readonly', Response: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
                 confirm: 'readonly', AbortSignal: 'readonly', Infinity: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint, 'react-hooks': reactHooks },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      // JSDoc 안에서 `*/` 를 문자 그대로 쓰면 주석이 거기서 닫힌다. 그래서 SQL 주석 문법을
      // 설명하는 자리(Notebook·SqlEditor 의 `/*md … */` 마커)에 U+200B 를 끼워 넣었다 —
      // 지우면 코드가 깨지는, 일부러 넣은 문자다. 코드 안의 보이지 않는 공백은 그대로 막는다.
      'no-irregular-whitespace': ['error', { skipComments: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { ignores: ['dist/**', 'node_modules/**'] },
]
