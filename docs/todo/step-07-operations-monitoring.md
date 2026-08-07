# STEP 7 · 운영 관찰 (`F5` 완성)

**시작 조건**: [STEP 1C](step-01c-schema-catalog.md) (**STEP 4~6과 병렬 진행 가능**)

## 목표

지금까지는 사용자가 쿼리를 직접 가져와야 했다. 이제 **도구가 먼저 "이 쿼리들이 느립니다"라고 알려준다.** 그리고 거기서 바로 튜닝으로 넘어갈 수 있다.

## 하는 일

- 느린 쿼리 Top-N (`pg_stat_statements`)
- 실행 중인 세션 목록 (`pg_stat_activity`)
- AI가 느린 쿼리의 원인을 요약하고 우선순위를 매김
- 발견한 쿼리를 STEP 6 튜닝 흐름으로 연결

## ⚠️ 반드시 확인해야 할 전제 두 가지

**하나. `pg_stat_statements`는 기본으로 켜져 있지 않다.**
`shared_preload_libraries`에 등록하고 **서버를 재시작**해야 하며, `CREATE EXTENSION`도 필요하다. 읽기 전용 계정으로는 설치할 수 없다. 많은 프로덕션 DB가 이걸 안 켜두고 있다.

→ **대응**: 확장이 없으면 슬로우 쿼리 기능을 숨기고 설치 가이드를 보여준다. 데모 DB에는 시드 단계에서 확실히 켜둔다.

**둘. 순수 읽기 전용 계정으로는 남의 세션 쿼리가 안 보인다.**
`pg_stat_activity`를 일반 계정으로 조회하면 **다른 세션의 `query` 컬럼이 NULL로 마스킹**된다. 보려면 `pg_read_all_stats` 롤이 필요하다.

→ **대응**: 권장 계정 권한을 **"읽기 전용 + `pg_read_all_stats`"**로 명시한다. 이 요구는 이미 [read-only-enforcement.md의 권한 표](../policy/read-only-enforcement.md#콘솔-계정에-정확히-무엇을-주는가)에 반영돼 있다 — **F5를 시연·홍보할 때는 "읽기 전용 계정 하나면 끝"이라고 뭉뚱그리지 않는다.** `pg_read_all_stats`도 읽기 권한이라 "쓰기 권한은 필요 없다"는 주장 자체는 그대로다.

## 완료 조건

느린 쿼리 목록이 뜨고, 목록에서 바로 튜닝 화면으로 넘어갈 수 있다. 확장이 없는 DB에서는 기능이 우아하게 숨겨진다.

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md)
