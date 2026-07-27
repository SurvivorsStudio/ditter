import { expect, test } from 'vitest';

import { parseHealthResponse } from './api.ts';

test('정상 응답을 파싱한다', () => {
  expect(parseHealthResponse({ status: 'ok', uptimeSeconds: 3 })).toEqual({
    status: 'ok',
    uptimeSeconds: 3,
  });
});

test('형식이 깨진 응답은 통과시키지 않는다', () => {
  expect(() => parseHealthResponse({ status: 'ok' })).toThrow();
  expect(() => parseHealthResponse(null)).toThrow();
  expect(() => parseHealthResponse('ok')).toThrow();
});
