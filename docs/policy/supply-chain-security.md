# 공급망 보안 (S1~S9)

> S1~S8은 npm 의존성, S9는 CI가 끌어다 쓰는 GitHub Actions를 다룬다.

## 먼저, 오해 하나를 정리한다

"TypeScript는 Node 기반이라 보안이 약하다"는 인식은 정확하지 않다. Node는 V8 위에서 도는 **메모리 안전 언어**라 C/C++ 같은 버퍼 오버플로우 취약점이 원천적으로 없다.

"Node는 보안이 약하다"는 인식의 실체는 **npm 의존성 생태계(공급망)**다. Go나 Rust로 바꿔도 [프로덕션 DB 접근 관련 정책](read-only-enforcement.md)을 잘못 짜면 똑같이 뚫린다 — DITTER의 진짜 급소는 언어와 무관한 항목들이다.

## 체크리스트

| # | 항목 | 무엇을 | 언제 |
|---|---|---|---|
| S1 | 의존성 최소화 | 새 패키지 추가 전 "직접 20줄로 짤 수 있나" 먼저 묻는다 | 상시 |
| S2 | lockfile 고정 | `package-lock.json` 커밋 필수. CI는 `npm ci`만 (`npm install` 금지) | STEP 0 |
| S3 | 취약점 스캔 자동화 | CI에 `npm audit --audit-level=high` 게이트 + Dependabot | STEP 0 |
| S4 | 의존성 가시화 | `npm ls --all` 정기 점검, SBOM 생성해 릴리스에 첨부 | STEP 9 |
| S5 | 설치 스크립트 차단 | `npm ci --ignore-scripts` 기본화. postinstall이 악성코드 주요 침투 경로 | STEP 0 |
| S6 | 런타임 권한 제한 | Node의 `--permission` 플래그로 파일·네트워크 접근 최소화 | STEP 9 |
| S7 | 컨테이너 격리 | non-root 실행, 최소 베이스 이미지, Trivy 스캔 | STEP 9 |
| S8 | prototype pollution 방어 | Fastify `onProtoPoisoning: 'error'` 확인 + 스키마에 `additionalProperties: false` + `Object.create(null)` | STEP 3 |
| S9 | GitHub Actions 고정 | 워크플로의 `uses:`를 커밋 SHA로 고정하고 버전은 주석으로 남긴다 | STEP 0 |

### S9는 npm 게이트를 우회하는 경로를 막는다

`actions/checkout@v4` 같은 버전 태그는 **나중에 다른 커밋을 가리키도록 옮길 수 있다.** 액션 저장소가
침해되어 태그가 이동하면, S2(lockfile 고정)·S5(설치 스크립트 차단)를 아무리 촘촘히 걸어놔도 그
전부를 건너뛰고 CI 러너 안에서 임의 코드가 실행된다. 그래서 `uses:`는 40자 커밋 SHA로 고정하고
읽는 사람을 위해 `# v4.4.0` 처럼 버전을 주석으로 남긴다.

SHA를 최신으로 유지하는 비용은 Dependabot의 `github-actions` 항목이 흡수한다 — 갱신이 PR로 올라온다.

워크플로 토큰 권한(`permissions:`)도 기본을 `contents: read`로 좁힌다. 배포·퍼블리시 잡을 추가할
때만 필요한 권한을 그 잡에만 준다.

### S6의 한계를 알고 쓰라

Node의 permission model은 최신 버전에서 experimental을 졸업해 쓸 만해졌다. 하지만 DITTER는 SQLite 파일 쓰기와 PostgreSQL·AI API 네트워크가 필수라 결국 플래그를 넓게 열어야 한다. 특히 **`--allow-net`은 특정 호스트로 제한할 수 없다.** 즉 "침해된 패키지가 데이터를 외부로 빼돌리는" 시나리오는 이 플래그로 못 막는다. **부분 완화이지 해결책이 아니다.**

### S8은 흔한 오해가 있다

JSON Schema 검증(Ajv)은 입력 *형태*를 제약할 뿐 `__proto__` 오염 자체를 막는 게 아니다. Fastify의 실제 방어는 내부 secure JSON 파서 설정(`onProtoPoisoning`)에서 온다. 구현 시 기본값을 반드시 확인하라.

## 가장 강력한 방어

**의존성을 늘리지 않는 것이다.** "엔진이 가벼웠으면 좋겠다"는 성능 요구인 동시에 보안 요구다. 두 요구가 같은 방향을 가리킨다.

## 관련

- 담당 STEP: [step-00-dev-environment.md](../todo/step-00-dev-environment.md), [step-09-security-review.md](../todo/step-09-security-review.md)
