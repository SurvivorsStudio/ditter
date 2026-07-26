import { HEALTH_PATH } from '@ditter/shared-types';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { buildApp } from './app.ts';
import { readServerConfig } from './config.ts';

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('health 라우트가 ok 를 반환한다', async () => {
  const response = await app.inject({ method: 'GET', url: HEALTH_PATH });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
});

test('PORT 기본값은 4000 이다', () => {
  expect(readServerConfig({}).port).toBe(4000);
});

test('PORT 가 포트 번호가 아니면 기동을 멈춘다', () => {
  expect(() => readServerConfig({ PORT: 'not-a-port' })).toThrow();
});
