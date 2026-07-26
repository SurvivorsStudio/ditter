import Fastify, { type FastifyInstance } from 'fastify';

import { registerHealthRoute } from './routes/health.ts';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: true,
    // docs/policy/supply-chain-security.md S8 — 기본값에 의존하지 않고 명시한다.
    // JSON Schema 검증(Ajv)은 입력 형태만 제약할 뿐 `__proto__` 오염을 막아주지 않는다.
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  registerHealthRoute(app);

  return app;
}
