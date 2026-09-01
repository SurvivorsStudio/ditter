# 커밋·브랜치·머지 컨벤션 (SSOT)

이 문서는 `.claude` 워크플로(`/commit`·`/pr`·`/review`·`/pr-merge`)가 참조하는 커밋 단위·메시지·
브랜치·머지 정책의 단일 출처(SSOT)다. 원격은 GitHub
[SurvivorsStudio/ditter](https://github.com/SurvivorsStudio/ditter).

## 1. 영역(area) — 1차 분할 기준

한 커밋에는 **하나의 영역만** 담는다. 변경이 둘 이상 영역에 걸치면 커밋을 나눈다.

| 영역 | 경로 | 런타임/테스트 |
|---|---|---|
| api | `apps/api/` | Python · uv · pytest / ruff / mypy |
| web | `apps/web/` | Node · npm · vitest / eslint |
| worker | `apps/worker/` | Python · uv · pytest |
| connectors | `apps/connectors/` | Python · uv · pytest (공유 라이브러리) |
| sap-connector | `apps/sap-connector/` | Python · uv · pytest |
| cdc | `cdc/` | 설정(Debezium/Kafka) |
| sync | `sync/` | 설정(SymmetricDS) |
| docs | `docs/` · `README.md` · `CLAUDE.md` | — |

- 위 영역 **밖**(루트 설정 파일·`.claude/`·`.github/`·`docker-compose.yml`)은 그 목적
  하나로 **별도 커밋**한다.
- **의존 순서**: `apps/connectors/` 는 `apps/api/`·`apps/worker/` 가 의존하는 공유 패키지다. 커넥터
  계약을 바꾸면서 소비 측도 함께 고쳤다면 **커넥터 커밋을 소비 측 커밋보다 먼저** 올린다.

## 2. 2차 분할

같은 영역 안에서도 서로 다른 타입·모듈·주제면 커밋을 나눈다. **리팩터/포맷과 동작 변경을 한
커밋에 섞지 않는다.**

## 3. 커밋 메시지 (Conventional Commits)

- 형식: `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문.
- 타입은 `fix` `feat` `docs` `build` `refactor` `test` `chore` 만 사용.
- 제목 50자 이내, 현재형·명령문. 본문에 변경 이유·내용을 `-` 글머리로. 관련 이슈/맥락은 본문에.

## 4. 브랜치

- `main` 은 팀 공유 브랜치다 — **직접 push 하지 않는다.** 모든 변경은 feature 브랜치 → PR 로.
- 브랜치명 prefix 는 **`feature/`·`fix/`·`bug/` 만** 사용한다(prefix 없는 맨 이름 금지). desc 는
  변경 요지를 소문자·하이픈 슬러그로. 예: `feature/connection-usages`, `fix/explain-cte-parser`.

## 5. 머지 정책

- PR 타깃은 항상 `main`, 머지 전략은 **squash 고정**.
- squash 커밋 메시지도 위 3번 형식(`<타입>: <제목>` + 본문)을 따른다(PR 제목·본문 사용).
- 실제 머지는 `/pr-merge` 가 담당하며, 사전 게이트(승인·CI·충돌·아래 5.1)를 모두 통과할 때만
  머지한다. 그 5.1 이 판정하려면 PR 이 근거 이슈를 선언해야 한다(아래 5.2).

### 5.1 열려 있는 PR 이 다루는 이슈를 먼저 머지하지 않는다

**머지 전에, 그 PR 이 닫는 이슈를 다루는 다른 열린 PR 이 있는지 본다.** 있으면 머지하지 않는다 —
그 PR 에 먼저 알리고 **이어받을지 갈라설지**를 정한 뒤에 진행한다. 막는 것이 목적이 아니라
**알리는 것**이 목적이다.

두 PR 이 같은 이슈를 닫겠다고 선언한 상태 자체가 문제다. 그래서 정리되면 게이트는 저절로 열린다 —
이어받거나 합의로 닫으면 열린 PR 이 사라지고, 갈라섰다면 그 PR 의 `Closes #N` 이 실제로 닫는 것에
맞게 바뀐다. 통과시키는 버튼을 따로 두지 않는 이유다.

이 절이 규율하는 것은 **머지 시점**이다. **착수 시점**("열려 있는 PR 이 다루는 이슈는 고치기
시작하지도 않는다")은 [CONTRIBUTING.md](../../CONTRIBUTING.md) 「메인테이너에게」가 소유한다 —
게이트는 머지 버튼 앞에서만 작동하므로 앞단을 대체하지 못한다. 닫을 때 남길 것 셋과 이 규칙을
한 번 어겼던 기록도 그 절에 있다.

기계적 확인과 종료 절차는 `/pr-merge` **§1d**(`.claude/commands/pr-merge.md`)에 있다.

### 5.2 PR 은 근거 이슈를 `Closes #N` 으로 선언한다

**어떤 이슈에서 시작한 작업이면 PR 본문에 `Closes #N` 을 적는다.** GitHub 이 그것을 읽어
`closingIssuesReferences` 를 채우고, 머지될 때 이슈를 함께 닫는다.

**편의가 아니라 §5.1 이 성립하기 위한 전제다.** §5.1 의 기계적 확인이 판정하는 근거가 정확히
그 필드다 — 선언하지 않으면 "판정할 것이 없다"로 떨어져 겹치는 PR 을 찾지 못한다. 이 규칙을
세우기 전 실측으로 **최근 머지 30건 중 선언한 PR 은 2건뿐**이었다.

- **없으면 만들지 않는다.** 이슈 없이 시작한 작업에 번호를 지어 붙이면 엉뚱한 이슈를 기준으로
  판정하게 된다. 근거 이슈가 없는 것은 정상이고, §1d 는 그때 판정 근거가 없었다는 사실을 자기
  보고에 남긴다.
- **`Closes` 는 그 PR 이 실제로 닫는 것만** 적는다. 참고로만 관련된 이슈는 `#N` 으로 언급만
  한다 — `Closes` 는 "머지되면 이 이슈는 끝난다"는 선언이고, §5.1 은 그 선언을 근거로 **남의
  PR 을 막는다.**

`/pr` 로 PR 을 만들면 **§6-E**(`.claude/commands/pr.md`)가 이것을 챙긴다. 손으로 여는 PR 에는
그 경로가 없으므로 이 절이 규칙의 출처다.
