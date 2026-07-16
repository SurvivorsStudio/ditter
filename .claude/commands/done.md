---
description: Record the current session's work in the local .done/ directory (gitignored, local-only)
argument-hint: [work title (optional)]
---

현재 대화에서 한 작업을 정리해 `.done/` 디렉토리에 **세션 작업 기록 파일** 하나를 만든다.

> **`.done/` 는 로컬 전용이다 (`.gitignore` 처리됨, 커밋되지 않음).** 내 작업 일지로만 남고
> 팀과 공유되지 않는다. 다음 세션에서 과거 작업을 grep/read 로 참조하는 용도.

## 작업 기록 규칙

1. **파일명**: `YYMMDD_Title.md` (예: `260629_PR-Claude-Review-Port.md`)
   - 인자가 주어지면 제목으로 사용: $ARGUMENTS
   - 인자가 없으면 작업 내용에서 적절한 **영문 제목** 생성 (PascalCase-with-hyphens)
   - **파일 내용(h1 제목·섹션·설명)은 한국어로 작성한다. 파일명만 영문.**

2. **파일 포맷**: 기존 `.done/` 파일들의 형식을 따른다 (없으면 아래 골격으로 시작):
   - `# 제목` (h1)
   - `> Date: YYYY-MM-DD` + `> Branch: branch-name` (blockquote) — Branch 는 현재 브랜치
     (`git rev-parse --abbrev-ref HEAD`). 이 프로젝트의 브랜치 prefix 는 `feature/`·`bug/`·`fix/`.
   - `---` 구분선
   - 이슈별 번호 섹션 (`## 1. 제목`, `## 2. 제목`)
     - 해당될 때 `### Symptom` → `### Cause` → `### Fix` 구조
   - `## Commit History` — 표 형식 (`| Commit | Description |`).
     커밋 타입은 `docs/conventions/commit-convention.md` 의 허용 7종 (`fix`/`feat`/`docs`/`build`/`refactor`/`test`/`chore`).
   - `## Lessons Learned` — 불릿 목록
   - 필요 시 섹션 추가

3. **내용**: 이번 대화에서 해결한 문제, 시도한 접근, 최종 해법, 관련 커밋을 정리한다.

4. **저장 위치**: repo 루트의 `.done/` (없으면 만든다). 파일은 커밋하지 않는다 (gitignore).
