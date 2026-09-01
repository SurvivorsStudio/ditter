# STATE

웹 프론트엔드 **다국어(ko/en) 전환** 작업의 진행 상태. 2026-09-01 기준.

## 확정된 사실

- **검증은 `npx tsc -b --force` 로 한다.** `apps/web/tsconfig.json` 은 `files: []` + project
  references 라 **`npx tsc --noEmit` 이 아무것도 검사하지 않고 조용히 통과한다.** 이걸로
  확인하다가 `renderMd` 인자 누락(빌드 실패 + 메모 셀 렌더 크래시)을 놓친 적이 있다.
  `npm run build`(= `tsc -b && vite build`)가 진짜 게이트다.
- 사전은 `apps/web/src/i18n/messages/*.ts` 에 **[ko, en] 쌍 튜플**로 있고 `index.ts` 가 합친다.
  키 오타는 컴파일에서 잡히지만 **번역 누락은 안 잡힌다** — 문자열을 그대로 두면 통과한다.
- **`MsgKey` 는 string 서브타입이라 타입체커가 "키를 화면에 그대로 출력하는" 실수를 못 잡는다.**
  `Record<X, MsgKey>` 상수를 만들었으면 렌더 자리에서 `t()`/`tr()` 을 부르는지 눈으로 확인할 것.
- 마커 렌더러는 **`src/i18n/rich.tsx` 하나**다 (`**굵게**` → `<b>`, `` `코드` `` → `<code>`).
  짝이 맞는 마커만 바꾸고, 짝이 없으면 글자로 남긴다.
- `ConfigPanel.tsx` 에서 `t` 는 **지역 변수로 자주 가려진다**(트리거 객체·테이블 객체).
  컴포넌트 안에서는 `const tr = useT()` 를 쓴다.

## 내린 결정

- **AI 에게 보내는 프롬프트 시드는 번역하지 않는다** (`AiFixPanel.tsx:43` 주석이 근거).
  `AiFixPanel.userMsg` · `NotebookAi.tsx` 의 `현재 셀 SQL:…요청:` 이 그 규칙을 따른다.
  ⚠️ **`AiChatPane.tsx` 는 반대로 하고 있다** (`RUN_ASK`·`chat.runIntro`·`chat.suggest*Prompt`
  등이 전부 번역됨). 미해결 항목 참조.
- 화면 문구만 번역하고 **기술 값은 그대로 둔다** — cron 식, 모드 id(`upsert`·`initial`·`soft`…),
  `__deleted`, `-- @conn` 마커, `연합 조회`(DUCK_MARKER_NAME), 슬래시 명령 이름.
- 문장은 **키 하나**로 유지한다. 조각내면 어순이 다른 언어에서 조립이 안 된다.
  `<b>`·`<code>` 는 `**`·백틱 마커로 표현하고 `rich()` 가 푼다.

## 진행 중

다국어 4차 배치 — **커밋 완료**. 이번에 끝난 것:
`SavedQueries` · `Favorites` · `Notebook` · `NotebookAi` · `ConfigPanel`(348건, 최대) 및
이전 세션이 손댄 `AiChatPane` · `AiInlinePrompt` · `AiChart` · `AiDefaultSelect` · `AiFixPanel` ·
`ChartView` · `ConnectionNavigator` · `ObjectDetailModal` · `SchemaTableTree` · `SearchSelect` ·
`api/client.ts` · `canvas/variables.ts`.

## 미해결

### 1. 사전은 있는데 컴포넌트 배선이 안 된 것 (남은 작업의 대부분)

`grep -c "'sqlEd\." src/**` 가 0 이다 — **사전만 쓰고 코드를 안 고친 상태**라 언어를 바꿔도
그 화면은 한국어로 남는다. 같은 문자열의 진실이 두 군데 생긴 상태이기도 하다.

| 사전 | 키 | 소비자 |
|---|---|---|
| `messages/sqlEditor.ts` | 90 | **0개** — `canvas/SqlEditor.tsx`(85건)를 배선해야 한다 |
| `messages/canvasUi.ts` | 147 | **1개**(`cui.ref.varName`) — 아래 파일들을 배선해야 한다 |

남은 하드코딩 한글 (코멘트 제외, 총 311건):
```
 85 canvas/SqlEditor.tsx        36 canvas/nodeCatalog.tsx     28 canvas/EaiNode.tsx
 22 canvas/ResultTreeModal.tsx  22 canvas/TestRunModal.tsx    17 canvas/ResultDrawer.tsx
 16 canvas/SyncPreflightModal   14 canvas/ExplainModal.tsx    12 canvas/EdgeValueModal.tsx
  9 canvas/DuckScriptModal.tsx   8 api/types.ts                6 canvas/PyCodeEditor.tsx
  6 canvas/duckRefs.ts           6 canvas/memoColors.ts        5 canvas/connMarker.ts
  나머지 1~3건 파일 12개
```
확인 명령: `cd apps/web && npx tsc -b --force` 로 검증하고, 남은 한글은
`git grep -n "[가-힣]" -- 'src/**/*.tsx'` 로 훑되 **주석이 대부분이라 눈으로 걸러야 한다.**

### 2. 프롬프트 시드 번역 정책이 파일마다 반대다 (결정 필요)

`AiFixPanel`/`NotebookAi` 는 시드를 한국어로 두고, `AiChatPane` 은 번역한다.
en 사용자가 「AI로 고치기」를 쓰면 **한 요청 안에서 래퍼는 영어, 시드는 한국어**가 섞인다.
둘 중 하나로 통일해야 한다 — 어느 쪽이 맞는지는 모델 응답 언어를 무엇으로 할지에 달렸다.

### 3. 번역문이 서버에 저장되는 데이터가 되는 자리

- `ConfigPanel.tsx` 웹훅 기본 이름 `tr('cfg.hook.defaultName')` → 메타DB 에 남는다
- `SavedQueries.tsx` `ADD_DEFAULT_NAME` → 폴더/쿼리/파이프라인 이름 (§19 의 의도된 동작)

`uniqueName` 의 중복 회피가 **언어를 건너서는 안 먹는다** — `새 쿼리 2` 와 `New query 2` 는
서로를 못 본다. 지금은 무해하지만 알고 있을 것.

### 4. 숫자 보간이 자릿수 구분을 붙인다

`i18n/index.ts` 가 number 를 `toLocaleString()` 으로 푼다. 원래 raw 였던 자리가 `1,200개` 가
됐다. UI 는 오히려 낫지만, `AiChatPane` 의 `chat.runTotalNote`·`chat.runResultHead` 는
**모델에 보내는 프롬프트 본문**이라 모델이 `1,000행` 을 본다. 판단 필요.
