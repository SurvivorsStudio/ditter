# STATE

웹 프론트엔드 **다국어(ko/en) 전환** — 2026-09-01 기준. **화면 문구 전환은 끝났다.**

## 확정된 사실

- **검증은 `npx tsc -b --force` (또는 `npm run build`) 로 한다.**
  `apps/web/tsconfig.json` 이 `files: []` + project references 라 **`npx tsc --noEmit` 은
  아무것도 검사하지 않고 조용히 통과한다.** 이걸로 확인하다 `renderMd` 인자 누락(빌드 실패 +
  빈 메모 셀 렌더 크래시)을 며칠 놓쳤다.
- 사전은 `src/i18n/messages/*.ts` 의 **[ko, en] 쌍 튜플**, `index.ts` 가 합친다.
  키 오타는 컴파일에서 잡히지만 **번역 누락은 안 잡힌다** — 문자열을 그대로 두면 통과한다.
- **`MsgKey` 는 string 서브타입이라 "키를 화면에 그대로 출력하는" 실수를 타입체커가 못 잡는다.**
  `Record<X, MsgKey>` 상수를 만들었으면 렌더 자리가 `t()`/`tr()` 를 부르는지 눈으로 볼 것.
- **평가 시점이 전부다.** 모듈 상수·`useMemo`·팩토리 안에서 번역문을 굳히면 언어 전환을
  못 따라온다. 실제로 걸렸던 곳: `FILTER_OPS`·`MODE_LABEL`(ConfigPanel), `summarize()`
  (ExplainModal, `useMemo([target])`), `SCOPE_HINT`·`TYPE_LABEL`(TestRunModal),
  `tableOptions`(SqlEditor, `useMemo([tables])` 안의 팩토리).
- 마커 렌더러는 **`src/i18n/rich.tsx` 하나**다 — `**굵게**` → `<b>`, `` `코드` `` → `<code>`.
  짝이 맞는 마커만 바꾸고 짝이 없으면 글자로 남긴다(예전 `split('**')` 은 홀수면 꼬리를
  통째로 굵게 만들고 아무 신호도 안 냈다).
- `ConfigPanel.tsx`·`SqlEditor.tsx` 는 `t` 를 **지역 변수로 자주 가린다**(트리거 객체·테이블
  객체). 컴포넌트 안에서는 `const tr = useT()` 를 쓴다.
- 한 값을 **`useT()` 로 참조하면 그 함수가 반응형이 된다.** `openJsonFind`(SqlEditor)가
  ⌘F 리스너의 의존성이라 `useCallback([tr])` 이 필요했다 — lint 가 잡아 준다.

## 내린 결정

- **AI 프롬프트 시드는 번역하지 않는다** (`AiFixPanel.tsx` 주석이 근거).
  근거가 확인됐다 — **백엔드 `ai_service.py` 의 시스템 프롬프트가 전부 한국어 하드코딩**
  ("너는 {d} 디버깅 어시스턴트다…")이라 프론트 시드를 번역해도 모델은 한국어로 답한다.
  진짜 다국어 AI 응답은 백엔드 프롬프트 작업이고, 이 배치의 범위 밖이다.
- 화면 문구만 번역하고 **기술 값·프로토콜은 그대로 둔다** — cron 식, 모드 id
  (`upsert`·`initial`·`soft`…), `__deleted`, `-- @conn` 마커, `연합 조회`
  (DUCK_MARKER_NAME), 슬래시 명령 이름, `nodeCatalog` 의 category 식별자
  (한국어지만 **값**이다 — 화면은 `CATEGORY_KEY` 를 거친다).
- 문장은 **키 하나**로 유지한다. 조각내면 어순이 다른 언어에서 조립이 안 된다.
- **같은 문자열을 두 군데 두지 않는다.** `api/types.ts` 의 `SYNC_CHANNELS`·`SYNC_PURPOSES`
  에서 label/hint 를 걷어냈다(id 만 남김) — 화면은 `sync.channel.*` 사전을 본다.

## 진행 중

없음. 아래 「남은 것」이 다음 후보다.

## 남은 것

### 1. 백엔드 문구는 그대로 한국어다

서버가 내려주는 오류·검증 메시지(`ValidationError`·`dag.py` 검증·`sync_service.preflight`
항목 label/detail)는 번역 대상 밖이었다. en 화면에서도 그 문구는 한국어로 뜬다.
프론트만으로는 못 고친다 — 백엔드에 같은 종류의 사전이 필요하다.

### 2. AI 응답 언어 (위 「내린 결정」 참조)

`apps/api/src/eai_api/services/ai_service.py` 의 `_prompt_*` 6개가 한국어 하드코딩이다.
en 사용자가 「AI로 고치기」를 쓰면 UI 는 영어인데 답만 한국어로 온다.

### 3. 일부러 한국어로 남긴 것 (검증 도구가 잡으므로 오해 말 것)

전체 스캔에 47건이 남는데 전부 의도된 것이다:
- `canvas/nodeCatalog.tsx` 36건 — category 식별자(값). 화면은 `CATEGORY_KEY` 로 번역한다.
- `AiFixPanel`·`NotebookAi` 3건 — AI 프롬프트 시드.
- `connMarker.ts`·`pages/SqlEditor.tsx` 2건 — `연합 조회`(프로토콜 이름).
- `App.tsx`·`Login.tsx` 2건 — 언어 토글의 `'한'`(다른 언어의 이름이라 번역 대상이 아니다).
- `main.tsx`·`api/client.ts` 2건 — 개발자용 콘솔/부팅 오류.
- `api/auth.ts` 1건 — `EAI_AUTH_ENABLED=false` 로컬 픽스처의 표시 이름.
- `api/connectorFields.ts` 1건 — `abbr` 폴백. `abbrKey` 가 있어 화면에는 안 나온다.

확인 명령:
```bash
cd apps/web && npx tsc -b --force && npm run lint && npm test && npm run build
```

### 4. 숫자 보간이 자릿수 구분을 붙인다

`i18n/index.ts` 가 number 를 `toLocaleString()` 으로 푼다. UI 에서는 오히려 낫지만
`AiChatPane` 의 `chat.runTotalNote`·`chat.runResultHead` 는 **모델에 보내는 프롬프트 본문**
이라 모델이 `1,000행` 을 본다. 판단 필요(2번과 함께 정하면 된다).
