---
description: Run the reviewer subagent against the current diff (single-pass, NEEDS_USER loop), apply user-confirmed fixes only, and report — this is the procedure /pr's push gate relies on
argument-hint: [cycle number to force (optional, defaults to 1)]
---

현재 브랜치의 diff(base: `origin/main`)를 `reviewer` 서브에이전트로 검토한다. **분석은
공격적으로, 자동수정은 보수적으로** — finding 은 넓게 잡아내되, 사용자가 `수락`한 것만 commit
한다. 이 커맨드는 push 하지 않는다 — push 는 `/pr`이 하고, `.claude/hooks/pr-review-gate.sh`가
**지금 push 하려는 HEAD** 가 이 절차로 충분히 검토됐는지 `.claude/.review-state.json`(사이클이
`CLEAN`/`ACTIONED`로 끝날 때마다 `reviewer` 자신이 갱신, `.gitignore` 처리된 로컬 상태 파일)으로
대조해 강제한다. 오케스트레이터(이 커맨드)는 이 파일에 손대지 않는다 — 자세한 이유는
[reviewer.md](../agents/reviewer.md)의 민감 경로 예외 설명 참고.

## Procedure

### 0. 범위 산정

```bash
review_base=origin/main
merge_base=$(git merge-base HEAD "$review_base")
in_scope_files=$(git diff --name-only "$merge_base" HEAD)
```

- `in_scope_files`가 비어있으면 → reviewer 호출 생략. "변경 없음 (no diff vs origin/main)"을
  보고하고 종료.

### 1. 고위험(core paths) 판정 — reviewer 호출 *전*에 확정

```bash
CORE_PATH_PATTERN='^(apps/connectors/|apps/[a-z-]+/migrations/|apps/api/alembic\.ini$|apps/api/src/eai_api/auth/|apps/api/src/eai_api/services/(connection_service|duck_service|secrets)\.py$|\.claude/|\.github/|docker-compose\.yml$|docs/conventions/commit-convention\.md$)'
```

- `in_scope_files` 중 하나라도 위 패턴에 걸리면 `high_risk = true` → **최소 2사이클**을 돈다.
  (핵심: 공유 커넥터 라이브러리, DB 마이그레이션, 인증, 커넥션/트랜잭션·비밀값 서비스, 인프라·툴링.)
- 그 외에도 diff 내용상 DB 마이그레이션·스키마 변경, 인증·감사 로직, 읽기 전용/트랜잭션 강제
  (SqlConnector·connection_service·DuckDB 어댑터) 변경으로 보이면 `high_risk = true`로 취급한다 —
  판단이 애매하면 고위험 쪽으로 기운다.
- 이 판정은 **여기서 미리 확정**한다. reviewer 결과를 보고 나서 "그냥 1사이클로 끝내자"고 낮추지
  않는다 — 어떤 push 경로도 게이트를 우회하지 못하게 하기 위함이다.

### 2. Orchestrator (single-pass, cycle 단위)

