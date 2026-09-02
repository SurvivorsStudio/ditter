---
description: Branch off main if needed, commit by area, run changed-area tests, run /review's reviewer-subagent gate, push, then open/update a GitHub PR
argument-hint: [commit subject]
---

main 은 팀이 공유하는 브랜치이므로 직접 push 하지 않는다. 현재 변경을 feature 브랜치로 옮겨
커밋하고, 변경 영역의 테스트를 돌리고 diff 를 리뷰한 뒤 push 하고, main 으로의 **GitHub PR** 까지
만든다. 원격은 **GitHub** ([SurvivorsStudio/ditter](https://github.com/SurvivorsStudio/ditter))이라
`gh` 를 쓴다.

## Procedure

### 0. 브랜치 게이트 — feature 브랜치 확보
- `git status --porcelain` 와 `git diff` 로 무엇이 바뀌었는지 파악한다.
- 현재 브랜치를 **변수로 잡는다** — 아래 단계들이 `$BRANCH` 로 참조한다.
  `BRANCH=$(git rev-parse --abbrev-ref HEAD)` (feature 브랜치를 새로 만들면 그때 다시 잡는다).
  - **`main` 이면** (공유 브랜치라 직접 push 금지): 미커밋 변경을 새 feature 브랜치로 옮긴다.
    - `git fetch origin && git switch -c <branch> origin/main` (작업 트리의 변경은 그대로 따라온다).
    - **만든 직후 `BRANCH=$(git rev-parse --abbrev-ref HEAD)` 를 다시 잡는다.** 안 그러면
      변수에 `main` 이 남아 PR 이 main→main 으로 나가거나 push 뒤 검증이 어긋난다.
    - 브랜치명 prefix 는 **`feature/`·`bug/`·`fix/` 만** 사용한다(prefix 없는 맨 이름 금지 —
      `docs/conventions/commit-convention.md` §머지 정책). desc = 변경 요지를 소문자·하이픈 슬러그로.
      인자로 제목이 주어졌으면 그걸 슬러그화해 쓴다. 예: `feature/risk-detector`, `fix/explain-parser-cte`.
  - **이미 feature 브랜치면**: 그대로 진행한다.
- `git fetch origin` 후 업스트림 대비 뒤처졌으면(`git rev-list --count HEAD..@{u}` > 0,
  업스트림이 있을 때) 먼저 `git merge origin/main` 할지 제안한다(rebase 금지). 비-fast-forward push 강행 금지.

### 1. 기존 PR 탐지
- 현재 브랜치에 열린 PR 이 있는지 확인한다:
  ```bash
  gh pr list --head "$BRANCH" --state open --json number,url,title
  ```
- **이미 있으면**: 새로 만들지 않는다. 2·3·4 (커밋·테스트·코드 리뷰)까지 동일하게 거친 뒤 push 한다
  (GitHub 은 소스 브랜치에 push 하면 기존 PR 에 자동 반영). step 6 은 PR 생성(6-B) 대신 body 의
  `## 코드리뷰` 섹션을 갱신하고(6-C), **리뷰 게시(6-D)는 두 경로 모두에서 그대로 돈다.**
  6-D 를 여기서 빼면 이미 열린 PR 을 갱신하는 흔한 경로에서 Reviews 탭이 계속 빈다.

### 2. 커밋 정리 — `docs/conventions/commit-convention.md` 준수
- **1차 분할(필수)**: 한 커밋에는 아래 영역 **중 하나만** — `apps/api/` · `apps/web/` ·
  `apps/worker/` · `apps/connectors/` · `apps/sap-connector/` · `cdc/` · `sync/` · `docs/`(+ `README.md`·
  `CLAUDE.md`). 경로가 둘 이상 영역에 걸치면 커밋을 나눈다. `apps/connectors/`(공유 라이브러리)
  변경은 이를 쓰는 `apps/api/`·`apps/worker/` 변경보다 먼저 커밋한다. 위 영역 밖(루트 설정·
  `.claude/`·`.github/`·`docker-compose.yml`)은 그 목적 하나로 별도 커밋.
- **2차 분할**: 같은 영역 안에서도 서로 다른 타입·모듈·주제면 나눈다. 리팩터/포맷과
  동작 변경을 한 커밋에 섞지 않는다.
- **메시지**: `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문.
  - 타입은 `fix` `feat` `docs` `build` `refactor` `test` `chore` 만. 제목 50자 이내, 현재형·명령문.
  - 관련 이슈·맥락이 있으면 본문에 명시.

### 3. 변경 영역 테스트 (push 전 게이트)
바뀐 영역만 테스트한다. Python 앱은 uv, 웹은 npm.

- `apps/api/` 변경 포함 시: `cd apps/api && uv run --extra dev pytest`
- `apps/worker/` 변경 포함 시: `cd apps/worker && uv run --extra dev pytest`
- `apps/sap-connector/` 변경 포함 시: `cd apps/sap-connector && uv run --extra dev pytest`
- `apps/connectors/` 변경 포함 시: `cd apps/connectors && uv run --extra dev pytest` — 공유 라이브러리이므로
  이를 소비하는 `apps/api/`·`apps/worker/` 테스트도 함께 돌린다(계약이 깨지면 양쪽에서 드러나야 함).
- `apps/web/` 변경 포함 시: `cd apps/web && npm ci && npm test`(vitest).
- `cdc/`·`sync/`·`docs/` 만 변경했거나 해당 영역에 테스트가 없으면 건너뛴다.

하나라도 실패하면 **멈추고** 실패 로그를 사용자에게 보고한다. 자의로 우회하지 않는다.

### 4. 코드 리뷰 게이트 (push 전)

**이 단계는 [/review](review.md)와 동일한 절차다 — 본문은 그쪽이 SSOT.** `/review`를 그대로
실행해 `reviewer` 서브에이전트를 필요한 사이클만큼(고위험 변경이면 최소 2회) 돌리고, 사용자가
`수락`한 항목만 반영한다.

- `/review`가 만든 확정 수정 commit 은 이미 위 2번 「커밋 정리」의 영역 분할 규칙을 지킨 채
  커밋되어 있다 — 여기서 다시 손대지 않는다.
- `/review`의 최종 `carry_over` 목록을 받아서 아래 step 6 PR body 의 `## 코드리뷰` 섹션에 쓴다.
- **finding 을 버리지 말고 들고 간다.** 반영된 것과 이월된 것 **양쪽 다** step 6-D 에서
  PR 리뷰로 게시한다. 필요한 필드는 `file`·`line`·`severity`·`category`·`cause`·`risk_factor`·
  `suggestion`, 그리고 무엇으로 처리됐는지(`decision`·`note`·`reason`)다.
  - 반영된 것의 상세는 `/review` 가 넘겨준다. reviewer 의 `REVIEW_RESULT` 는 고쳐진 항목을
    `auto_fix_commits`(sha)로만 돌려주므로, **수락을 받는 그 순간에 챙기지 않으면 사라진다** —
    그 보관을 [review.md](review.md) 가 한다.
  - 이월된 것은 `carry_over` 에 그대로 있다.
  - **수락 = 반영이 아니다.** 민감 경로와 security·performance 는 reviewer 가 수락받아도
    고치지 않는다. 코멘트 머리말은 세 가지로 적는다 — `반영` · `수락됐으나 미적용` · `이월`.
- **이 단계를 건너뛰고 push 하지 않는다.** `.claude/hooks/pr-review-gate.sh`가 **지금 push 하려는
  HEAD** 가 reviewer 로 충분히(고위험이면 2회) 검토됐는지 `.claude/.review-state.json` 으로
  대조해 강제한다 — 건너뛰거나 리뷰 이후 커밋을 더 쌓으면 다음 step 의 `git push`가 deny 된다.
- `/review`가 `FAIL`로 끝나면(사유가 `reviewer FAIL`로 시작) push 하지 않는다. 원인을 해결하고
  `/review`를 다시 실행한다.

### 5. Push
- `git push -u origin HEAD` (`--no-verify` 등 hook 우회 옵션 금지).
- push 후 검증: `git rev-parse HEAD` 와 `git rev-parse origin/$BRANCH` 가 일치하고
  `git rev-list @{u}..HEAD` 가 0 인지 확인. 불일치 시 중단 + 보고.

### 6. PR 반영 — body 작성 + 리뷰 게시

PR body 본문 구성 (순서):
1. **변경 요약** — 무엇을·왜 (bullet).
2. **테스트 방법** — 3번에서 돌린 명령·결과.
3. **관련 이슈/맥락** — 있으면 기재(없으면 생략). **이 작업의 근거 이슈가 있으면 그 줄을
   `Closes #N` 으로 적는다** (아래 6-E).
4. (조건부) **`## 코드리뷰`** — step 4 의 `carry_over` 가 비어있지 않으면 아래 형식대로 작성.

> 멀티라인 본문은 `--body-file <경로>` 로 넘긴다.
> 호칭 룰: PR body 는 공개 기록이므로 작성자를 "사용자"·"개발자" 등 역할 기반 용어로만 지칭한다.

#### 6-A. `## 코드리뷰` 섹션 형식 (carry_over 가 있을 때만)

```markdown
## 코드리뷰

**이번 review 요약**: <자연어 — 예: "확정 수정 2건, 다음 PR 로 이월 1건">

### 알려진 제약 사항 (이번 PR 미반영, 후속 검토 필요)

#### 1. <짧은 한국어 요약 문장>

- **위치**: `path/to/file.ts:42`
- **문제**: <finding 요약을 완전한 문장으로>
- **왜 이번 PR 에 안 넣었나**: <1문장>
```

**형식 룰**: 섹션 제목은 `## 코드리뷰` 고정. 각 이월 항목을 별도 `####` sub-section 으로.

#### 6-B. 신규 PR (step 1 에서 PR 미발견)
```bash
gh pr create --title "<타입>: <제목>" --body-file <본문파일> --base main --head "$BRANCH"
```
- 제목은 커밋 컨벤션(`<타입>: <제목>`)을 따른다.

#### 6-C. 기존 PR (step 1 에서 PR 발견 — push 로 이미 갱신됨)
PR 자체는 push 로 갱신됐다. body 의 `## 코드리뷰` 섹션만 갱신한다:
```bash
gh pr edit "$BRANCH" --body-file <본문파일>
```
- 기존 body 의 그 외 부분(변경 요약·테스트 방법 등)은 보존하고, `## 코드리뷰` 섹션만 새
  `carry_over` 로 교체해 전체 description 을 재작성한다.

#### 6-D. 리뷰 결과를 PR 리뷰로 게시 (Reviews 탭에 남긴다)

> **이 단계는 조건 없이 항상 돈다.** 6-A·6-C 를 건너뛰었더라도 — 오히려 그때가 더 중요하다.
> 이월이 없어 body 에 쓸 것이 없는 PR 이야말로 Reviews 탭이 비기 쉬운 경우이고, 이 단계는
> 그것을 막으려고 있다.

step 4 의 reviewer 결과를 **PR 리뷰로 올린다.** 6-A 의 body 섹션과 둘 다 남긴다 — 하는 일이
다르다. body 는 **머지 뒤에도 PR 페이지에 남는 기록**이고, 리뷰는 **리뷰를 돌렸다는 사실
자체의 증거**다. body 에만 적으면 Reviews 탭이 비어 있어, 밖에서 보는 사람에게는 아무도
검토하지 않고 머지한 PR 과 구별되지 않는다.

두 가지를 올린다.

1. **요약을 리뷰 본문으로** — 사이클 수, 반영 건수, 이월 건수, 무엇을 잡았는지 한두 줄.
   **첫 줄에 이번 HEAD 짧은 해시를 표지로 넣는다**(예: `리뷰 · 3f0ad65`). 재시도할 때 이번
   실행이 이미 올린 것인지 가리는 유일한 단서다 — 아래 원자성 항목 참고.
2. **줄이 확실히 맞는 항목만 인라인 코멘트로** — 나머지는 본문 요약으로 내린다.
   어느 쪽으로 가든 **고친 것도 반드시 남긴다**: 무엇을 잡아서 어떻게 고쳤는지가 리뷰의
   값어치다. 인라인이냐 본문이냐는 그것을 어디에 적을지의 문제일 뿐이고, **본문으로 내려도
   항목별로 적는다** — 건수만 남기면 라벨을 붙일 자리가 없다.

**줄 번호는 게시 직전에 다시 맞춘다.** reviewer 가 적은 `line` 은 **고치기 전** 파일 기준인데,
수락된 수정이 커밋되면서 그 위로 줄이 밀린다. `gh api repos/{owner}/{repo}/pulls/$PR_NUM/files`
로 지금 diff 를 읽어 대조하고, **맞출 수 없는 항목은 인라인에서 빼 본문 요약으로 내린다.**

**반영된 항목은 기본이 본문 요약**이다. 고쳐진 뒤라 원래 줄이 그대로 남아 있는 경우가
드물다. 아래 항목과 같은 이유이기도 하다 — 하나가 빗나가면 같은 요청의 나머지까지 잃을 수 있다.

먼저 **PR 번호를 잡는다.** 6-B(새 PR)는 URL 만 출력하고 6-C 는 브랜치 이름으로 수정해서,
새 PR 경로에서는 번호가 변수로 남아 있지 않다(기존 PR 경로는 step 1 에서 이미 조회했다).
**번호를 못 잡으면 게시를 건너뛰고 그 사실을 step 7 에 적는다** — 대개 6-B 가 실패해 PR 이
아예 없는 경우이고, 빈 번호로 요청하면 원인과 무관한 404 가 나 엉뚱한 데를 뒤지게 된다.

```bash
PR_NUM=$(gh pr view "$BRANCH" --json number -q .number) && SHORT=$(git rev-parse --short HEAD)
```

한 번의 요청으로 올린다(코멘트를 따로 달면 Reviews 탭에 묶이지 않는다):

```bash
gh api "repos/{owner}/{repo}/pulls/$PR_NUM/reviews" --method POST --input <리뷰파일.json>
```

`{owner}/{repo}` 는 `gh` 가 현재 저장소로 채운다 — 하드코딩하면 포크에서 엉뚱한 곳에 올라간다.

`<리뷰파일.json>` 모양:

```json
{
  "event": "COMMENT",
  "body": "리뷰 · $SHORT — <N>사이클, 반영 <N>건, 이월 <N>건.\n\n<무엇을 잡았는지 요약>",
  "comments": [
    {
      "path": "docs/diagrams/d4_aws.dot",
      "line": 74,
      "side": "RIGHT",
      "body": "**[<severity> · <category> · <반영|수락됐으나 미적용|이월>]** <cause>\n\n**위험**: <risk_factor>\n\n**조치**: <어떻게 고쳤는지 · 이월이면 왜 미뤘는지>"
    }
  ]
}
```

지킬 것:

- **`event` 은 `COMMENT` 고정.** PR 작성자는 자기 PR 을 `APPROVE`·`REQUEST_CHANGES` 할 수 없다
  (422 `Can not approve your own pull request`). 승인은 사람이 하는 일이고, 이 단계가 하려는
  것은 승인이 아니라 **검토 기록**이다.
- **인라인 코멘트는 그 PR 의 diff 에 있는 줄에만 붙는다.** 건드리지 않은 줄이나 파일에 달면
  **422 로 요청이 거부된다.** 공식 문서는 거기까지만 말하고 *일부라도 올라가는지*는 밝히지
  않는다 — 그래서 하나가 빗나가면 **나머지도 못 올라간다고 보고** 다룬다(그래야 어느 쪽이든
  안전하다). 맞출 수 없는 항목은 인라인에서 빼 본문 요약으로 내린다 — 이월 항목이 특히
  그렇다. PNG 같은 바이너리에도 달 수 없다.
- **삭제된 줄에 달려면 `"side": "LEFT"`** 를 쓴다. 기본은 `RIGHT`(추가·유지된 줄).
- **실패해도 머지를 막지 않는다.** push 와 PR 은 이미 끝났다. 422 가 나면 원인(대개 diff 밖
  라인)을 줄여 한 번 더 시도하고, 그래도 안 되면 **실패 사실을 보고에 남기고 넘어간다** —
  게이트가 아니라 기록이다.
  - 재시도 **전에** 이번 실행이 이미 올린 것이 있는지 본다. "전부 실패한다"는 원자성을 공식
    문서가 보장하지 않아, 일부가 올라간 상태였다면 재시도가 같은 리뷰를 두 번 남긴다.
    **"그 PR 에 리뷰가 있는가"로 보면 안 된다** — 기존 PR 갱신은 정상 경로라 지난 실행의 리뷰가
    항상 남아 있고, 그러면 언제나 "이미 있다"로 떨어져 정당한 재시도까지 막는다. 그래서 리뷰
    본문 첫 줄에 **이번 HEAD 짧은 해시**를 표지로 넣고, 재시도 전에는 그 표지를 찾는다.
- **요약만 올리는 것은 이번 `/pr` 의 리뷰 전체에서 남길 항목이 0건일 때뿐이다.** "돌렸고
  깨끗했다"도 기록이므로 그때는 인라인 배열을 비우고 요약만 올린다.
  - **마지막 사이클만 `CLEAN` 인 것은 여기 해당하지 않는다.** 정상 종료하는 세션의 마지막
    사이클은 원래 거의 항상 깨끗하다 — 그것을 조건으로 읽으면 거의 모든 실행이 항목 없는
    요약만 올리게 되고, step 4 가 "버리지 말라"고 한 기록이 통째로 사라진다.
  - 특히 **「수락됐으나 미적용」은 6-D 가 유일한 기록처다.** reviewer 는 그것을
    `carry_over_adds` 로도 `auto_fix_commits` 로도 내보내지 않으므로(reviewer.md 절차 5)
    6-A 섹션에도 없다. 여기서 빠지면 사용자가 수락한 지적이 어디에도 남지 않는다.
  - 앞 사이클에서 처리된 항목이 있으면 인라인만 비우고 **본문에는 항목별로 남긴다.**

#### 6-E. 근거 이슈가 있으면 `Closes #N` 을 본문에 적는다

**규칙 본문은 [`docs/conventions/commit-convention.md`](../../docs/conventions/commit-convention.md)
§5.2 다** — 무엇을 적고 무엇을 적지 않는지(없으면 지어내지 않는다 · `Closes` 는 실제로 닫는 것만)
는 그쪽을 본다. 이 절은 그 규칙을 `/pr` 경로에서 **챙기는 자리**이지 규칙의 출처가 아니다.

이 작업이 어떤 이슈에서 시작했으면 PR 본문의 「관련 이슈/맥락」에 **`Closes #N`** 을 적고, PR 을
만든 뒤 실제로 채워졌는지 확인한다:

```bash
gh pr view <n> --json closingIssuesReferences --jq '[.closingIssuesReferences[].number]'
```

빈 배열인데 근거 이슈가 있었다면 표기가 잘못된 것이다(`Closes` 없이 `#N` 만 적었거나 오타).
그대로 두면 `/pr-merge` **§1d** 가 판정할 근거를 잃는다.

- 기존 PR 을 갱신하는 경로(6-C)에서도 본문을 다시 쓰므로 **이 줄이 빠지지 않게 한다.**

### 7. Report
- push 한 브랜치·커밋 요약(해시·제목)과, 생성/갱신된 PR 의 URL 을 보고한다.
  **이 저장소는 브랜치 보호가 켜져 있어 리뷰 승인 1건이 필요하다** — `/pr-merge` 전에
  다른 사람의 리뷰를 받아야 한다. **그 승인은 마지막 push 뒤에 받아야 한다** — 이 명령을 다시
  돌리면 push 로 승인이 취소된다.
- 6-D 에서 올린 **리뷰 URL** 과 인라인 코멘트 건수를 함께 보고한다. 게시에 실패했으면 그
  사실과 이유를 적는다 — 조용히 넘어가면 Reviews 탭이 빈 이유를 나중에 알 수 없다.

## Notes
- 검사 실패 시 우회 금지 — 멈추고 보고.
- 한 브랜치/PR 에 커밋이 여러 개여도 된다. 되돌리기·리뷰 단위는 커밋.
- 머지 전략은 **squash 고정**이며 실제 머지는 `/pr-merge` 가 담당한다.
- Git 워크플로·커밋 단위 정책의 본문은 `docs/conventions/commit-convention.md` (SSOT).
- **리뷰는 두 곳에 남긴다** — PR body 의 `## 코드리뷰`(머지 뒤에도 PR 페이지에 남는 기록)와
  Reviews 탭의 리뷰 코멘트(검토했다는 증거). 한쪽만 남기면 각각이 하던 일 중 하나가 빈다.
- **6-D 는 `/pr-merge` 를 돌 계정과 같은 `gh` 계정으로 올린다.** 6-D 가 다는 인라인 코멘트는
  해결되지 않은 리뷰 스레드로 남는데, `/pr-merge` 는 **`gh` 를 실행하는 그 계정**이 남긴 것만
  자동으로 접는다. 계정이 갈리면 우리가 방금 올린 기록을 접지 못해 **머지가 `BLOCKED` 으로 막힌다**
  (`required_conversation_resolution`). 확인을 한 번 더 받는 정도가 아니라 진행이 멈추고, 매번
  남의 스레드를 접어도 되냐고 묻게 되어 그것이 습관이 되면 진짜 사람의 지적까지 함께 넘기게 된다.
  (`gh auth status` 로 활성 계정을 확인한다 — 이 환경에는 계정이 둘 등록돼 있다.)
- step 4(코드 리뷰)는 `.claude/hooks/pr-review-gate.sh`가 기계적으로 강제한다 — reviewer 를
  건너뛰고 push 하면 hook 이 deny 한다. reviewer 의 절대 규칙·분류 모델은
  [.claude/agents/reviewer.md](../agents/reviewer.md) (SSOT).
