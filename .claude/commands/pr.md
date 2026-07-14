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
- 현재 브랜치 확인: `git rev-parse --abbrev-ref HEAD`.
  - **`main` 이면** (공유 브랜치라 직접 push 금지): 미커밋 변경을 새 feature 브랜치로 옮긴다.
    - `git fetch origin && git switch -c <branch> origin/main` (작업 트리의 변경은 그대로 따라온다).
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
  `## 코드리뷰` 섹션만 갱신(6-C)한다.

### 2. 커밋 정리 — `docs/conventions/commit-convention.md` 준수
- **1차 분할(필수)**: 한 커밋에는 `frontend/` · `backend/` · `packages/` · `docs/` **중 하나의
  영역만**. 경로가 둘 이상 영역에 걸치면 커밋을 나눈다(예: 위험 판정 로직 구현은 `backend/` 커밋,
  완료 조건·정책 문구 갱신은 `docs/` 커밋). `packages/`의 공유 타입 변경은 이를 쓰는
  `frontend/`/`backend/` 변경보다 먼저 커밋한다. 네 영역 밖(루트 설정·`.claude/`·인프라 스크립트)은
  그 목적 하나로 별도 커밋.
- **2차 분할**: 같은 영역 안에서도 서로 다른 타입·모듈·주제·STEP 이면 나눈다. 리팩터/포맷과
  동작 변경을 한 커밋에 섞지 않는다.
- **메시지**: `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문.
  - 타입은 `fix` `feat` `docs` `build` `refactor` `test` `chore` 만. 제목 50자 이내, 현재형·명령문.
  - 관련 이슈·맥락이 있으면 본문에 명시.

### 3. 변경 영역 테스트 (push 전 게이트)
바뀐 영역만 테스트한다. 각 워크스페이스에 정의된 `test` 스크립트를 쓴다.

- `backend/` 변경 포함 시: `npm test --workspace=backend`
- `frontend/` 변경 포함 시: `npm test --workspace=frontend`
- `packages/` 변경 포함 시: 이를 소비하는 `backend/`·`frontend/` 쪽 테스트도 함께 돌린다(공유
  타입이 깨지면 양쪽에서 드러나야 하므로).
- `docs/` 만 변경했거나, 아직 [STEP 0](../../docs/todo/step-00-dev-environment.md)이 끝나지 않아
  해당 워크스페이스에 `test` 스크립트가 없으면 건너뛴다.

하나라도 실패하면 **멈추고** 실패 로그를 사용자에게 보고한다. 자의로 우회하지 않는다.

### 4. 코드 리뷰 게이트 (push 전)

**이 단계는 [/review](review.md)와 동일한 절차다 — 본문은 그쪽이 SSOT.** `/review`를 그대로
실행해 `reviewer` 서브에이전트를 필요한 사이클만큼(고위험 변경이면 최소 2회) 돌리고, 사용자가
`수락`한 항목만 반영한다.

- `/review`가 만든 확정 수정 commit 은 이미 위 2번 「커밋 정리」의 영역 분할 규칙을 지킨 채
  커밋되어 있다 — 여기서 다시 손대지 않는다.
- `/review`의 최종 `carry_over` 목록을 받아서 아래 step 6 PR body 의 `## 코드리뷰` 섹션에 쓴다.
- **이 단계를 건너뛰고 push 하지 않는다.** `.claude/hooks/pr-review-gate.sh`가 이 세션에서
  `reviewer` 호출 기록(고위험이면 2회)을 검증해 강제한다 — 건너뛰면 다음 step 의 `git push`가
  deny 된다.
- `/review`가 `FAIL`로 끝나면(사유가 `reviewer FAIL`로 시작) push 하지 않는다. 원인을 해결하고
  `/review`를 다시 실행한다.

### 5. Push
- `git push -u origin HEAD` (`--no-verify` 등 hook 우회 옵션 금지).
- push 후 검증: `git rev-parse HEAD` 와 `git rev-parse origin/$BRANCH` 가 일치하고
  `git rev-list @{u}..HEAD` 가 0 인지 확인. 불일치 시 중단 + 보고.

### 6. PR body 작성 (생성 또는 갱신)

PR body 본문 구성 (순서):
1. **변경 요약** — 무엇을·왜 (bullet).
2. **테스트 방법** — 3번에서 돌린 명령·결과.
3. **관련 이슈/맥락** — 있으면 기재(없으면 생략).
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

### 7. Report
- push 한 브랜치·커밋 요약(해시·제목)과, 생성/갱신된 PR 의 URL 을 보고한다.

## Notes
- 검사 실패 시 우회 금지 — 멈추고 보고.
- 한 브랜치/PR 에 커밋이 여러 개여도 된다. 되돌리기·리뷰 단위는 커밋.
- 머지 전략은 **squash 고정**이며 실제 머지는 `/pr-merge` 가 담당한다.
- Git 워크플로·커밋 단위 정책의 본문은 `docs/conventions/commit-convention.md` (SSOT).
- step 4(코드 리뷰)는 `.claude/hooks/pr-review-gate.sh`가 기계적으로 강제한다 — reviewer 를
  건너뛰고 push 하면 hook 이 deny 한다. reviewer 의 절대 규칙·분류 모델은
  [.claude/agents/reviewer.md](../agents/reviewer.md) (SSOT).
