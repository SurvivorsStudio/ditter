---
description: Stage & commit the working changes, split by area per the project's commit convention
argument-hint: [commit subject]
---

현재 작업 트리의 변경을 이 프로젝트의 커밋 규칙(`docs/conventions/commit-convention.md`)에 맞게 의미 단위로
나누어 커밋한다. **커밋만 한다 — push·PR 은 하지 않는다**(그건 `/pr` 가 담당). 테스트도 돌리지
않는다.

## Procedure

### 0. 변경 파악
- `git status --porcelain` 와 `git diff`(+ 스테이징된 게 있으면 `git diff --cached`)로 무엇이
  어디서 바뀌었는지 파악한다. 이미 스테이징된 변경도 함께 고려한다.
- 커밋할 변경이 없으면 그 사실만 보고하고 멈춘다.

### 1. 커밋 분할 — `docs/conventions/commit-convention.md` 준수
- **1차 분할(필수)**: 한 커밋에는 아래 영역 **중 하나만** 담는다 — `apps/api/` · `apps/web/` ·
  `apps/worker/` · `apps/connectors/` · `apps/sap-connector/` · `cdc/` · `sync/` · `docs/`(+ `README.md`·
  `CLAUDE.md`). 변경이 둘 이상 영역에 걸치면 **커밋을 나눈다**(예: API 라우터 구현은 `apps/api/`
  커밋, 문서 갱신은 `docs/` 커밋). `apps/connectors/`(공유 라이브러리)와 이를 쓰는 `apps/api/`·
  `apps/worker/` 코드를 함께 고쳤다면 **커넥터 커밋을 소비 측 커밋보다 먼저** 올린다. 위 영역
  밖(루트 설정·`.claude/`·`.github/`·`docker-compose.yml`·`참고용/`)은 그 목적 하나로 별도 커밋.
- **2차 분할**: 같은 영역 안에서도 서로 다른 타입·모듈·주제면 나눈다. 리팩터/포맷과
  동작 변경을 한 커밋에 섞지 않는다.
- 분할 결과(어떤 파일이 어떤 커밋으로 가는지)를 먼저 사용자에게 보여주고, 영역이 섞여 여러
  커밋으로 나뉘는 경우 진행 전에 확인받는다. 단일 영역·단일 목적이면 바로 진행한다.

### 2. 커밋 메시지 — 컨벤션
- 형식: `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문.
  - 타입은 `fix` `feat` `docs` `build` `refactor` `test` `chore` 만 사용.
  - 제목 50자 이내, 현재형·명령문. 본문은 변경 이유·내용을 `-` 글머리로.
  - 관련 이슈·맥락이 있으면 본문에 명시.
- 인자로 제목이 주어지면 단일 영역 변경에 한해 그 제목을 쓰고, 영역이 섞였으면 규칙대로 쪼갠다.

### 3. 커밋 실행
- 각 커밋마다 해당 경로만 `git add` 해서 영역이 섞이지 않게 한다(`git add <영역 경로>`).
- `--no-verify` 등 hook 우회 옵션은 사용하지 않는다.

### 4. Report
- 생성된 커밋들의 해시·제목을 순서대로 보고한다. (push 가 필요하면 `/pr` 안내.)

## Notes
- 한 영역에 커밋이 여러 개여도 된다. 되돌리기·리뷰 단위는 커밋.
- 커밋 단위·메시지 정책의 본문은 `docs/conventions/commit-convention.md` (SSOT).
