# STEP 12 · 🔒 보안 전수 점검

**시작 조건**: STEP 6 + STEP 7 + STEP 8 + STEP 11 (구현이 모두 끝난 뒤)

## 목표

[docs/policy](../policy/README.md)의 보안 체크리스트를 **실제 코드로** 하나하나 확인한다.

이건 방어 목적만이 아니다. **심사에서 "프로덕션에 붙여도 되는 도구"라는 주장을 증명하는 자료**가 된다. SBOM(의존성 명세서)과 audit 클린 결과를 첨부할 수 있으면 말에 무게가 실린다.

## 하는 일

- [supply-chain-security.md](../policy/supply-chain-security.md) (S1~S9) 전수 점검
- DB 접근 정책(P1~P9, `docs/policy` 각 파일) 전수 점검
- 컨테이너 하드닝: non-root 실행, 최소 베이스 이미지, Trivy 이미지 스캔 — **`worker` 컨테이너도 같은 기준으로**
- Node permission model(`--permission`) 적용 — **한계를 알고 쓸 것** (`supply-chain-security.md`의 S6 참고)
- SBOM 생성, `npm audit` 클린 확보

## 파이프라인 쓰기 경계(P9) 점검

읽기 전용 콘솔에 쓰기 경로가 하나 생겼으므로 **여기가 이번 점검의 새 급소다.** 항목은
[pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)의 리뷰 게이트를 그대로 쓴다.

- [ ] 쿼리 실행 API가 `role='target'` 커넥션을 거부한다 (테스트로 고정)
- [ ] 타깃 커넥션이 콘솔 접속 목록 API 응답에 포함되지 않는다
- [ ] 타깃에 나가는 문장이 커넥터가 생성한 세 가지 형태(`append`/`upsert`/`overwrite`)뿐이다
- [ ] 식별자가 화이트리스트 + 인용을 거친다
- [ ] AI 컨텍스트에 타깃 커넥션 정보가 들어가지 않는다
- [ ] 파이프라인 소스 `query`가 콘솔과 같은 AST 검증기를 통과한다
- [ ] 쓰기가 감사 로그에 커넥션·대상·모드·행수·파이프라인 버전과 함께 남는다
- [ ] `PIPELINE_FILE_ROOT` · `PIPELINE_SPOOL_DIR` 경로 격리가 `../`와 심볼릭 링크를 막는다
- [ ] 커넥터 시크릿이 API 응답·로그·에러 메시지 어디에도 나오지 않는다

## 완료 조건

체크리스트 전 항목 통과 + SBOM 첨부.

## 리뷰 게이트

- 읽기 전용 강제와 자격증명 처리는 STEP 1에서 이미 2인 리뷰를 거쳤어야 한다
- 파이프라인 쓰기 경계는 [STEP 9](step-09-pipeline-foundation.md)에서 이미 2인 리뷰를 거쳤어야 한다
- 제출 전 SBOM + `npm audit` 클린 확보
