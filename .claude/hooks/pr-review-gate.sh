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

# jq·python3 가 없으면 이 게이트 자체를 판단할 수 없다 — 통과시킨다.
command -v jq >/dev/null 2>&1 || allow
command -v python3 >/dev/null 2>&1 || allow

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || allow
[ "$tool_name" = "Bash" ] || allow

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || allow
[ -n "$command_str" ] || allow

# git push 여부 판정.
#
# 이 판정은 세 차례 코드 리뷰에서 세 번 뚫렸다: (1차) 텍스트 전체를 그냥 훑으면 커밋
# 메시지 본문(heredoc)에 "git push"가 텍스트로만 들어있어도 오탐. (2·3차) 그렇다고
# "첫 줄만, 구분자로 나눠서" 보는 정규식 방식으로 좁히면 `&&`/`;`/`|`/`&`는 잡아도
# 줄바꿈으로만 나눈 push, `(git push ...)`처럼 괄호로 감싼 push는 놓치고, 반대로
# 구분자를 넓히면 따옴표 안 텍스트(JSON 등)를 진짜 명령으로 오인해 정상 작업까지
# 차단했다 — fail-open 원칙(놓치는 것보다 잘못 막는 게 훨씬 비싸다)에 정면으로
# 어긋나는 실패 방향이었다.
#
# 그래서 정규식 대신 **실제 셸 토큰화**로 판정한다: Python 표준 라이브러리 `shlex`를
# `punctuation_chars` 옵션으로 써서, 따옴표 안 내용은 통째로 하나의 토큰으로 보존하고
# `&&`·`;`·`|`·`&`·`(`·`)` 는 별도 연산자 토큰으로 분리한다(추가 의존성 없음 — python3
# 표준 모듈만 사용). heredoc 본문은 먼저 구조적으로 제거하고, 줄바꿈은 `;`로 바꿔
# "줄만 나눠 쓴 순차 명령"도 경계로 잡는다(따옴표 안에 있던 실제 개행은 shlex가 여전히
# 하나의 토큰으로 묶어 보존하므로 안전). 연산자 토큰으로 잘린 조각(= 개별 단순 명령)
# 중 하나라도 `git`, `push` 로 시작하면 push 로 판정한다.
#
# 알려진 한계(문서화된 fail-open 허용 범위): `nohup`/`time`/`sudo` 같은 프로세스
# 래퍼로 감싼 push. 이런 형태는 실수로 흔히 쓰이지 않아 우선순위가 낮다고 판단했다.
# (`$(git push ...)` 형태의 command substitution은 못 잡을 것으로 처음엔 예상했지만
# 실측 결과 정상 탐지된다 — 5차 코드 리뷰에서 확인, 이 목록에서 제외.) 셸 문법
# 자체가 깨져 파싱이 실패하면(닫히지 않은 따옴표 등) push 가 아니라고 본다(fail-open).
is_git_push="$(printf '%s' "$command_str" | python3 -c "
import re, shlex, sys

HEREDOC_RE = re.compile(r\"<<-?~?(['\\\"]?)([A-Za-z_][A-Za-z0-9_]*)\1\")


def strip_heredoc_bodies(text):
    out, in_heredoc, delim = [], False, None
    for line in text.split('\n'):
        if in_heredoc:
            if line.strip() == delim:
                in_heredoc, delim = False, None
            continue
        m = HEREDOC_RE.search(line)
        if m:
            # heredoc 여는 토큰(<<EOF 등)만 지운다 — 같은 줄에 이어지는
            # `&& git push` 같은 진짜 명령까지 함께 지우면 그 명령이 검사
            # 대상에서 사라져버린다(5차 코드 리뷰에서 발견·재현됨).
            out.append(line[: m.start()] + line[m.end() :])
            delim, in_heredoc = m.group(2), True
            continue
        out.append(line)
    return '\n'.join(out)


def is_git_push(command_str):
    flattened = strip_heredoc_bodies(command_str).replace('\n', ';')
    try:
        lex = shlex.shlex(flattened, posix=True, punctuation_chars='();&|')
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return False

    # 실제 연산자 외에 셸 예약어도 명령 경계로 취급한다 — 'if true; then git
    # push; fi' 처럼 예약어 바로 뒤에 오는 push 는 연산자 분리만으로는 새
    # 명령의 시작으로 안 잡힌다(5차 코드 리뷰에서 발견·재현됨).
    boundaries = {
        ';', '&', '&&', '|', '||', '(', ')',
        'if', 'then', 'elif', 'else', 'fi',
        'for', 'while', 'until', 'do', 'done',
        'case', 'esac', 'select', 'in',
        '!', '{', '}',
    }
    group = []
    groups = []
    for tok in tokens:
        if tok in boundaries:
            if group:
                groups.append(group)
            group = []
        else:
            group.append(tok)
    if group:
        groups.append(group)

    return any(len(g) >= 2 and g[0] == 'git' and g[1] == 'push' for g in groups)


try:
    print('yes' if is_git_push(sys.stdin.read()) else 'no')
except Exception:
    print('no')
" 2>/dev/null)"
[ "$is_git_push" = "yes" ] || allow

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
