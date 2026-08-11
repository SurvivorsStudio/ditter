# 공급망 보안 (S1~S9)

> S1~S8은 의존성 생태계 — **프런트엔드는 npm, 백엔드·워커는 PyPI** — 를 다룬다. S9는 CI가 끌어다
> 쓰는 GitHub Actions를 다룬다.

## 먼저, 오해 하나를 정리한다

"인터프리터 언어는 보안이 약하다"는 인식은 정확하지 않다. Node(V8)도 Python(CPython)도 **메모리
안전 언어**라 C/C++ 같은 버퍼 오버플로우 취약점이 원천적으로 없다.

두 생태계 모두 진짜 실체는 **의존성(공급망)**이다. Go나 Rust로 바꿔도 [프로덕션 DB 접근 관련
정책](read-only-enforcement.md)을 잘못 짜면 똑같이 뚫린다 — DITTER의 진짜 급소는 언어와 무관한
항목들이다.

## 체크리스트

| # | 항목 | 무엇을 | 적용 대상 | 언제 |
|---|---|---|---|---|
| S1 | 의존성 최소화 | 새 패키지 추가 전 "직접 20줄로 짤 수 있나" 먼저 묻는다 | 공통 | 상시 |
| S2 | lockfile 고정 | `package-lock.json`(프런트) · `uv.lock`(백엔드·워커) 커밋 필수. CI는 `npm ci` / `uv sync --locked`만 | 공통 | STEP 0 |
| S3 | 취약점 스캔 자동화 | CI에 `npm audit --audit-level=high`(프런트) + `pip-audit`(백엔드·워커) 게이트 + Dependabot(둘 다) | 공통 | STEP 0 |
| S4 | 의존성 가시화 | `npm ls --all` / `uv tree` 정기 점검, SBOM 생성해 릴리스에 첨부 | 공통 | STEP 12 |
| S5 | 설치 스크립트 차단 | 프런트: `npm ci --ignore-scripts`. 백엔드·워커: **소스 배포판(sdist)의 임의 빌드 훅을 피하고 `uv sync --no-build`로 휠(wheel)만 설치**한다 — sdist는 설치 시 임의 Python 코드(`setup.py`)를 실행할 수 있다 | 공통(방식은 다름) | STEP 0 |
| S6 | 런타임 권한 제한 | 프런트 빌드 도구는 Node의 `--permission`으로 제한 가능. **백엔드·워커(Python)에는 이에 대응하는 언어 차원 기능이 없다** — 아래 "S6의 한계" 참고 | 공통(백엔드·워커는 S7로 보완) | STEP 12 |
| S7 | 컨테이너 격리 | non-root 실행, 최소 베이스 이미지, Trivy 스캔 | 공통 | STEP 12 |
| S8 | 검증되지 않은 입력의 객체 병합 방어 | 백엔드: Pydantic `extra="forbid"` + 검증된 필드만 옮겨 담기 ([backend-fastapi.md](../conventions/backend-fastapi.md)) | 백엔드 | **STEP 1** — 첫 라우트와 함께 |
| S9 | GitHub Actions 고정 | 워크플로의 `uses:`를 커밋 SHA로 고정하고 버전은 주석으로 남긴다 | 공통 | STEP 0 |

### S9는 npm·PyPI 게이트를 우회하는 경로를 막는다

`actions/checkout@v4` 같은 버전 태그는 **나중에 다른 커밋을 가리키도록 옮길 수 있다.** 액션 저장소가
침해되어 태그가 이동하면, S2(lockfile 고정)·S5(설치 스크립트 차단)를 아무리 촘촘히 걸어놔도 그
전부를 건너뛰고 CI 러너 안에서 임의 코드가 실행된다. 그래서 `uses:`는 40자 커밋 SHA로 고정하고
읽는 사람을 위해 `# v4.4.0` 처럼 버전을 주석으로 남긴다.

SHA를 최신으로 유지하는 비용은 Dependabot의 `github-actions` 항목이 흡수한다 — 갱신이 PR로 올라온다.

워크플로 토큰 권한(`permissions:`)도 기본을 `contents: read`로 좁힌다. 배포·퍼블리시 잡을 추가할
때만 필요한 권한을 그 잡에만 준다.

### Dependabot PR 제목 한글화

