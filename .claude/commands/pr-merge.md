---
description: Squash merge a prepared GitHub PR into main — only when all gates pass — then clean up the branch
argument-hint: [PR number (optional, defaults to current branch's PR)]
---

`/pr` 가 준비해 둔 PR 을 main 으로 **squash 머지**하는 **마지막 얇은 단계**다. 준비(feature 브랜치
확보·영역별 커밋·변경 영역 테스트·코드 리뷰·push·PR 생성)는 모두 `/pr` 에서 끝나 있어야 한다. 이
명령은 스스로 무엇도 고치지 않는다 — 사전 게이트가 하나라도 실패하면 **즉시 멈추고 `/pr` 로 다시
준비**하라고 안내한다.

원격은 **GitHub** ([SurvivorsStudio/ditter](https://github.com/SurvivorsStudio/ditter))이라 `gh` 를 쓴다.

## Procedure

### 0. 대상 PR 식별
- `$ARGUMENTS` 로 PR 번호가 주어지면 그걸 쓴다. 없으면 현재 브랜치의 열린 PR 을 찾는다:
  ```bash
  gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json number,url,title
  ```
- **번호를 인자로 받지 않았을 때만** 현재 브랜치가 `main` 인지 본다 — main 이면 멈춘다(찾을
  feature PR 이 없다). 번호를 받았으면 **체크아웃 위치와 무관하게 진행한다.** 이 명령은 4번에서
  사용자를 main 에 남기므로, 직전 머지 정리 직후 `/pr-merge <다음 번호>` 를 부르는 것이 정상
  경로다. 게이트는 로컬 위치가 아니라 서버 상태(1번)로 판정한다.
- **대상이 하나로 정해지지 않으면 여기서 멈추고 사용자에게 묻는다** — 인자로 번호를 주지 않았는데
  열린 PR 이 0개이거나 2개 이상인 경우다. 어느 것을 머지할지 추측하지 않는다. (이 판정은 반드시
  여기서 한다. 아래 1·2번은 대상이 하나로 정해진 뒤에야 실행되므로 그쪽에 적으면 도달하지 못한다.)
- 찾은 PR 번호로 상세 상태를 가져온다(이후 게이트는 **이 서버 값**을 기준으로 한다 — 사용자가
  다른 브랜치를 체크아웃한 상태일 수 있으므로 로컬 `HEAD` 를 가정하지 않는다):
  ```bash
  gh pr view <n> --json number,title,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName,headRefOid,baseRefName
  ```
  (한 줄로 붙여 쓴다. `\` 로 줄을 나누면 코드블록 들여쓰기가 딸려 들어가
  `accepts at most 1 arg(s), received 2` 로 실패한다.)

### 1. 사전 게이트 (모두 통과해야 함 — 첫 실패에서 종료)

이 명령은 게이트 안에서 무엇도 고치지 않는다. 어떤 게이트든 실패하면 사용자의 다음 단계는 `/pr` 다.

#### 1a. 상태 · 머지 대상
- `state == OPEN`. 이미 머지됐으면(`MERGED`) 그 사실만 보고하고 종료.
- `baseRefName == "main"`. 아니면 종료하고 실제 base 를 보고한다 — 3번 이후가 전부 main 을
  전제한다(`git switch main`, "main 의 새 squash 커밋" 보고). 다른 base 로 쌓은 PR 은 이 명령의
  대상이 아니다.

#### 1b. 승인 · CI · 충돌
- `reviewDecision == "CHANGES_REQUESTED"` 면 종료 — 리뷰 코멘트를 먼저 반영하고 `/pr` 로 재준비.
  브랜치 보호 규칙이 없어 `reviewDecision` 이 빈 값이면(승인 요건 없음) 통과로 본다.
- **CI 는 "실패가 없으면 통과"가 아니라 "성공을 확인해야 통과"다.** 이 저장소는 브랜치 보호를
  쓸 수 없어(private + 무료 플랜 — `gh api .../branches/main/protection` 이 403) GitHub 쪽
  백스톱이 없다. `/pr` 로 PR 을 만든 직후 `/pr-merge` 를 부르는 흐름에서 CI 는 아직 도는 중이고
  (실측 약 40초), 그때 `statusCheckRollup` 에는 실패가 없다 — 검사 전이기 때문이다.
  - `statusCheckRollup` 에 `FAILURE`/`ERROR` 가 있으면 종료 — CI 를 먼저 초록으로 만든다.
  - 아직 도는 중이면(`QUEUED`/`IN_PROGRESS`/`PENDING`) **기다렸다가 다시 판정한다.** 사용자에게
    묻지 않는다 — 기다림은 결정이 아니라 게이트의 일부다. 진행 상황만 고지한다:
    ```bash
    gh pr checks <n> --watch --fail-fast
    ```
    끝난 뒤 `gh pr view <n> --json statusCheckRollup` 으로 다시 확인한다.
  - 이 명령이 요구하는 체크(`build-test`)가 **하나도 잡히지 않으면** — 단, **곧바로 종료하지
    않는다.** PR 생성 직후에는 GitHub 이 체크런을 아직 붙이지 않아 `statusCheckRollup` 이 잠깐
    비어 있다. 이 "아직 안 붙음"과 "워크플로가 트리거되지 않음"은 구분해야 한다. 10초 간격으로
    최대 3회 `gh pr view <n> --json statusCheckRollup` 을 다시 읽고, 그래도 비어 있으면 종료한다.
    통과 처리하면 CI 게이트가 그냥 없는 것과 같다.
  - **통과는 `build-test` 의 결론이 `SUCCESS` 일 때뿐이다.** 위 세 갈래에 안 걸렸다고 통과시키지
    않는다 — 그러면 이 절이 거부한 "실패가 없으면 통과"로 되돌아간다. `CANCELLED`·`TIMED_OUT`·
    `ACTION_REQUIRED`·`STALE`·`SKIPPED` 는 실패로 기록되지 않지만 **초록불도 아니므로 종료**한다.
    (`ci.yml` 이 `cancel-in-progress: true` 를 쓰므로 `CANCELLED` 는 이 저장소가 실제로 만드는
    상태다.)
  - 여기서 "요구하는 체크"는 **이 명령이 요구한다**는 뜻이지 GitHub 의 required check 가 아니다
    (브랜치 보호가 없으므로 그런 것은 없다). `gh pr checks --required` 는 이 저장소에서 항상
    "no required checks reported" 로 끝나니 쓰지 않는다.
- `mergeable == "CONFLICTING"` 이면 종료: feature 브랜치에서 `git merge origin/main`(rebase
  금지)으로 충돌을 먼저 해소한 뒤 `/pr` 로 재준비하라고 안내. 자동 충돌 해소 옵션은 쓰지 않는다.
- `mergeStateStatus == "BEHIND"` 면(승인·충돌엔 문제없지만 뒤처짐) 계속 진행 가능 — GitHub 의
  squash 머지는 최신 main 을 다시 요구하지 않는 한 진행된다. 다만 뒤처진 정도가 크면 `/pr` 로
  `git merge origin/main` 후 테스트를 다시 돌리길 권장한다고 사용자에게 고지한다.

#### 1c. PR 브랜치에 미푸시 로컬 작업 없음
- 사용자가 현재 PR 브랜치(`headRefName`)에 체크아웃한 경우에만 검사한다:
  - `git status --porcelain` 가 비어있어야 한다.
  - `git rev-parse HEAD == headRefOid` (로컬 HEAD 가 서버 head 와 일치).
  - 더럽거나 HEAD 가 다르면 종료: `/pr` 로 커밋·push 후 다시 `/pr-merge`.
- PR 브랜치가 아닌 다른 곳에 체크아웃 중이면 이 로컬 검사는 건너뛴다 — 1a~1b 의 서버사이드
  검사가 머지 준비 상태를 이미 확인한다.

### 2. 진행 고지 (되묻지 않는다)

**`/pr-merge` 호출 자체가 머지 승인이다.** 1번 게이트를 모두 통과했다면 **다시 묻지 말고** 3번으로
진행한다. 사용자가 방금 명령한 것을 "진행할까요?" 로 되묻는 것은 같은 결정을 두 번 시키는 것이다.

진행 직전에는 **묻지 말고 고지만** 한다 — PR 번호·제목·소스 브랜치, main 으로 **squash 머지** +
머지 후 브랜치 삭제.

여기서 멈추고 묻는 경우는 **하나뿐**이다 — 사용자가 명령할 때는 알 수 없었고, 답에 따라 **머지
여부가 달라지는** 정보이기 때문이다. (대상 PR 이 여럿이라 하나로 좁혀지지 않는 경우는 0번에서
이미 처리된다.)

**미해결 리뷰 스레드가 남아 있을 때.** `CHANGES_REQUESTED` 는 1b 에서 이미 종료되지만, 승인 없이
남은 지적은 서버 상태만으로 반영 여부를 알 수 없다. `gh pr view --comments` 는 스레드의 해결
여부를 보여주지 않으므로 GraphQL 로 판정한다:

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    viewer { login }
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes { isResolved comments(first:1) { nodes { author { login __typename } body } } }
        }
      }
    }
  }' -F owner=SurvivorsStudio -F repo=ditter -F pr=<n> \
  --jq '.data as $d | $d.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved == false)
        | .comments.nodes[0]
        | select(. != null)
        | select(.author.__typename != "Bot" and .author.login != $d.viewer.login)'
```

세지 않는 것은 두 가지다 — 봇이 남긴 것(`__typename == "Bot"`)과 **`gh` 를 실행하는 계정
(`viewer.login`)이 남긴 것**. "자기 자신"은 PR 작성자가 아니라 viewer 로 못박는다(둘이 대개
같지만 규칙으로는 다르다). 남는 것은 **사람이 남긴 미반영 지적**뿐이다. 있으면 요약해 보여주고
그대로 머지할지 확인받고, 없으면 묻지 않는다.

그 외에는 묻지 않는다. 특히 **"되돌리기 어려운 작업이니 한 번 더 확인"** 을 이유로 되묻지 않는다 —
명시적 호출 + 게이트 통과가 곧 승인이다.

머지해도 되는지 걸리는 점이 있어도, 그것이 **머지되는 코드의 동작에 영향을 주지 않는 사정**이면
(예: 방금 발견한 문서 부정확, 이월된 리뷰 항목, 후속 정리 거리) 머지를 멈추지 말고 **진행한 뒤
5번 보고에서 후속 작업으로 제시**한다. 반대로 **머지될 코드 자체에 의심이 있으면** 이 조항을
근거로 넘기지 말고 멈춰서 보고한다 — 이 문장은 "가벼운 사정을 이유로 되묻지 마라"는 뜻이지
"무엇이든 일단 머지하라"는 뜻이 아니다.

### 3. Squash 머지
```bash
gh pr merge <n> --squash --delete-branch --subject "<타입>: <제목>" --body "<본문>"
```
- squash 커밋 메시지는 커밋 컨벤션(`<타입>: <제목>` + 빈 줄 + `-` 본문)을 따른다. PR 제목을
  제목으로, PR 본문 요약·관련 이슈/맥락(있으면)을 본문으로 쓴다
  (`docs/conventions/commit-convention.md` §머지 정책). `--delete-branch` 가 원격 feature
  브랜치 삭제까지 처리한다.
- 명령이 실패(exit ≠ 0)하면 **재호출 전에 서버 상태부터 확인**한다(머지가 이미 성공했을 수 있다):
  ```bash
  gh pr view <n> --json state
  ```
  - `MERGED` 면 머지는 성공한 것 — 재시도하지 말고 4번(정리)으로 진행.
  - `OPEN` 이면 실제 실패 — 출력된 오류(충돌·승인·권한 등)를 사용자에게 보고하고 종료. 강제·
    우회 옵션은 쓰지 않는다.

### 4. 로컬 정리

> 여기까지 왔으면 **머지는 이미 끝났다.** 이 단계가 실패해도 머지를 되돌리지 않는다 — 멈추고,
> 머지는 성공했고 로컬 정리만 남았다는 사실을 함께 보고한다.

- `git switch main && git pull --ff-only`
  - main 에 커밋하지 않은 변경이 있으면 `switch`·`pull` 이 거부된다. 0번이 번호를 받은 경우
    main 체크아웃을 허용하므로 실제로 생길 수 있는 상황이다. 이때는 정리를 멈추고 위 원칙대로
    보고한다. 사용자의 작업물을 stash·reset 으로 치우지 않는다.
- **squash 머지는 `git branch -d` 가 항상 거부된다** — feature 의 커밋이 main 에 그대로 없으면
  (squash 로 합쳐져 SHA 가 다름) "미병합" 으로 보기 때문. 정상이며 데이터 손실 신호가 아니다.
- step 3 에서 머지 성공(`MERGED`)이 서버로 확인됐으므로 로컬 브랜치도 바로 정리한다:
  `git branch -D <headRefName>`. 추가 확인 없이 삭제한다 — 머지 확인이 곧 삭제 안전 보장이다.
  - 단 `gh pr merge --delete-branch` 는 **로컬 브랜치까지 지운다**(그 브랜치에 체크아웃 중이면
    기본 브랜치로 옮긴 뒤 삭제). 이미 없으면 `branch not found` 가 나는데 **정상이다** — 실패로
    보고하지 말고 넘어간다.
- `git fetch --prune` 로 원격 추적 참조 정리.

### 5. Report
- 머지된 PR 번호·제목, main 의 새 squash 커밋 해시, 삭제한 브랜치(원격·로컬)를 보고한다.

## Notes
- PR 타깃은 항상 `main`. 머지 전략은 **squash 고정**(`docs/conventions/commit-convention.md`
  §머지 정책 — SSOT).
- 모든 게이트는 **서버사이드 PR 상태**(`gh pr view`)를 기준으로 한다 — 로컬 체크아웃이 PR 과
  같다고 가정하지 않는다.
- 머지 명령이 실패해도 **재호출 전 서버 상태(MERGED)를 먼저 확인**한다(step 3). 강제·우회 옵션 금지.
- **`/pr-merge` 호출이 곧 머지 승인이다.** 게이트를 통과하면 되묻지 않는다 — 묻는 경우는 대상 PR
  이 하나로 안 좁혀질 때(step 0)와 사람의 미해결 리뷰 스레드가 남았을 때(step 2)뿐이다. 사용자에게
  되물어야 할 것은 "이미 지시한 일을 해도 되는지"가 아니라 **"지시만으로는 정해지지 않는 것"** 이다.
- 되묻기를 없앤 만큼 **게이트가 기계적으로 완결돼야 한다.** 예전에는 확인 화면이 사람 눈으로
  걸러주던 것들(CI 가 아직 안 돌았다, base 가 main 이 아니다)이 있었다 — 그 역할은 1a·1b 의
  게이트가 대신한다. 확인 단계를 더 걷어낼 때는 그것이 떠받치던 검사가 무엇이었는지 먼저 찾아
  기계 검사로 옮긴다.
