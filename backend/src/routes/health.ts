import { HEALTH_PATH, type HealthResponse } from '@ditter/shared-types';
import type { FastifyInstance } from 'fastify';

/**
 * STEP 0 의 유일한 라우트. "앱이 떠 있다"만 답한다.
 * DB 접속 상태는 STEP 1 에서 붙인다.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get(
    HEALTH_PATH,
    {
      schema: {
        // docs/conventions/backend-fastify.md — additionalProperties: false 를 기본으로 둔다.
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'uptimeSeconds'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              uptimeSeconds: { type: 'number' },
            },
          },
        },
      },
    },
    (): HealthResponse => ({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
}
