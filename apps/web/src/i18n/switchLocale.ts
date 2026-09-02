/** 언어 전환 — 화면 문구와 **서버가 만든 문구**를 함께 새 언어로 바꾼다.
 *
 *  `setLocale` 은 화면만 다시 그린다. 검증 이슈(ValidationIssue.message)·오류 detail
 *  같은 서버 문구는 요청의 Accept-Language 로 정해져 **캐시에 그 언어로 굳어 있어서**,
 *  화면만 바꾸면 한국어 껍데기에 영어 속이 남는다. 그래서 전환 직후 캐시를 버려
 *  다시 받는다.
 *
 *  언어 버튼이 있는 자리가 둘이라(App 레일 · 로그인 화면) 여기 모았다 — 아래 제외
 *  규칙을 두 자리에 두면 한쪽만 고쳐진다.
 *
 *  **착수 점검(PreflightCheck.label/detail)은 이 전환의 대상이 아니다.**
 *  `usePreflight`·`useSyncPreflight` 는 useMutation 이라 invalidateQueries 가 건드리지
 *  않는다 — 열려 있던 결과는 옛 언어로 남고 다시 눌러야 새 언어로 온다. 비우는 쪽을
 *  택하지 않은 이유는 모달이 빈 채로 남는 것이 옛 언어보다 나쁘고, 다시 조회하면
 *  원본 DB 를 또 읽기 때문이다.
 */
import type { QueryClient } from '@tanstack/react-query'
import { setLocale, type Locale } from './locale'

/** 무효화에서 **빼는** 쿼리의 머리 키. 이 키들은 **원본 DB 를 조회하고**, 응답이
 *  거기서 온 이름(스키마·테이블·컬럼·객체 정의)이라 **요청 언어를 타지 않는다** —
 *  다시 받아도 같은 문자열이 오는데 연결마다 원본 DB 조회만 한 번 더 나간다.
 *  (서버가 박아 둔 한글 라벨이 섞여 있어도 — Mongo 상세의 `info` 처럼 — 그것 역시
 *  Accept-Language 를 타지 않으므로 다시 받아 달라지는 것이 없다.)
 *
 *  넓게 버리고 여기서만 빼는 방향인 이유는 실패 방향이다. 허용 목록으로 좁히면
 *  나중에 번역문을 담은 쿼리를 더하고 목록에 넣지 않았을 때 **화면에 두 언어가
 *  섞이고**(이 장치가 없애려는 그 증상), 제외 목록은 빠뜨려도 조회가 한 번 더 나갈 뿐이다.
 *
 *  `connection-schema` 는 프리픽스다 — 뒤에 'table'·'names'·'objects'·'pk'·'nopk' 가
 *  붙는 변형(`useTableSchema`·`useConnectionTables`·`useConnectionObjects`·
 *  `useConnectionSchema`·`useDuckTables` 의 연결별 팬아웃)이 모두 같은 머리를 쓴다.
 *  키 정의는 `api/hooks.ts` 의 `queryKeys` 다.
 */
const SOURCE_DB_KEYS: ReadonlySet<string> = new Set(['connection-schema', 'object-detail'])

export function switchLocale(next: Locale, qc: QueryClient): void {
  setLocale(next)
  void qc.invalidateQueries({
    predicate: (query) => !SOURCE_DB_KEYS.has(String(query.queryKey[0])),
  })
}
