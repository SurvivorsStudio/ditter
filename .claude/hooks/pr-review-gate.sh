#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash).
#
# 목적: 이 세션에서 `reviewer` 서브에이전트를 실제로 호출한 기록 없이 PR 트랙 브랜치
# (feature/*, bug/*, fix/* — main 으로 향하는 브랜치)에서 `git push` 하면 막는다.
# /review 또는 /pr 이 reviewer 를 호출하고 나면 이 게이트는 통과된다.
#
# 설계 원칙 = fail-open. "확실히 reviewer 를 안 돌린 PR 트랙 브랜치 push" 일 때만 deny 한다.
# 그 외 모든 불확실한 상황(jq 없음, stdin 파싱 실패, 브랜치 판별 실패, git push 가 아님,
# PR 트랙 브랜치가 아님, transcript 를 못 읽음)은 전부 allow 한다. deny 를 잘못 내리는 비용이
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
# 방식으론 못 막는다. 그래서 "명령 문자열의 첫 줄이 곧바로 git push 로 시작하는가"만
# 본다. 이 저장소의 실제 push 는 항상 `git push -u origin HEAD` 형태의 단독 명령이라
# 이 조건으로 충분하고, 다른 명령 뒤에 이어지거나 첫 줄이 아닌 곳의 push 는 놓칠 수
# 있지만 그건 fail-open 방향의 누락이라 허용한다.
first_line="$(printf '%s\n' "$command_str" | head -n 1)"
printf '%s' "$first_line" | grep -Eq '^[[:space:]]*git[[:space:]]+push([[:space:]]|$)' || allow

# 현재 브랜치 판별 — 실패하거나(디태치드 HEAD 등) main/알 수 없는 브랜치면 통과.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || allow
[ -n "$branch" ] && [ "$branch" != "HEAD" ] || allow
case "$branch" in
  feature/* | bug/* | fix/*) ;;
  *) allow ;;
esac

transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)" || allow
[ -n "$transcript_path" ] && [ -r "$transcript_path" ] || allow

# 이 세션 transcript 에서 reviewer 서브에이전트 호출 기록 개수를 센다.
review_calls="$(grep -Eo '"subagent_type"[[:space:]]*:[[:space:]]*"reviewer"' "$transcript_path" 2>/dev/null | wc -l | tr -d '[:space:]')"
[ -n "$review_calls" ] || review_calls=0

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

deny "⛔ pr-review-gate: 브랜치 '$branch'(PR 대상: main)에 대해 reviewer 서브에이전트 호출 기록이 부족합니다 (필요 ${required_calls}회, 확인됨 ${review_calls}회). /review 를 먼저 실행하세요."
