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
#
# ⚠️ 이 훅의 근본 한계(9차 코드 리뷰에서 실제 환경으로 확인): 이건 Bash 도구가 받은
# "명령 문자열"만 텍스트로 분석하는 로컬 안전장치이지, 뚫을 수 없는 강제 수단이 아니다.
# `gp='git push'` 같은 흔한 셸 alias(oh-my-zsh git 플러그인 등으로 아주 흔하게 깔림)로
# push 하면 명령 문자열에 "git"·"push" 라는 글자 자체가 없어서 원천적으로 못 잡는다 —
# heredoc·체이닝 연산자·전역 옵션처럼 "형태를 바꿔 숨기는" 우회와 달리, 텍스트 분석이라는
# 접근 자체의 한계라 토큰화 로직을 아무리 다듬어도 해결되지 않는다. 함수·변수로 감싼 간접
# 호출도 마찬가지다. **진짜 강제가 필요하면 서버 쪽(예: GitHub 브랜치 보호 규칙의 필수 PR
# 리뷰 승인)에 맡겨야 한다** — 이 훅은 그런 서버 쪽 강제를 대체하지 않는다.

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
# 알려진 한계(문서화된 fail-open 허용 범위 — 6차 코드 리뷰에서 발견, 전부 "실수로는
# 안 나오고 의도적으로 만들어야 하는 형태"라 우선순위 낮음으로 합의하고 여기서 멈춤):
#   - `nohup`/`time`/`sudo`/`command`/`exec`/`env`/`xargs` 처럼 뒤 인자를 그대로
#     실행하는 프로세스 래퍼로 감싼 push(9·10차 코드 리뷰에서 `command`/`exec`/`env`
#     추가 확인 — group 의 첫 토큰이 `git` 이 아니게 되어 구조적으로 못 잡는다).
#   - 따옴표/백틱 안에 있는 command substitution — 예: `msg="$(git push ...)"`,
#     `` `git push` ``. shlex 가 따옴표 문자열을 통째로 하나의 토큰으로 보존하는
#     설계(따옴표 안 텍스트 오탐 방지를 위해 의도적으로 그렇게 함) 때문에, 따옴표
#     밖의 `$(git push ...)`(백틱 없이)는 정상 탐지되지만 따옴표 안에 있으면 못 잡는다.
#   - `eval`/`coproc` 처럼 boundaries 에 없는 키워드로 git push 를 감싸는 경우.
#     예약어를 하나씩 나열하는 이 방식은 구조적으로 이런 종류를 전부 막을 순 없다.
# 반대 방향(과차단) 한계도 하나 있다: 한 줄에 heredoc 이 두 개(`<<A <<B`) 있으면
# 두 번째 본문은 안 지워져 그 안 문구가 "git push"로 시작하면 오탐 차단될 수 있다 —
# fail-open 방향(안전한 쪽)이고 이 저장소 워크플로우에서 극히 드문 형태라 방치한다.
# 셸 문법 자체가 깨져 파싱이 실패하면(닫히지 않은 따옴표 등) push 가 아니라고
# 본다(fail-open).
#
# ⚠️ 주의: 아래는 bash 큰따옴표 문자열 안에 파이썬 소스를 통째로 넣은 것이다.
# 이 블록 안(주석 포함!)에서는 큰따옴표와 백틱이 둘 다 bash 에게 특별한 의미를
# 갖는다 — 큰따옴표는 문자열을 조기 종료시키고, 백틱은 그 안의 내용을 명령으로
# 실행하려 한다. 코드 식별자를 강조하려고 무심코 백틱으로 감싸기만 해도 걸린다.
# 실제로 둘 다 사고가 났다: (1) 이스케이프 안 된 큰따옴표 하나 때문에 bash
# 문자열이 끊겨 python3 가 조용히 실패 → is_git_push 가 항상 빈 문자열이 되어
# **모든 push 가 판정 불능으로 fail-open 처리, 게이트 전체가 말없이 무력화**됐다.
# (2) 설명 주석에 쓴 백틱 두 개가 각각 존재하지 않는 명령의 command substitution
# 으로 해석돼 Bash 도구를 호출할 때마다 조용히 실패했다(우연히 스크립트 동작
# 자체는 안 깨졌지만, 트리거 문자만 다를 뿐 (1)과 같은 종류의 결함이었다).
# 이 블록을 고칠 땐 큰따옴표와 백틱을 코드 표기용으로도 그냥 쓰지 마라. 문자
# 그대로 큰따옴표가 필요하면 백슬래시로 이스케이프하고(백틱은 아예 쓰지 않는
# 게 제일 안전하다), 고친 뒤에는 반드시 전체 테스트 배터리를 돌려 게이트가
# 여전히 살아있는지(즉 is_git_push 가 빈 문자열이 아닌지) 확인하라.
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
            # 진짜 명령(예: &&로 이어붙인 git push)까지 함께 지우면 그
            # 명령이 검사 대상에서 사라져버린다(5차 코드 리뷰에서 발견·재현됨).
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

    # 'git' 바로 다음 토큰이 정확히 'push'인지만 보면, 'git --no-pager push'나
    # 'git -C <path> push'처럼 흔히 쓰는 전역 옵션 하나만 끼어도 놓친다 — 이건
    # eval/coproc 같은 의도적 우회가 아니라 아주 평범한 git 사용법이라 7·8차 코드
    # 리뷰에서 실제 위험으로 판단해 고쳤다. 'git'(또는 절대경로로 실행된 git, 예:
    # /usr/bin/git) 다음의 전역 옵션들(-로 시작하는 토큰)을 건너뛰고 그 뒤에 오는
    # 첫 서브커맨드가 push
    # 인지 본다. 아래 목록은 다음 토큰이 그 값인(= 없이 공백으로도 값을 받는)
    # git 전역 옵션 전부를 실제 git(2.55) 실행으로 확인해서 채운 것이다
    # (--super-prefix 는 공백 폼이 안 먹혀 제외).
    GIT_GLOBAL_OPTS_WITH_ARG = {'-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'}

    def group_is_git_push(g):
        if not g:
            return False
        head = g[0]
        if head != 'git' and not head.endswith('/git'):
            return False
        i = 1
        while i < len(g):
            tok = g[i]
            if tok.startswith('-'):
                i += 2 if tok in GIT_GLOBAL_OPTS_WITH_ARG else 1
                continue
            return tok == 'push'
        return False

    return any(group_is_git_push(g) for g in groups)


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
# NOTE: 이 CORE_PATH_PATTERN 은 .claude/commands/review.md 및 .claude/agents/reviewer.md 의
# core paths 목록과 동일하게 유지한다 — 하나를 바꾸면 나머지도 함께 갱신할 것.
required_calls=1
merge_base="$(git merge-base HEAD origin/main 2>/dev/null)"
if [ -n "$merge_base" ]; then
  changed_files="$(git diff --name-only "$merge_base" HEAD 2>/dev/null)"
  if [ -n "$changed_files" ]; then
    CORE_PATH_PATTERN='^(apps/connectors/|apps/[a-z-]+/migrations/|apps/api/alembic\.ini$|apps/api/src/eai_api/auth/|apps/api/src/eai_api/services/(connection_service|duck_service|secrets)\.py$|\.claude/|\.github/|docker-compose\.yml$|docs/conventions/commit-convention\.md$)'
    if printf '%s\n' "$changed_files" | grep -Eq "$CORE_PATH_PATTERN"; then
      required_calls=2
    fi
  fi
fi

if [ "$review_calls" -ge "$required_calls" ]; then
  allow
fi

deny "⛔ pr-review-gate: 브랜치 '$branch'(PR 대상: main)의 현재 HEAD(${current_head})가 reviewer 로 충분히 검토되지 않았습니다 (필요 ${required_calls}회, 이 HEAD 기준 확인됨 ${review_calls}회). /review 를 실행해 이 HEAD 를 리뷰한 뒤 다시 push 하세요."
