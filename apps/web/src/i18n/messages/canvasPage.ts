/** canvasPage 화면 문구. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다. */
export const canvasPage = {
  // 실행 완료·실패 배너
  'canvasPage.nodeScope': ['노드 {id} ', 'Node {id} '],
  'canvasPage.runDone': ['{scope}실행 완료 — {n}건', '{scope}run complete — {n} record{n||s}'],
  'canvasPage.runEnded': ['{scope}실행 {status}: {error}', '{scope}run {status}: {error}'],
  'canvasPage.unknownCause': ['원인 미상', 'unknown cause'],

  // 복사·되돌리기
  'canvasPage.copiedNodes': [
    '노드 {n}개 복사 — Ctrl/⌘+V 로 붙여넣기',
    'Copied {n} node{n||s} — Ctrl/⌘+V to paste',
  ],
  'canvasPage.nothingToUndo': ['되돌릴 작업이 없습니다', 'Nothing to undo'],

  // 저장
  'canvasPage.savedButIssues': [
    '저장했지만 실행 전 해결이 필요합니다: {message}',
    'Saved, but this must be resolved before running: {message}',
  ],
  'canvasPage.saved': ['저장했습니다', 'Saved'],
  'canvasPage.saveFailed': ['저장 실패', 'Save failed'],
  'canvasPage.runFailed': ['실행 실패', 'Run failed'],
  'canvasPage.nodeRunFailed': ['노드 실행 실패', 'Node run failed'],

  // 동기화(SymmetricDS)
  'canvasPage.syncIssuesBeforeStart': [
    '동기화 시작 전 해결이 필요합니다: {message}',
    'Resolve before starting sync: {message}',
  ],
  'canvasPage.preflightFailed': ['착수 점검 실패', 'Preflight check failed'],
  'canvasPage.syncStarted': [
    '동기화를 시작했습니다 ({status}). [모니터] 스트림 탭에서 상태를 확인하세요.',
    'Sync started ({status}). Check its status in the [Monitor] Streams tab.',
  ],
  'canvasPage.syncStartFailed': ['동기화 시작 실패', 'Failed to start sync'],

  // CDC 스트림
  'canvasPage.streamIssuesBeforeStart': [
    '스트림 시작 전 해결이 필요합니다: {message}',
    'Resolve before starting the stream: {message}',
  ],
  'canvasPage.streamStarted': [
    '스트림을 시작했습니다 ({status}). [모니터] Streams 탭에서 상태를 확인하세요.',
    'Stream started ({status}). Check its status in the [Monitor] Streams tab.',
  ],
  'canvasPage.streamStartFailed': ['스트림 시작 실패', 'Failed to start stream'],

  // 빈 상태·오류 화면
  'canvasPage.selectPipeline': ['파이프라인을 선택하세요', 'Select a pipeline'],
  'canvasPage.selectPipelineHint': [
    '홈에서 파이프라인을 고르거나 새로 만들어 주세요.',
    'Pick a pipeline from Home or create a new one.',
  ],
  'canvasPage.notFound': ['파이프라인을 찾을 수 없습니다', 'Pipeline not found'],
  'canvasPage.goHome': ['홈으로', 'Go home'],

  // 툴바
  'canvasPage.unsavedDot': ['● 저장되지 않음', '● Unsaved'],
  'canvasPage.savedVersion': ['v{version} · 저장됨', 'v{version} · saved'],
  'canvasPage.streamRunningWarnTitle': [
    '변경사항은 스트림 재시작 후 반영됩니다',
    'Changes take effect after the stream restarts',
  ],
  'canvasPage.streamRunningWarn': [
    '⚠ 스트림 실행중 — 변경은 재시작 필요',
    '⚠ Stream running — restart needed for changes',
  ],
  'canvasPage.runningProgress': [
    '실행중 {progress}% · {n}건',
    'Running {progress}% · {n} record{n||s}',
  ],
  'canvasPage.logs': ['로그', 'Logs'],
  'canvasPage.save': ['저장', 'Save'],
  'canvasPage.startSyncTitle': [
    '원본 상태를 점검한 뒤 실시간 동기화를 켭니다',
    'Checks the source, then turns on real-time sync',
  ],
  'canvasPage.startSync': ['동기화 시작', 'Start sync'],
  'canvasPage.startStreamTitle': [
    'Debezium 커넥터를 등록해 실시간 수집을 켭니다',
    'Registers a Debezium connector and turns on real-time capture',
  ],
  'canvasPage.startStream': ['스트림 시작', 'Start stream'],
  'canvasPage.fullRefreshTitle': [
    '워터마크를 무시하고 전체를 다시 적재합니다',
    'Ignores the watermark and reloads everything',
  ],
  'canvasPage.fullRefresh': ['전체 재적재', 'Full reload'],
  'canvasPage.run': ['실행', 'Run'],

  // 휴지통
  'canvasPage.trashDrop': ['놓으면 삭제됩니다', 'Release to delete'],
  'canvasPage.trashHint': ['여기로 끌어 삭제', 'Drag here to delete'],

  // 검증 배너
  'canvasPage.issuesBeforeRun': [
    '실행 전 해결 필요 ({n}건): {message}',
    'Resolve before running ({n} issue{n||s}): {message}',
  ],

  // 실행 로그 패널
  'canvasPage.runLogTitle': ['실행 로그 · #{id}', 'Run log · #{id}'],
  'canvasPage.liveDot': ['● 실시간', '● Live'],
  'canvasPage.disconnectedDot': ['○ 연결 끊김', '○ Disconnected'],
  'canvasPage.waitingLogs': ['로그 대기 중…', 'Waiting for logs…'],

  // 실행 중 스트림 경고 모달 (굵은 글씨 경계로 문구가 갈린다)
  'canvasPage.streamWarnHead': ['⚠ 실행 중인 스트림이 있습니다', '⚠ A stream is running'],
  'canvasPage.streamWarnBody1': ['이 파이프라인은 ', 'This pipeline has a '],
  'canvasPage.streamWarnBody1b': ['실행 중인 CDC 스트림', 'running CDC stream'],
  'canvasPage.streamWarnBody2': [
    '이 있습니다. 방금 저장한 변경사항 (특히 ',
    '. Changes you just saved (especially the ',
  ],
  'canvasPage.streamWarnBody2b': [
    '소스 테이블·삭제 처리·연결',
    'source tables, delete handling, and connection',
  ],
  'canvasPage.streamWarnBody3': [')은 ', ') '],
  'canvasPage.streamWarnBody3b': [
    '실행 중인 스트림에 자동 반영되지 않습니다.',
    'are not applied to the running stream automatically.',
  ],
  'canvasPage.streamWarnFix1': ['변경을 반영하려면 ', 'To apply the changes, '],
  'canvasPage.streamWarnFix1b': [
    '기존 스트림을 중지한 다음 다시 시작',
    'stop the existing stream, then start it again',
  ],
  'canvasPage.streamWarnFix2': [
    '하세요. 스트림 시작 시점의 소스 설정이 커넥터에 고정되기 때문입니다.',
    '. The source settings at stream start are frozen into the connector.',
  ],
  'canvasPage.streamWarnStep1': [
    '[모니터] → 스트림(CDC) 탭에서 이 스트림 ',
    'In the [Monitor] → Streams (CDC) tab, ',
  ],
  'canvasPage.streamWarnStep1b': ['중지', 'stop'],
  'canvasPage.streamWarnStep1c': ['', ' this stream'],
  'canvasPage.streamWarnStep2': ['캔버스로 돌아와 ', 'Return to the canvas and press '],
  'canvasPage.streamWarnStep2b': ['[스트림 시작]', '[Start stream]'],
  'canvasPage.keepEditing': ['계속 편집', 'Keep editing'],
  'canvasPage.goMonitor': ['모니터로 이동', 'Go to Monitor'],
} as const
