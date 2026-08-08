// 컨테이너 전용 개발 워처 — 소스가 바뀌면 백엔드를 다시 띄운다.
//
// 왜 `node --watch` 를 쓰지 않나: `--watch` 는 파일 변경 이벤트(inotify)에 의존하는데, 호스트에서
// 컨테이너로 bind mount 된 소스에는 그 이벤트가 전달되지 않는다(macOS·Windows 공통). 파일 내용은
// 정상적으로 보이지만 이벤트만 오지 않아서, 저장해도 서버가 조용히 옛 코드를 계속 돌린다.
// Node 의 `--watch` 에는 폴링 옵션이 없다(`node --help` 기준 `--watch-path`·`--watch-kill-signal` 뿐).
//
// `fs.watchFile` 은 stat 폴링이라 파일시스템 종류와 무관하게 동작한다. 패키지를 하나 더 들이는
// 대신 이 스크립트를 두는 쪽을 골랐다 (docs/policy/supply-chain-security.md S1).
//
// 호스트에서 직접 돌릴 때는 이게 필요 없다 — `npm run dev` 의 `--watch` 가 그대로 동작한다.

import { spawn } from 'node:child_process';
import { readdirSync, unwatchFile, watchFile } from 'node:fs';
import path from 'node:path';

const BACKEND_ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(BACKEND_ROOT, 'src');
const ENTRY = path.join(SRC, 'index.ts');
const POLL_INTERVAL_MS = 300;
// 저장 한 번이 여러 이벤트로 쪼개져 오는 경우를 한 번의 재시작으로 묶는다.
const DEBOUNCE_MS = 100;

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let restartTimer = null;
/** @type {string[]} */
let watched = [];
let shuttingDown = false;

/**
 * `src` 아래의 `.ts` 파일과 디렉토리를 모두 모은다. 디렉토리까지 보는 이유는 파일이 새로
 * 생기거나 지워질 때 그 디렉토리의 mtime 이 바뀌기 때문이다 — 그래야 신규 파일도 잡힌다.
 */
function collectPaths(dir) {
  const found = [dir];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectPaths(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

function rewatch() {
  for (const target of watched) unwatchFile(target);
  watched = collectPaths(SRC);
  for (const target of watched) {
    watchFile(target, { interval: POLL_INTERVAL_MS }, (curr, prev) => {
      // 폴링은 내용이 그대로여도 콜백이 돈다. mtime 이 실제로 움직였을 때만 재시작한다.
      if (curr.mtimeMs !== prev.mtimeMs) scheduleRestart();
    });
  }
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log('[dev-watch] 변경 감지 — 백엔드를 다시 띄운다');
    start();
  }, DEBOUNCE_MS);
}

function start() {
  child?.kill('SIGTERM');
  // 새 파일이 생겼을 수 있으므로 재시작마다 감시 목록을 다시 만든다.
  rewatch();

  const proc = spawn(process.execPath, ['--env-file-if-exists=../.env', ENTRY], {
    stdio: 'inherit',
    cwd: BACKEND_ROOT,
  });
  child = proc;

  proc.on('exit', (code, signal) => {
    // `child !== proc` 이면 우리가 교체한 것이다. 같으면 서버가 스스로 죽었다는 뜻 —
    // 워처는 살려 둔다. 문법 오류를 고치면 다음 저장에서 다시 뜬다. 여기서 같이 죽으면
    // 컨테이너가 재시작 루프에 빠져 로그에서 원인을 읽기 어려워진다.
    if (shuttingDown || child !== proc) return;
    console.error(
      `[dev-watch] 백엔드가 종료됐다 (code=${code}, signal=${signal}). 변경을 기다린다`,
    );
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shuttingDown = true;
    child?.kill(signal);
    process.exit(0);
  });
}

console.log(`[dev-watch] ${SRC} 를 ${POLL_INTERVAL_MS}ms 간격으로 폴링한다`);
start();
