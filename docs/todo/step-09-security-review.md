# STEP 9 · 🔒 보안 전수 점검

**시작 조건**: STEP 6 + STEP 7 + STEP 8 (구현이 모두 끝난 뒤)

## 목표

[docs/policy](../policy/README.md)의 보안 체크리스트를 **실제 코드로** 하나하나 확인한다.

이건 방어 목적만이 아니다. **심사에서 "프로덕션에 붙여도 되는 도구"라는 주장을 증명하는 자료**가 된다. SBOM(의존성 명세서)과 audit 클린 결과를 첨부할 수 있으면 말에 무게가 실린다.

## 하는 일

- [supply-chain-security.md](../policy/supply-chain-security.md) (S1~S8) 전수 점검
- DB 접근 정책(P1~P8, `docs/policy` 각 파일) 전수 점검
- 컨테이너 하드닝: non-root 실행, 최소 베이스 이미지, Trivy 이미지 스캔
- Node permission model(`--permission`) 적용 — **한계를 알고 쓸 것** (`supply-chain-security.md`의 S6 참고)
- SBOM 생성, `npm audit` 클린 확보

## 완료 조건

체크리스트 전 항목 통과 + SBOM 첨부.

## 리뷰 게이트

- 읽기 전용 강제와 자격증명 처리는 STEP 1에서 이미 2인 리뷰를 거쳤어야 한다
- 제출 전 SBOM + `npm audit` 클린 확보
