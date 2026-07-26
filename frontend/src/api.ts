import { HEALTH_PATH, type HealthResponse } from '@ditter/shared-types';

/**
 * 서버 응답은 경계에서 검증한 뒤에만 내부 타입으로 취급한다.
 * (docs/conventions/typescript-style.md — "일단 캐스팅해서 통과시키지 않는다")
 */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(HEALTH_PATH);
  if (!response.ok) {
    throw new Error(`health 응답이 ${response.status} 입니다`);
  }
  return parseHealthResponse(await response.json());
}

export function parseHealthResponse(value: unknown): HealthResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { status?: unknown }).status !== 'ok' ||
    typeof (value as { uptimeSeconds?: unknown }).uptimeSeconds !== 'number'
  ) {
    throw new Error('health 응답 형식이 올바르지 않습니다');
  }
  return { status: 'ok', uptimeSeconds: (value as HealthResponse).uptimeSeconds };
}