```
carry_over = []                # 최종 이월 목록 (PR body 에 쓰일 수 있음)
accepted_findings = []         # 사용자가 수락해 고쳐진 항목의 **상세** (PR 리뷰 게시에 쓰인다)
auto_fix_commits_total = []
cycle = 1
required_cycles = high_risk ? 2 : 1
termination_reason = None

while cycle <= required_cycles or termination_reason is None:
    # === reviewer 1회 호출 ===
    result = Agent({
      subagent_type: "reviewer",
      prompt: f"""
working_dir: {repo 절대경로}
review_base: origin/main
in_scope_files: {in_scope_files}
cycle_number: {cycle}
sensitive_paths: (reviewer.md 기본값 사용)
carry_over_existing: {carry_over}
"""
    })
    parse result 의 REVIEW_RESULT 블록 → status, fail_reason, cycle_findings,
      auto_fix_commits, user_confirmation_required, carry_over_adds, cycle_summary

    output cycle_summary   # reviewer.md §출력 계약의 cycle_summary 그대로

    if status == "FAIL":
        termination_reason = f"reviewer FAIL (cycle {cycle}): {fail_reason}"
        carry_over.extend(result.carry_over_adds)
        break   # push 차단 — 아래 「종료」로

    if status == "NEEDS_USER":
        # ⚠️ 아래 출력 형식은 계약이다 — 그대로 복제, 다른 형식으로 바꾸지 않는다.
        #
        #   ## 코드 리뷰 — 사용자 확인 필요 ({len(user_confirmation_required)}건)
        #   ### finding {finding_id} — {file}:{line}
        #     원인: {cause}
        #     위험 요소: {risk_factor}
        #     제안: {suggestion}
        #     (있을 때만) 질문: {question}
        #     (있을 때만) 대안: {alternative}
        #
        #     ─ 메타: 심각도 {SEVERITY_KR[severity]} · 분류 {CATEGORY_KR[category]} · Claude 단독 · {CONFIDENCE_KR[confidence]} · {RECOMMENDATION_KR[recommendation]}
        #     (있을 때만) 근거 부족: {missing_evidence}
        #   ...
        #   ## 응답 형식
        #     - finding 1: 수락          (제안대로 적용 — reviewer 가 commit)
        #     - finding 2: 대안 (note: ...)
        #     - finding 3: 거부          (수정 안 함, carry_over 로 이월)
        #
        # SEVERITY_KR = {P0: "P0 (치명)", P1: "P1 (심각)", P2: "P2 (보통)", P3: "P3 (경미)"}
        # CATEGORY_KR = {bug: "버그", security: "보안", performance: "성능", suggestion: "제안"}
        # CONFIDENCE_KR = {high: "확신 높음", medium: "확신 중간", low: "확신 낮음"}
        # RECOMMENDATION_KR = {strongly_recommended: "강력 권장", needs_review: "검토 필요"}

        INNER_LOOP_LIMIT = 2
        inner = 1
        while True:
            사용자에게 위 형식으로 user_confirmation_required 를 제시하고 응답을 기다린다
            user_responses = wait  # {finding_id, decision(수락|거부|대안), note?}

            # 수락·대안 항목의 **상세**를 여기서 붙잡아 둔다. reviewer 는 다음 호출에서 그것을
            # 고쳐 auto_fix_commits(sha)로만 돌려주고 상세(file·line·severity·category·cause·
            # risk_factor·suggestion)는 다시 담기지 않는다 — 지금 안 챙기면 영영 잃는다.
            #
            # 다만 **여기서 확정하지 않는다.** 수락은 "고쳐 달라"이지 "고쳐졌다"가 아니다 —
            # reviewer 는 민감 경로와 security/performance 를 수락받아도 고치지 않는다
            # (reviewer.md 절대 규칙 4 · 결정 매트릭스). 확정은 응답을 보고 아래에서 한다.
            #
            # id 로 자리를 찾지 않고 대응표를 만든다. finding_id 는 1-based 이고 reviewer 호출
            # 마다 1부터 다시 매겨진다 — 리스트 인덱스로 쓰면 한 칸 밀리고, 같은 항목인지
            # 판별하는 데도 못 쓴다. 동일성 판정은 key(f) = (file, line, cause) 로 한다.
            by_id = {f.finding_id: f for f in user_confirmation_required}
            pending = [{**by_id[r.finding_id], decision: r.decision, note: r.note}
                       for r in user_responses if r.decision in ("수락", "대안")]

            result = Agent(subagent_type="reviewer", prompt=<동일 prompt + cycle_number 유지 + user_responses>)
            parse result → status, ... (재할당)   # user_confirmation_required 도 새 값으로 재바인딩된다

            # 반영 여부를 **응답으로** 판정한다. 같은 항목이 또 확인 요청으로 돌아왔으면 아직
            # 안 끝난 것이고, 커밋이 하나도 없으면 reviewer 가 손대지 못한 것이다.
            still_open = {key(f) for f in result.user_confirmation_required}
            for f in pending:
                if len(result.auto_fix_commits) > 0 and key(f) not in still_open:
                    upsert(accepted_findings, key(f), {**f, applied: true})
                else:
                    upsert(carry_over, key(f), {**f, applied: false, reason:
                        "수락됐으나 reviewer 가 적용하지 않았다 — 민감 경로이거나 자동수정 금지"
                        " 카테고리다. 사람이 직접 반영해야 한다."})
            # upsert 는 같은 key 가 있으면 덮어쓴다. 내부 루프가 두 번 돌면 같은 항목이 두 번
            # 지나가는데, 그대로 append 하면 PR 리뷰에 같은 코멘트가 두 개 올라간다.

            if status != "NEEDS_USER":
                break

            if inner >= INNER_LOOP_LIMIT:
                unresolved = result.user_confirmation_required
                critical = [f for f in unresolved if f.severity in ("P0","P1")]
                minor = [f for f in unresolved if f.severity not in ("P0","P1")]
                for f in minor:
                    carry_over.append({severity: f.severity, file: f.file, line: f.line,
                        reason: f"NEEDS_USER 재호출 {INNER_LOOP_LIMIT}회 후 미해결 — carry_over 강등",
                        cause: f.cause, risk_factor: f.risk_factor, suggestion: f.suggestion})
                carry_over.extend(result.carry_over_adds)
                if len(critical) > 0:
                    termination_reason = f"reviewer FAIL: NEEDS_USER 한도 도달 — P0/P1 잔여 {len(critical)}건"
                else:
                    termination_reason = f"NEEDS_USER 한도 도달 ({INNER_LOOP_LIMIT}회)"
                break
            inner += 1

        if termination_reason is not None:
            break  # critical 잔여 또는 한도 도달 — 종료로

    auto_fix_commits_total.extend(result.auto_fix_commits)
    carry_over.extend(result.carry_over_adds)

    if status == "FAIL":  # 위에서 이미 처리했지만 재확인
        break

    # === 상태 기록은 reviewer 자신이 한다 ===
    # 여기까지 왔으면 이번 사이클은 FAIL/한도 도달 없이 CLEAN 또는 ACTIONED 로 끝난 것이고,
    # reviewer.md §절차 6번에 따라 reviewer 가 이미 .claude/.review-state.json 을 스스로
    # 갱신했다(오케스트레이터는 이 파일을 쓰지 않는다 — reviewer.md 의 민감 경로 예외 설명
    # 참고). 오케스트레이터는 그 결과를 신뢰하고 다음 단계로 넘어가기만 한다.

    # cycle 종료 — 다음 사이클로 갈지 결정
    if cycle < required_cycles:
        cycle += 1
        continue   # 2사이클째는 위 while 로 돌아가 reviewer 를 다시 호출 (이번엔 이전 사이클의
                   # 자동수정 커밋도 diff 에 포함된 상태로)
    else:
        termination_reason = "리뷰 완료 (수정/확인 0건)" if len(auto_fix_commits_total) == 0 \
                              else "리뷰 완료 (사용자 확정 수정 반영)"
        break

output f"코드 리뷰 완료: 사이클 {cycle}/{required_cycles}, 확정 수정 commit {len(auto_fix_commits_total)}개, 이월 {len(carry_over)}건"
output accepted_findings   # /pr §6-D 로 넘긴다 — 이 목록은 여기서만 만들어진다
output f"  종료 사유: {termination_reason}"
```

