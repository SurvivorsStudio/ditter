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
// SIGTERM 을 받고도 안 죽는 프로세스가 있으면 이 시간 뒤 SIGKILL 로 강제 종료한다.
// 없으면 워처가 무한정 기다려 재시작이 멈춘다.
const KILL_TIMEOUT_MS = 5000;

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let restartTimer = null;
// 재시작을 순서대로만 실행되게 하는 큐. 겹쳐 실행되면 이전 프로세스가 아직 포트를
// 붙잡고 있는 동안 새 프로세스가 뜨려다 죽는 경합이 생긴다 (doRestart 주석 참고).
let restartQueue = Promise.resolve();
/** @type {string[]} */
let watched = [];
let shuttingDown = false;
// waitForExit 로 우리가 의도적으로 종료시키는 중인 프로세스 집합. 재시작으로 죽인
// 것과 프로세스가 스스로 죽은 것을 구분하는 데 쓴다.
const intentionalKills = new WeakSet();

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
    enqueueRestart();
  }, DEBOUNCE_MS);
}

/**
 * doRestart 를 큐에 잇는다. `.then` 체이닝이라, 지금 진행 중인 재시작(이전 프로세스
 * 종료 대기 포함)이 끝난 뒤에만 다음 재시작이 시작된다 — 겹쳐 부르면 새 프로세스
 * 두 개가 같은 포트를 놓고 다툰다.
 *
 * `.then(fn, onRejected)` 가 아니라 `.then(fn).catch(onRejected)` 를 쓴다. 전자의
 * onRejected 는 **restartQueue(이전 상태)가 reject 됐을 때만** 불리고 `fn`(doRestart)
 * 자신이 던진 예외는 못 잡는다 — 그러면 이번 재시작의 오류를 다음 재시작 요청이 대신
 * 삼켜 조용히 스킵된다.
 */
function enqueueRestart() {
  restartQueue = restartQueue.then(doRestart).catch((err) => {
    console.error('[dev-watch] 재시작 중 오류:', err);
  });
}

/**
 * 프로세스에 SIGTERM 을 보내고 완전히 종료될 때까지 기다린다.
 *
 * 이미 종료된 프로세스면 곧바로 통과시킨다 — `exit` 이벤트는 한 번만 발생하고
 * EventEmitter 는 지나간 이벤트를 새로 등록한 리스너에 재생해주지 않는다. 백엔드가
 * 스스로 죽은 뒤(문법 오류 등) 다음 저장에서 이 함수가 그 죽은 프로세스를 다시
 * 기다리면, `once('exit', ...)` 도 `SIGKILL` 폴백(이미 죽은 프로세스에는 아무 효과가
 * 없다)도 절대 풀리지 않아 재시작 큐 전체가 영구히 멈춘다.
 */
function waitForExit(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    intentionalKills.add(proc);
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), KILL_TIMEOUT_MS);
    proc.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

async function doRestart() {
  // 이전 프로세스가 완전히 종료된 뒤에만 새 프로세스를 띄운다. 그러지 않으면 이전
  // 프로세스가 아직 포트를 붙잡고 있는 상태에서 새 프로세스가 EADDRINUSE 로 죽는데,
  // 워처는 "종료됐다"고만 적고 다음 저장까지 가만히 있어 백엔드가 죽은 줄 모르게 된다.
  if (child) await waitForExit(child);

  // 새 파일이 생겼을 수 있으므로 재시작마다 감시 목록을 다시 만든다.
  rewatch();

  const proc = spawn(process.execPath, ['--env-file-if-exists=../.env', ENTRY], {
    stdio: 'inherit',
    cwd: BACKEND_ROOT,
  });
  child = proc;

  proc.on('exit', (code, signal) => {
    // 재시작으로 우리가 죽인 것이면(intentionalKills) 조용히 넘어간다. 아니면 서버가
    // 스스로 죽은 것이다 — 워처는 살려 둔다. 문법 오류를 고치면 다음 저장에서 다시
    // 뜬다. 여기서 같이 죽으면 컨테이너가 재시작 루프에 빠져 로그에서 원인을 읽기
    // 어려워진다.
    if (shuttingDown || intentionalKills.has(proc)) return;
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
enqueueRestart();
