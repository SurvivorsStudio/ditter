/** monitor 화면 문구. */
export const monitor = {
  // 상단 탭
  'monitor.tab.runs': ['실행 (배치)', 'Runs (batch)'],
  'monitor.tab.streams': ['스트림 (CDC)', 'Streams (CDC)'],

  // 실행 필터 · 기간
  'monitor.filter.all': ['전체', 'All'],
  'monitor.filter.success': ['✔ 성공', '✔ Success'],
  'monitor.filter.running': ['● 실행중', '● Running'],
  'monitor.filter.failed': ['✕ 실패', '✕ Failed'],
  'monitor.range.24h': ['최근 24시간', 'Last 24 hours'],
  'monitor.range.7d': ['최근 7일', 'Last 7 days'],
  'monitor.range.all': ['전체 기간', 'All time'],

  // 통계 카드
  'monitor.stat.successRate': ['성공률 (24h)', 'Success rate (24h)'],
  'monitor.stat.successRateSub': ['실행 {n}건 기준', 'Based on {n} run{n||s}'],
  'monitor.stat.avgDuration': ['평균 처리시간', 'Avg. duration'],
  'monitor.stat.medianSub': ['중앙값 {v}', 'Median {v}'],
  'monitor.stat.runs24h': ['실행 (24h)', 'Runs (24h)'],
  'monitor.stat.runs24hSub': [
    '스케줄 {scheduled} · 수동 {manual}',
    'Scheduled {scheduled} · Manual {manual}',
  ],
  'monitor.stat.failedToday': ['실패 (오늘)', 'Failures (today)'],
  'monitor.stat.checkLogs': ['로그 확인 필요', 'Check the logs'],
  'monitor.stat.allClear': ['이상 없음', 'All clear'],

  // 실행 목록
  'monitor.pipelineFilterTitle': ['파이프라인별 필터', 'Filter by pipeline'],
  'monitor.allPipelines': ['모든 파이프라인', 'All pipelines'],
  'monitor.loadRunsFailed': [
    '실행 이력을 불러오지 못했습니다: {error}',
    'Failed to load run history: {error}',
  ],
  'monitor.emptyRunsTitle': ['해당 조건의 실행 이력이 없습니다', 'No runs match the filters'],
  'monitor.emptyRunsBody': [
    '필터를 바꾸거나 파이프라인을 실행해 보세요.',
    'Change the filters or run a pipeline.',
  ],
  'monitor.th.run': ['실행', 'Run'],
  'monitor.th.pipeline': ['파이프라인', 'Pipeline'],
  'monitor.th.status': ['상태', 'Status'],
  'monitor.th.trigger': ['트리거', 'Trigger'],
  'monitor.th.records': ['처리 건수', 'Records'],
  'monitor.th.progress': ['진행률', 'Progress'],
  'monitor.th.duration': ['소요', 'Duration'],
  'monitor.th.startedAt': ['시작 시각', 'Started at'],
  'monitor.detailBtn': ['상세', 'Details'],
  'monitor.cancelRun': ['실행 취소', 'Cancel run'],

  // 스트림 탭
  'monitor.sfilter.flowing': ['● 흐르는 중', '● Flowing'],
  'monitor.sfilter.paused': ['❚❚ 일시정지', '❚❚ Paused'],
  'monitor.sfilter.failed': ['✕ 실패', '✕ Failed'],
  'monitor.sfilter.stopped': ['■ 중지됨', '■ Stopped'],
  'monitor.loadStreamsFailed': [
    '스트림 목록을 불러오지 못했습니다: {error}',
    'Failed to load streams: {error}',
  ],
  'monitor.streamActionFailed': ['스트림 제어 실패: {error}', 'Stream action failed: {error}'],
  'monitor.deleteHistoryFailed': [
    '이력 삭제 실패: {error}',
    'Failed to delete history: {error}',
  ],
  'monitor.emptyStreamsTitle': ['해당 조건의 스트림이 없습니다', 'No streams match the filters'],
  'monitor.emptyStreamsBody': [
    '캔버스에서 CDC 소스 파이프라인을 만들고 [스트림 시작]을, 실시간 동기화 파이프라인이면 [동기화 시작]을 눌러 보세요.',
    'On the canvas, create a CDC source pipeline and press [Start stream] — or [Start sync] for a realtime sync pipeline.',
  ],
  'monitor.openPipeline': ['파이프라인 열기', 'Open pipeline'],
  'monitor.syncTag': ['동기화', 'Sync'],
  'monitor.subWaitingTag': ['구독 대기중', 'Awaiting subscription'],
  'monitor.sinkWaitingIn': [
    'Sink 자동 구독 대기 — 약 {n}초 후 시작',
    'Waiting for sink auto-subscribe — starts in ~{n}s',
  ],
  'monitor.sinkWaitingSoon': [
    'Sink 자동 구독 대기 — 곧 시작됩니다…',
    'Waiting for sink auto-subscribe — starting soon…',
  ],
  'monitor.metric.eventsTotal': ['누적 이벤트', 'Total events'],
  'monitor.metric.lag': ['랙(lag)', 'Lag'],
  'monitor.streamTimes': ['최근 {last} · 시작 {start}', 'Last {last} · Started {start}'],
  'monitor.pauseTitle': ['일시정지', 'Pause'],
  'monitor.resumeTitle': ['재개', 'Resume'],
  'monitor.stopSyncTitle': ['중지 (원본 트리거 제거)', 'Stop (remove source triggers)'],
  'monitor.stopStreamTitle': ['중지 (커넥터 삭제)', 'Stop (delete connector)'],
  'monitor.deleteHistoryTitle': ['이력 삭제', 'Delete history'],
  'monitor.syncFailedMsg': [
    '동기화가 실패 상태입니다. 원본에 트리거가 남아 있을 수 있으니 SYM_TRIGGER 를 확인하세요.',
    'Sync is in a failed state. Triggers may remain on the source — check SYM_TRIGGER.',
  ],
  'monitor.streamFailedMsg': [
    '스트림이 실패 상태입니다. 파이프라인·소스 상태를 확인하세요.',
    'Stream is in a failed state. Check the pipeline and the source.',
  ],

  // SymmetricDS 지표
  'monitor.metric.pending': ['미전송', 'Unsent'],
  'monitor.metric.errorBatches': ['오류 배치', 'Error batches'],
  'monitor.nodeWaiting': [
    '타깃 노드 등록 대기 — 등록 전에는 데이터가 가지 않습니다.',
    'Waiting for target node registration — no data flows until it registers.',
  ],
  'monitor.pendingRows': [
    '미전송 {n}건이 원본 SYM_DATA 에 쌓여 있습니다. 계속 늘어나면 원본 DB 용량과 트랜잭션 로그를 확인하세요.',
    '{n} unsent row{n||s} accumulated in source SYM_DATA. If it keeps growing, check source DB storage and the transaction log.',
  ],
  'monitor.errorBatchesMsg': [
    '전송 실패 배치 {n}건 — SYM_OUTGOING_BATCH 를 확인하세요.',
    '{n} failed batch{n||es} — check SYM_OUTGOING_BATCH.',
  ],

  // 실행 상세 (RunDetail)
  'monitor.detail.title': ['실행 상세 · #{id}', 'Run detail · #{id}'],
  'monitor.detail.retryStarted': ['재실행을 시작했습니다 (#{id})', 'Retry started (#{id})'],
  'monitor.detail.retryFailed': ['재실행에 실패했습니다', 'Failed to retry'],
  'monitor.detail.version': ['파이프라인 버전', 'Pipeline version'],
  'monitor.detail.started': ['시작', 'Started'],
  'monitor.detail.nodeResults': ['노드별 결과', 'Per-node results'],
  'monitor.detail.noNodeStates': [
    '아직 노드 상태가 기록되지 않았습니다.',
    'No node states recorded yet.',
  ],
  'monitor.detail.th.node': ['노드', 'Node'],
  'monitor.detail.th.records': ['건수', 'Records'],
  'monitor.detail.th.result': ['결과 / 위치', 'Result / location'],
  'monitor.detail.clearFilter': ['해제', 'Clear'],
  'monitor.detail.logs': ['로그', 'Logs'],
  'monitor.detail.nodeChip': ['노드: {node}', 'Node: {node}'],
  'monitor.detail.noLogs': ['해당 조건의 로그가 없습니다.', 'No logs match the filters.'],
  'monitor.level.info': ['info+', 'info+'],
  'monitor.level.warning': ['warning+', 'warning+'],
  'monitor.level.error': ['error', 'error'],
  'monitor.detail.retryFull': ['전체 재적재로 재실행', 'Retry with full refresh'],
  'monitor.detail.retry': ['재실행', 'Retry'],
} as const
