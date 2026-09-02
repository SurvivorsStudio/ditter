/** navigator 문구 — 연결 내비게이터·스키마 트리·검색 셀렉트·객체 상세 모달·차트 뷰. */
export const navigator = {
  // ---- ConnectionNavigator ----
  'navi.searchObjects': ['객체 검색…', 'Search objects…'],
  'navi.clear': ['지우기', 'Clear'],
  'navi.noConnections': ['DB 연결이 없습니다', 'No DB connections'],
  'navi.defFetchFailed': [
    '-- 정의를 가져오지 못했습니다: {name}',
    '-- Could not fetch definition: {name}',
  ],
  'navi.viewStructure': ['구조 보기 (팝업)', 'View structure (popup)'],
  'navi.viewScript': ['뷰 스크립트 (팝업)', 'View script (popup)'],
  'navi.viewSource': ['소스 보기 (팝업)', 'View source (popup)'],
  'navi.viewDetail': ['상세 보기 (팝업)', 'View details (popup)'],
  'navi.openInQueryTab': ['쿼리 탭으로 열기', 'Open in query tab'],
  'navi.copyName': ['이름 복사', 'Copy name'],
  'navi.refreshSchema': ['스키마 새로고침', 'Refresh schema'],
  'navi.refreshSchemaOf': ['{name} 스키마 새로고침', 'Refresh {name} schema'],
  'navi.loading': ['불러오는 중', 'Loading'],
  'navi.noObjects': ['객체가 없습니다', 'No objects'],
  'navi.schemasFolder': ['스키마', 'Schemas'],

  // 카테고리 폴더 (복수의 객체를 담는다 — en 은 복수형)
  'navi.cat.table': ['테이블', 'Tables'],
  'navi.cat.view': ['뷰', 'Views'],
  'navi.cat.materialized_view': ['구체화 뷰', 'Materialized views'],
  'navi.cat.function': ['함수', 'Functions'],
  'navi.cat.procedure': ['프로시저', 'Procedures'],
  'navi.cat.sequence': ['시퀀스', 'Sequences'],
  'navi.cat.collection': ['컬렉션', 'Collections'],
  'navi.cat.extension': ['확장 (Extensions)', 'Extensions'],
  'navi.cat.event_trigger': ['이벤트 트리거', 'Event triggers'],
  'navi.cat.tablespace': ['테이블스페이스', 'Tablespaces'],
  'navi.cat.role': ['롤 (Roles)', 'Roles'],

  // 객체 종류 라벨 (모달 머리 배지 — en 은 단수형)
  'navi.kind.table': ['테이블', 'Table'],
  'navi.kind.view': ['뷰', 'View'],
  'navi.kind.materialized_view': ['구체화 뷰', 'Materialized view'],
  'navi.kind.function': ['함수', 'Function'],
  'navi.kind.procedure': ['프로시저', 'Procedure'],
  'navi.kind.sequence': ['시퀀스', 'Sequence'],
  'navi.kind.collection': ['컬렉션', 'Collection'],
  'navi.kind.extension': ['확장', 'Extension'],
  'navi.kind.event_trigger': ['이벤트 트리거', 'Event trigger'],
  'navi.kind.tablespace': ['테이블스페이스', 'Tablespace'],
  'navi.kind.role': ['롤', 'Role'],

  // ---- SchemaTableTree ----
  'navi.searchTables': ['테이블 검색…', 'Search tables…'],
  'navi.noTables': ['테이블이 없습니다', 'No tables'],
  'navi.defaultSchema': ['(기본)', '(default)'],

  // ---- SearchSelect ----
  'navi.selectPlaceholder': ['— 선택 —', '— Select —'],
  'navi.noResults': ['결과 없음', 'No results'],
  'navi.search': ['검색…', 'Search…'],
  'navi.optionCount': ['{n}개', '{n} item{n||s}'],

  // ---- ObjectDetailModal ----
  'navi.detailFetchFailed': [
    '상세 정보를 가져오지 못했습니다.',
    'Could not fetch the details.',
  ],
  'navi.info': ['정보', 'Info'],
  'navi.columnsCount': ['컬럼 ({n})', 'Columns ({n})'],
  'navi.indexesCount': ['인덱스 ({n})', 'Indexes ({n})'],
  'navi.colType': ['타입', 'Type'],
  'navi.colColumns': ['컬럼', 'Columns'],
  'navi.colAttrs': ['속성', 'Attributes'],
  'navi.definition': ['정의', 'Definition'],
  'navi.copy': ['복사', 'Copy'],
  'navi.copied': ['복사됨', 'Copied'],
  'navi.noDetail': ['표시할 상세 정보가 없습니다.', 'No details to show.'],

  // ---- ChartView ----
  'navi.chart.bar': ['막대', 'Bar'],
  'navi.chart.line': ['선', 'Line'],
  'navi.chart.area': ['영역', 'Area'],
  'navi.chart.pie': ['원', 'Pie'],
  'navi.chart.scatter': ['산점도', 'Scatter'],
  'navi.agg.none': ['원시값', 'Raw'],
  'navi.agg.sum': ['합계', 'Sum'],
  'navi.agg.avg': ['평균', 'Average'],
  'navi.agg.count': ['개수', 'Count'],
  'navi.agg.min': ['최소', 'Min'],
  'navi.agg.max': ['최대', 'Max'],
  'navi.chartAgg': ['집계', 'Aggregate'],
  'navi.chartY': ['Y(값)', 'Y (value)'],
  'navi.chartYMulti': ['Y(값, 복수 선택)', 'Y (values, multi-select)'],
  'navi.chartNoNumeric': [
    '숫자 컬럼이 없어 차트를 그릴 수 없습니다. (집계=개수 는 가능)',
    'No numeric columns to chart. (Aggregate=Count still works)',
  ],
  'navi.chartPickY': [
    '그릴 Y(값) 컬럼을 하나 이상 선택하세요.',
    'Pick at least one Y (value) column to plot.',
  ],
  'navi.chartNoData': ['표시할 데이터가 없습니다.', 'No data to display.'],
  'navi.chartTruncated': [
    '많은 값이라 앞 {n}개만 표시합니다 — 집계하거나 필터로 줄여 보세요.',
    'Too many values — showing the first {n}. Aggregate or filter to reduce them.',
  ],
} as const