### 3. Report

- 종료 사유가 `"reviewer FAIL"` 또는 `"NEEDS_USER 한도 도달"`(P0/P1 잔여 포함)로 시작하면:
  ```
  ⛔ 코드 리뷰가 정상 종료되지 못했습니다 (사유: <termination_reason>).
  이 상태로는 /pr 의 push 게이트(.claude/hooks/pr-review-gate.sh)를 통과할 만큼 reviewer 가
  깨끗하게 돌지 않았을 수 있습니다. 원인을 해결한 뒤 /review 를 다시 실행하세요.
  ```
- 그 외("리뷰 완료 (...)", "변경 없음")는 정상 종료. commit 해시·이월 목록을 보고한다.
- 이월(`carry_over`) 목록은 `/pr`이 PR body 의 `## 코드리뷰` 섹션에 반영할 수 있도록 그대로
  넘겨준다(형식은 [pr.md](pr.md) §6-A 참고).
- **수락된 항목의 상세(`accepted_findings`)도 함께 넘긴다** — `/pr`이 PR 리뷰로 게시한다
  ([pr.md](pr.md) §6-D). reviewer 의 `REVIEW_RESULT` 는 고쳐진 항목을 `auto_fix_commits`(sha)
  로만 돌려주므로 **상세는 이 오케스트레이터가 보관하지 않으면 사라진다.** 계약을 늘리지 않는
  이유가 이것이다 — 수락 직전의 `user_confirmation_required` 에 이미 필요한 필드가 다 있다.
