/**
 * 프런트엔드·백엔드가 함께 쓰는 타입.
 *
 * docs/conventions/typescript-style.md — 같은 개념의 타입을 앱마다 따로 선언하지 않는다.
 * 스키마 조회 결과·EXPLAIN 트리·컨텍스트 JSON 등은 STEP 1 이후 여기에 추가된다.
 */

export const HEALTH_PATH = '/api/health';

/** `GET /api/health` 응답. STEP 0 에서는 "앱이 떠 있다"만 확인한다. */
export type HealthResponse = {
  status: 'ok';
  /** 백엔드 프로세스가 뜬 뒤 경과한 초. */
  uptimeSeconds: number;
};
