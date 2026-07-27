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

test('HOST 기본값은 루프백이다 — 네트워크 노출은 명시적 설정으로만 열린다', () => {
  expect(readServerConfig({}).host).toBe('127.0.0.1');
  expect(readServerConfig({ HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
});

test('빈 HOST 는 설정하지 않은 것으로 보고 루프백으로 되돌린다', () => {
  // `.env` 에서 항목을 남기고 값만 지우면 빈 문자열이 들어온다. 그대로 두면 Node 가
  // 주소 미지정으로 보고 모든 인터페이스에 바인딩한다(실측: listen(port, '') → '::').
  expect(readServerConfig({ HOST: '' }).host).toBe('127.0.0.1');
  expect(readServerConfig({ HOST: '   ' }).host).toBe('127.0.0.1');
  expect(readServerConfig({ HOST: ' 0.0.0.0 ' }).host).toBe('0.0.0.0');
});

test('빈 PORT 도 마찬가지로 기본값으로 되돌린다', () => {
  expect(readServerConfig({ PORT: '' }).port).toBe(4000);
  expect(readServerConfig({ PORT: ' 4100 ' }).port).toBe(4100);
});
