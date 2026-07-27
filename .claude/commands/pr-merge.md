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
- 현재 브랜치가 `main` 이면 멈춘다(머지할 feature PR 이 아님).
- 찾은 PR 번호로 상세 상태를 가져온다(이후 게이트는 **이 서버 값**을 기준으로 한다 — 사용자가
  다른 브랜치를 체크아웃한 상태일 수 있으므로 로컬 `HEAD` 를 가정하지 않는다):
  ```bash
  gh pr view <n> --json number,title,state,mergeable,mergeStateStatus,reviewDecision,\
  statusCheckRollup,headRefName,headRefOid,baseRefName
  ```

### 1. 사전 게이트 (모두 통과해야 함 — 첫 실패에서 종료)

이 명령은 게이트 안에서 무엇도 고치지 않는다. 어떤 게이트든 실패하면 사용자의 다음 단계는 `/pr` 다.

#### 1a. 상태
- `state == OPEN`. 이미 머지됐으면(`MERGED`) 그 사실만 보고하고 종료.

#### 1b. 승인 · CI · 충돌
- `reviewDecision == "CHANGES_REQUESTED"` 면 종료 — 리뷰 코멘트를 먼저 반영하고 `/pr` 로 재준비.
  브랜치 보호 규칙이 없어 `reviewDecision` 이 빈 값이면(승인 요건 없음) 통과로 본다.
- `statusCheckRollup` 에 `FAILURE`/`ERROR` 상태가 있으면 종료 — CI 를 먼저 초록으로 만든다.
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

아래 **두 경우에만** 멈추고 사용자에게 묻는다. 둘 다 사용자가 명령할 때는 알 수 없었고, 답에 따라
**무엇을 머지할지가 달라지는** 경우다.

1. **대상 PR 이 하나로 정해지지 않을 때** — 인자로 PR 번호를 주지 않았는데 현재 브랜치의 열린
   PR 이 0개이거나 2개 이상인 경우. 어느 것을 머지할지는 추측하지 않는다.
2. **사람이 남긴 미해결 리뷰 코멘트가 있을 때** — `gh pr view <n> --comments` 로 확인한다.
   `CHANGES_REQUESTED` 는 1b 에서 이미 종료되지만, 승인 없이 남은 지적은 서버 상태만으로
   반영 여부를 알 수 없다. 코멘트를 요약해 보여주고 그대로 머지할지 확인받는다.

그 외에는 묻지 않는다. 특히 **"되돌리기 어려운 작업이니 한 번 더 확인"** 을 이유로 되묻지 않는다 —
명시적 호출 + 게이트 통과가 곧 승인이다. 머지해도 되는지 **판단이 서지 않는 사정**(예: 방금
발견한 문서 부정확, 이월된 리뷰 항목)이 있으면 머지를 멈추는 대신 **머지를 진행하고 5번 보고에서
후속 작업으로 제시**한다.

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
- `git switch main && git pull --ff-only`
- **squash 머지는 `git branch -d` 가 항상 거부된다** — feature 의 커밋이 main 에 그대로 없으면
  (squash 로 합쳐져 SHA 가 다름) "미병합" 으로 보기 때문. 정상이며 데이터 손실 신호가 아니다.
- step 3 에서 머지 성공(`MERGED`)이 서버로 확인됐으므로 로컬 브랜치도 바로 정리한다:
  `git branch -D <headRefName>` (원격은 `--delete-branch` 로 이미 삭제됨). 추가 확인 없이 삭제한다
  — 머지 확인이 곧 삭제 안전 보장이다.
- `git fetch --prune` 로 원격 추적 참조 정리.

### 5. Report
- 머지된 PR 번호·제목, main 의 새 squash 커밋 해시, 삭제한 브랜치(원격·로컬)를 보고한다.

## Notes
- PR 타깃은 항상 `main`. 머지 전략은 **squash 고정**(`docs/conventions/commit-convention.md`
  §머지 정책 — SSOT).
- 모든 게이트는 **서버사이드 PR 상태**(`gh pr view`)를 기준으로 한다 — 로컬 체크아웃이 PR 과
  같다고 가정하지 않는다.
- 머지 명령이 실패해도 **재호출 전 서버 상태(MERGED)를 먼저 확인**한다(step 3). 강제·우회 옵션 금지.
- **`/pr-merge` 호출이 곧 머지 승인이다.** 게이트를 통과하면 되묻지 않는다 — 예외는 step 2 의 두
  경우(대상 PR 불확정, 미해결 리뷰 코멘트)뿐이다. 사용자에게 되물어야 할 것은 "이미 지시한 일을
  해도 되는지"가 아니라 **"지시만으로는 정해지지 않는 것"** 이다.