Dependabot이 여는 PR의 제목·본문은 GitHub 쪽 고정 템플릿이라 언어를 바꿀 수 없다. `.github/workflows/dependabot-korean-title.yml`이 PR이 열릴 때 제목만 규칙 기반으로 한글로 다시 쓰고, 본문 맨 위에 한 줄 요약을 덧붙인다. 본문 원문(릴리스 노트·커밋 로그)은 그대로 둔다 — 전체 번역은 번역 API 호출과 시크릿 등록이 필요해 범위에서 뺐다.

이 워크플로는 PR 코드를 체크아웃하지 않고 `gh` CLI로 메타데이터만 수정하므로 외부 액션에 의존하지 않는다(SHA 고정 대상 자체가 없다). Dependabot PR은 fork가 아니라 저장소 내 브랜치라서 `pull_request_target` 같은 권한 상승 트리거 없이 일반 `pull_request` 트리거로 충분하다. **Dependabot 설정(`.github/dependabot.yml`)에는 `npm`(프런트)과 `pip` 또는 `uv`(백엔드·워커) 두 에코시스템을 모두 등록한다** — 백엔드가 Python이 되면서 빠뜨리기 쉬운 지점이다.

### S5 — Python 쪽 "설치 스크립트"는 npm과 형태가 다르다

npm의 `postinstall` 훅에 대응하는 것은 Python의 **sdist(source distribution) 설치 시 실행되는
`setup.py`/빌드 백엔드 훅**이다. 방어 방식은 다르지만 목적은 같다 — **설치만 했는데 임의 코드가
돈다**는 공급망 침투 경로를 막는 것이다.

- 가능하면 **휠(wheel, `.whl`)만 설치**한다. 휠은 이미 빌드된 아티팩트라 설치 시점에 임의 코드를
  실행하지 않는다. `uv sync`는 기본적으로 휠을 우선하며, `--no-build`로 sdist 빌드 자체를 금지할
  수 있다.
- 그래도 sdist가 필요한 패키지(네이티브 확장 등)가 있다면, 그 패키지만 예외로 남기고 **왜
  필요한지 기록**해 둔다.

### S6의 한계를 알고 쓰라

Node의 permission model은 최신 버전에서 experimental을 졸업해 프런트 빌드 도구 실행 시 쓸 만해졌다.
**Python(CPython)에는 이에 대응하는 언어 차원의 세밀한 권한 모델이 없다** — 백엔드·워커 프로세스는
기본적으로 자신을 실행한 OS 사용자의 권한을 전부 갖는다.

그래서 DITTER는 백엔드·워커에 대해 **S6을 언어 기능이 아니라 S7(컨테이너 격리)로 흡수한다**:

- non-root 실행, 최소 베이스 이미지, 불필요한 OS 패키지 제거.
- 필요하면 컨테이너 런타임의 seccomp/AppArmor 프로파일로 시스템 콜을 제한한다.
- 어느 경우든 SQLite 파일 쓰기와 PostgreSQL·MySQL·AI API로의 아웃바운드 네트워크는 필수라
  **네트워크를 특정 호스트로 좁히는 것은 컨테이너 네트워크 정책의 몫**이다. 언어 차원 플래그로
  대신할 수 없다는 뜻이며, **부분 완화이지 해결책이 아니다**는 원래 결론은 그대로 유효하다.

### S8은 흔한 오해가 있다

Pydantic 스키마 검증(`extra="forbid"`)은 입력 *형태*를 제약할 뿐, 검증되지 않은 딕셔너리를 그대로
객체 생성자에 풀어넣는 습관 자체를 막지는 않는다. Node/Fastify 세계의 prototype pollution
(`__proto__` 오염)은 Python에는 존재하지 않지만, **"검증 없이 병합한다"는 같은 계열의 실수**는
그대로 옮겨온다 — 자세한 내용과 실제 방어 방식은 [backend-fastapi.md](../conventions/backend-fastapi.md)
참고.

**시점은 STEP 1이다.** 외부 입력을 받는 첫 FastAPI 라우트가 거기서 생긴다 — 접속 설정 등록과 쿼리
실행 API다. 이 습관이 첫 라우트보다 늦게 붙으면, 그 사이에 만들어진 라우트들은 방어 없이
작성되고 나중에 전수로 되짚어야 한다.

## 가장 강력한 방어

**의존성을 늘리지 않는 것이다.** "엔진이 가벼웠으면 좋겠다"는 성능 요구인 동시에 보안 요구다. 두 요구가 같은 방향을 가리킨다.

## 관련

- 담당 STEP: [step-00-dev-environment.md](../todo/step-00-dev-environment.md), [step-12-security-review.md](../todo/step-12-security-review.md)
