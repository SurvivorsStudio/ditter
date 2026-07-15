#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash).
#
# 목적: **지금 push 하려는 HEAD 커밋**이 reviewer 서브에이전트로 검토된 적 없이 PR 트랙
# 브랜치(feature/*, bug/*, fix/* — main 으로 향하는 브랜치)에서 `git push` 하면 막는다.
# `/review`가 매 사이클 종료 시 .claude/.review-state.json 에 "어느 HEAD 를 몇 번 리뷰
# 했는지"를 기록하고, 이 훅은 그 기록을 지금 push 하려는 HEAD 와 대조한다.
#
# 이전 버전은 세션 transcript 에서 "reviewer 호출 횟수"만 누적으로 셌는데, 이러면
# 리뷰 통과 → push 성공 → 같은 세션에서 코드를 더 고침 → 다시 push 하는 흔한 흐름에서
# 새로 고친 부분이 한 번도 리뷰되지 않은 채 게이트를 통과했다(2026-07-14 코드 리뷰에서
# 발견). 지금은 "몇 번 불렀는지"가 아니라 "지금 push 하려는 커밋이 리뷰 대상이었는지"를
# 확인한다.
#
# 설계 원칙 = fail-open. "확실히 reviewer 를 안 돌린 PR 트랙 브랜치 push" 일 때만 deny 한다.
# 그 외 모든 불확실한 상황(jq 없음, stdin 파싱 실패, 브랜치 판별 실패, git push 가 아님,
# PR 트랙 브랜치가 아님, 상태 파일을 못 읽음)은 전부 allow 한다. deny 를 잘못 내리는 비용이
# reviewer 호출 여부를 놓치는 비용보다 훨씬 크기 때문이다.

set -u

allow() { exit 0; }
deny() {
  echo "$1" >&2
  exit 2
}

# jq 가 없으면 이 게이트 자체를 판단할 수 없다 — 통과시킨다.
command -v jq >/dev/null 2>&1 || allow

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || allow
[ "$tool_name" = "Bash" ] || allow

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || allow
[ -n "$command_str" ] || allow

# git push 여부 판정. 명령 문자열 전체를 훑으면 커밋 메시지 본문(특히
# `git commit -m "$(cat <<'EOF' ... EOF)"` 형태의 heredoc)에 그 문구가 텍스트로만
# 들어있어도 오탐한다 — heredoc 본문은 따옴표로 감싸여 있지 않아 따옴표만 걷어내는
# 방식으론 못 막는다. 그래서 명령 문자열의 **첫 줄만** 본다(heredoc 본문은 첫 줄
# 다음에 오므로 배제됨). 다만 첫 줄 자체가 `git add -A && git commit ... && git push ...`
# 처럼 `&&`·`;`·`|` 로 여러 명령을 이어붙인 한 줄일 수 있으므로(2차 코드 리뷰에서 실제
# 우회 사례로 발견·재현됨), 첫 줄을 그 구분자들로 나눠 조각마다 검사한다.
first_line="$(printf '%s\n' "$command_str" | head -n 1)"
first_line_segments="$(printf '%s' "$first_line" | sed -E 's/(&&|;|\|)/\n/g')"
printf '%s\n' "$first_line_segments" | grep -Eq '^[[:space:]]*git[[:space:]]+push([[:space:]]|$)' || allow

# 현재 브랜치 판별 — 실패하거나(디태치드 HEAD 등) main/알 수 없는 브랜치면 통과.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || allow
[ -n "$branch" ] && [ "$branch" != "HEAD" ] || allow
case "$branch" in
  feature/* | bug/* | fix/*) ;;
  *) allow ;;
esac

# 지금 push 하려는 HEAD 와, 상태 파일에 기록된 "마지막으로 리뷰된 HEAD"를 대조한다.
# 상태 파일이 없거나 읽을 수 없으면(예: /review 를 아직 한 번도 안 돌림) review_calls=0 —
# 아래 required_calls 비교에서 자연히 deny 로 이어진다(이것도 fail-open: "리뷰 안 함"이
# 확실할 때만 막는다는 취지에 맞는 유일한 deny 케이스다).
current_head="$(git rev-parse HEAD 2>/dev/null)"
[ -n "$current_head" ] || allow

state_file="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/.review-state.json"
review_calls=0
if [ -r "$state_file" ]; then
  reviewed_head="$(jq -r '.reviewed_head // empty' "$state_file" 2>/dev/null)"
  cycles_for_head="$(jq -r '.cycles_for_head // 0' "$state_file" 2>/dev/null)"
  if [ -n "$reviewed_head" ] && [ "$reviewed_head" = "$current_head" ] && printf '%s' "$cycles_for_head" | grep -Eq '^[0-9]+$'; then
    review_calls="$cycles_for_head"
  fi
fi

# 고위험(core paths) 변경이면 최소 2회 호출을 요구한다.
# NOTE: backend/·frontend/ 가 아직 스캐폴딩되지 않아(STEP 0 이전) 이 목록은 현재 존재하는
# 최상위 경로만 다룬다. STEP 0~1 이후 읽기 전용 강제·인증·마이그레이션 경로가 생기면
# 아래 CORE_PATH_PATTERN 과 .claude/agents/reviewer.md 의 core paths 목록을 함께 갱신할 것.
required_calls=1
merge_base="$(git merge-base HEAD origin/main 2>/dev/null)"
if [ -n "$merge_base" ]; then
  changed_files="$(git diff --name-only "$merge_base" HEAD 2>/dev/null)"
  if [ -n "$changed_files" ]; then
    CORE_PATH_PATTERN='^(packages/|docs/policy/|docs/schema/|\.claude/|\.github/|docker-compose\.yml$|docs/conventions/commit-convention\.md$)'
    if printf '%s\n' "$changed_files" | grep -Eq "$CORE_PATH_PATTERN"; then
      required_calls=2
    fi
  fi
fi

if [ "$review_calls" -ge "$required_calls" ]; then
  allow
fi

deny "⛔ pr-review-gate: 브랜치 '$branch'(PR 대상: main)의 현재 HEAD(${current_head})가 reviewer 로 충분히 검토되지 않았습니다 (필요 ${required_calls}회, 이 HEAD 기준 확인됨 ${review_calls}회). /review 를 실행해 이 HEAD 를 리뷰한 뒤 다시 push 하세요."