- **`accepted_findings` 에는 실제로 반영된 것만 들어간다.** 수락받고도 reviewer 가 고치지
  못한 것(민감 경로·자동수정 금지 카테고리)은 `applied: false` 와 사유를 달아 `carry_over` 로
  간다 — 사람이 손으로 반영했더라도 코드가 그것을 알 방법이 없으므로 **미적용으로 남긴다.**
  거부가 아닌데 이월에도 없으면 미해결 지적이 「해결됨」으로 기록되고 추적에서 사라진다.
- **마지막 사이클 자체가 새 자동수정 commit 을 만들었다면**, 그 commit 이 담긴 최종 HEAD 는
  아직 `cycles_for_head`가 1로 리셋된 상태다(위 「상태 기록」 참고) — 고위험(2사이클 필요)
  변경이었다면 `/pr`의 push 게이트가 여전히 막을 수 있다. 이건 버그가 아니라 "그 마지막 수정은
  아직 review 안 된 새 diff"라는 정확한 신호다. `/review`를 한 번 더 실행해 해소한다.

## Notes

- 이 커맨드는 **push 하지 않는다.** push 게이트는 `.claude/hooks/pr-review-gate.sh`가
  기계적으로 강제한다 — **지금 push 하려는 HEAD** 가 `.claude/.review-state.json`에 필요한
  횟수만큼 리뷰됐다고 기록돼 있지 않으면 `/pr`의 `git push`가 deny 된다. (이전에는 "이 세션에서
  reviewer 를 몇 번 불렀는지"만 셌는데, 그러면 리뷰 통과 후 같은 세션에서 코드를 더 고치고 다시
  push 할 때 새 변경이 리뷰되지 않은 채 통과했다 — 지금은 HEAD 단위로 대조한다.)
- `/pr`의 코드 리뷰 단계는 이 절차를 그대로 따른다(SSOT는 이 문서) — `/pr` 쪽에서 중복 설명하지
  않는다.
- reviewer 의 절대 규칙(범위 밖 파일 금지, 민감 경로 자동수정 금지, 파괴적 git 금지 등)과 4D
  분류·결정 매트릭스의 본문은 [.claude/agents/reviewer.md](../agents/reviewer.md) (SSOT).
- `.claude/.review-state.json`은 로컬 세션 상태일 뿐이라 `.gitignore` 처리돼 있다 — 팀과
  공유되지 않고, 저장소를 새로 클론하면 리뷰 기록도 없이 시작한다(정상 동작).
- 이 파일은 **`reviewer` 자신만 쓴다** — 오케스트레이터(이 커맨드나 `/pr`)가 대신 써주지
  않는다. 리뷰 게이트가 신뢰하는 유일한 근거를 그 게이트 대상이 아닌 실제 검사자(reviewer)가
  자기 사이클이 진짜 끝나는 순간에만 기록해야, 이 기록이 항상 진짜 리뷰의 부수효과라는 게
  보장된다 — 오케스트레이터가 사후에 손으로 써넣으면 실제 리뷰 여부와 무관하게 값을 조작할
  수 있는 경로가 생긴다(바로 이 게이트가 막으려는 것). 자세한 근거는
  [reviewer.md](../agents/reviewer.md)의 민감 경로 예외 설명 참고.
