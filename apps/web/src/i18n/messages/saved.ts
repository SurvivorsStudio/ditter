/** saved 문구 — 「저장됨」 트리(SavedQueries)와 「즐겨찾기」(Favorites) 패널.
 *  ko 문구는 기존 리터럴과 바이트 동일하게 유지한다 — 기존 테스트의 한글 단언이 그 문구를 본다.
 *  `**굵게**` 마커는 i18n/rich.tsx 의 rich() 가 <b> 로 바꾼다 — 문장 하나를 키 하나로 유지하기 위한 표기다. */
export const saved = {
  // ---- 저장됨 트리: 새로 만들기 (기본 이름은 생성 시점에 번역되어 데이터가 된다) ----
  'saved.newFolderName': ['새 폴더', 'New folder'],
  'saved.newQueryName': ['새 쿼리', 'New query'],
  'saved.kindFolder': ['폴더', 'Folder'],
  'saved.kindQuery': ['쿼리', 'Query'],
  'saved.kindPipeline': ['파이프라인', 'Pipeline'],
  'saved.makeFolderTip': ['폴더 만들기', 'Create a folder'],
  'saved.makeQueryTip': ['쿼리 파일 만들기', 'Create a query file'],
  'saved.makePipelineTip': [
    '파이프라인을 새로 만들고 이 폴더에 놓습니다 (탭으로 열립니다)',
    'Creates a new pipeline in this folder (opens as a tab)',
  ],
  'saved.folderNamePh': ['폴더 이름…', 'Folder name…'],
  'saved.namePh': ['이름…', 'Name…'],
  'saved.cancelEsc': ['취소 (Esc)', 'Cancel (Esc)'],

  // ---- 저장됨 트리: 항목·폴더 행 ----
  'saved.panelTitle': ['쿼리 · 파이프라인', 'Queries · Pipelines'],
  'saved.searchPh': ['쿼리 · 파이프라인 검색…', 'Search queries · pipelines…'],
  'saved.clear': ['지우기', 'Clear'],
  'saved.showRunHistory': ['실행 이력 보기', 'Show run history'],
  'saved.scheduleTip': ['스케줄: {schedule}', 'Schedule: {schedule}'],
  'saved.removeFromTree': [
    '트리에서 빼기 (파이프라인 자체는 지워지지 않습니다)',
    'Remove from tree (the pipeline itself is kept)',
  ],
  'saved.dragToMove': ['드래그해서 다른 폴더로 이동', 'Drag to move to another folder'],
  'saved.addChildTip': ['폴더 / 쿼리 추가', 'Add folder / query'],
  'saved.renameFolderTip': ['폴더 이름 변경', 'Rename folder'],
  'saved.deleteFolderTip': ['폴더 삭제', 'Delete folder'],
  'saved.deleteFolderConfirm': [
    '폴더 "{name}" 와 안의 내용을 모두 삭제할까요?',
    'Delete folder "{name}" and everything in it?',
  ],
  'saved.emptyFolder': ['비어 있음', 'Empty'],
  'saved.renameTip': ['이름 변경', 'Rename'],
  'saved.delete': ['삭제', 'Delete'],
  'saved.loosePipelines': ['미분류 파이프라인', 'Unfiled pipelines'],
  'saved.emptyTitle': ['저장된 항목이 없습니다.', 'Nothing saved yet.'],
  'saved.emptyBody': [
    '**폴더** 를 만들고 그 안에서 **쿼리** · **파이프라인** 을 추가하세요.',
    'Create a **folder**, then add **queries** · **pipelines** inside it.',
  ],
  'saved.noSearchResults': ['“{term}” 검색 결과가 없습니다.', 'No results for “{term}”.'],

  // ---- 저장 대화상자 ----
  'saved.saveDialogTitle': ['쿼리 저장', 'Save query'],
  'saved.saveFolderLabel': ['저장할 폴더', 'Destination folder'],
  'saved.topLevel': ['최상위', 'Top level'],
  'saved.newFolderIn': ['"{name}" 안에 새 폴더', 'New folder in "{name}"'],
  'saved.newFolderTop': ['최상위에 새 폴더', 'New folder at top level'],
  'saved.queryNameLabel': ['쿼리 이름', 'Query name'],
  'saved.queryNamePh': ['예: 최근 알람 조회', 'e.g. Recent alerts'],
  'saved.noteLabel': ['메모 (선택)', 'Note (optional)'],
  'saved.notePh': ['이 쿼리에 대한 설명·주의사항 등', 'Description, caveats, etc. for this query'],
  'saved.conflictWarn': [
    '같은 이름의 쿼리가 이미 있습니다 — 저장하면 **덮어씁니다**. 다른 이름으로 저장하려면 이름을 바꾸세요.',
    'A query with this name already exists — saving will **overwrite** it. Change the name to save as a new one.',
  ],
  'saved.pickHint': [
    '폴더를 고르거나 “새 폴더” 로 만들어 저장하세요.',
    'Pick a folder, or create one with “New folder”.',
  ],
  'saved.overwrite': ['덮어쓰기', 'Overwrite'],
  'saved.save': ['저장', 'Save'],

  // ---- 즐겨찾기 패널 ----
  'saved.favTitle': ['즐겨찾기', 'Favorites'],
  'saved.favAddTip': ['즐겨찾기 추가', 'Add favorite'],
  'saved.add': ['추가', 'Add'],
  'saved.favHintPre': ['편집기에서 ', 'In the editor, '],
  'saved.favHintMid': [' 로 목록 팝업을, ', ' opens the list popup and '],
  'saved.favHintLoadQuery': ['/loadQuery.이름', '/loadQuery.name'],
  'saved.favHintPost': [' 으로 바로 불러옵니다.', ' loads one directly.'],
  'saved.connLabel': ['연결', 'Connection'],
  'saved.noConnections': ['등록된 연결이 없습니다', 'No connections registered'],
  'saved.connSelectPh': ['연결 선택…', 'Select a connection…'],
  'saved.deletedConn': ['삭제된 연결', 'Deleted connection'],
  'saved.allConnections': ['전체 연결', 'All connections'],
  'saved.favNamePh': ['이름 (예: 일일집계)', 'Name (e.g. daily rollup)'],
  'saved.favSearchPh': ['이름·SQL 로 검색…', 'Search by name or SQL…'],
  'saved.favEmptyTitle': ['등록된 즐겨찾기가 없습니다.', 'No favorites yet.'],
  'saved.favEmptyBody': [
    '**추가** 를 눌러 자주 쓰는 쿼리를 이름과 함께 담아 두세요.',
    'Click **Add** to keep frequently used queries by name.',
  ],
  'saved.favEmptyForConn': [
    '이 연결의 즐겨찾기가 없습니다.',
    'No favorites for this connection.',
  ],
  'saved.copied': ['복사됨', 'Copied'],
  'saved.copySql': ['SQL 복사', 'Copy SQL'],
  'saved.edit': ['편집', 'Edit'],
  'saved.favDeleteConfirm': ['즐겨찾기 "{name}" 를 삭제할까요?', 'Delete favorite "{name}"?'],
  'saved.collapse': ['접기', 'Collapse'],
  'saved.more': ['더 보기', 'Show more'],

  // ---- 즐겨찾기 피커 모달 ----
  'saved.favPickerTitle': ['즐겨찾기 불러오기', 'Load favorite'],
  'saved.closeEsc': ['닫기 (Esc)', 'Close (Esc)'],
  'saved.favPickerEmptyBody': [
    '좌측 **즐겨찾기** 탭에서 자주 쓰는 쿼리를 먼저 등록하세요.',
    'Register frequently used queries in the **Favorites** tab on the left first.',
  ],
  'saved.noResults': ['검색 결과가 없습니다.', 'No results.'],
  'saved.pickItem': ['항목을 선택하세요.', 'Select an item.'],
  'saved.pickerKeys': ['↑↓ 이동 · Enter 불러오기 · Esc 닫기', '↑↓ move · Enter load · Esc close'],
  'saved.load': ['불러오기', 'Load'],
} as const
