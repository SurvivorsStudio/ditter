import { useEffect, useState } from 'react';

import { fetchHealth } from './api.ts';

type BackendStatus =
  { kind: 'loading' } | { kind: 'ok'; uptimeSeconds: number } | { kind: 'error' };

/**
 * STEP 0 의 "빈 앱". 화면 골격(에디터·결과·사이드바 3분할)은 STEP 2 에서 만든다.
 * 여기서는 프런트가 백엔드에 닿는지만 보여준다.
 */
export function App() {
  const [status, setStatus] = useState<BackendStatus>({ kind: 'loading' });

  useEffect(() => {
    fetchHealth().then(
      (health) => setStatus({ kind: 'ok', uptimeSeconds: health.uptimeSeconds }),
      () => setStatus({ kind: 'error' }),
    );
  }, []);

  return (
    <main>
      <h1>ditter</h1>
      <p>안전하게 조회하고, 느리면 AI와 같이 고친다.</p>
      <p data-testid="backend-status">백엔드: {describe(status)}</p>
    </main>
  );
}

function describe(status: BackendStatus): string {
  switch (status.kind) {
    case 'loading':
      return '확인 중…';
    case 'ok':
      return `연결됨 (uptime ${status.uptimeSeconds}s)`;
    case 'error':
      return '연결 실패 — 백엔드가 떠 있는지 확인하세요';
  }
}
