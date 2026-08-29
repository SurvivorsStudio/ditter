# 다이어그램

`.dot` 이 원본이고 `.png` 는 산출물이다. **`.png` 를 직접 고치지 않는다** — 다음 사람이 고칠 때
원본과 어긋난다.

| 파일 | 무엇을 그리나 | 쓰이는 곳 |
|---|---|---|
| `d1_overall` | 전체 구조 — 계층과 프로세스 경계 | [README 「구조」](../../README.md#구조) · [ARCHITECTURE §1](../ARCHITECTURE.md) |
| `d2_pipeline` | 파이프라인 실행 흐름과 상태가 화면에 닿는 두 경로 | [README](../../README.md#구조) · [ARCHITECTURE §3](../ARCHITECTURE.md) |
| `d3_ingestion` | 수집 경로 네 갈래 (배치 · SAP · CDC · 동기화) | [ARCHITECTURE §6](../ARCHITECTURE.md) |
| `d4_aws` | AWS 배포 — 지금 경로와 Phase 5 로 미뤄 둔 것 | (문서에 싣지 않음) |

## 다시 그리기

```bash
dot -Tpng docs/diagrams/d1_overall.dot -o docs/diagrams/d1_overall.png
```

한글이 **네모(두부)로 나오면 폰트가 없는 것**이다. `.dot` 은 `fontname="Noto Sans CJK KR,Apple
SD Gothic Neo"` 로 두 이름을 적어 둔다 — 앞은 리눅스(`fonts-noto-cjk`), 뒤는 macOS 기본 폰트다.
둘 중 하나만 있으면 된다.

- 리눅스 — `sudo apt install graphviz fonts-noto-cjk`
- macOS — `brew install graphviz` (폰트는 이미 있다)

graphviz 를 깔지 않고 도커로 돌릴 수도 있다. macOS 는 컨테이너에 폰트가 없으므로 호스트 것을
넣어 준다.

```bash
mkdir -p /tmp/cjk && cp /System/Library/Fonts/AppleSDGothicNeo.ttc /tmp/cjk/
```

```bash
docker run --rm --user root -v "$PWD/docs/diagrams":/w -v /tmp/cjk:/fonts:ro -w /w --entrypoint sh nshine/dot -c 'cp /fonts/*.ttc /usr/share/fonts/ && fc-cache -f >/dev/null && for f in *.dot; do dot -Tpng "$f" -o "${f%.dot}.png"; done'
```

## 고칠 때 지킬 것

**그림은 코드보다 조용히 낡는다.** 텍스트는 diff 에 걸리지만 그림은 아무도 열어 보지 않으면
몇 달을 틀린 채로 남는다. 실제로 그렇게 됐던 것 넷을 각 `.dot` 머리말에 적어 두었다 —
고치기 전에 그 주석부터 읽는다.

- **없는 기능을 그리지 않는다.** d1 은 한때 `OAuth2` 를 그렸는데 스키마만 있는 상태였다.
  예정인 것은 「(예정)」이나 별도 표시로 갈라 둔다 (d4 의 Phase 5 상자가 그 예다).
- **화살표 방향이 곧 주장이다.** d2 는 메타DB → WebSocket 으로 그려 "진행률은 메타DB 를 폴링해
  온다"고 말하고 있었다. 실제는 워커 → Redis → WebSocket 이고, 이벤트는 부가 채널이다.
- **격리는 그림에서도 격리여야 한다.** d3 는 워커 안에 `NW RFC SDK` 를 그렸는데, SDK 를
  사이드카에만 두는 것이 이 저장소의 핵심 결정이다 ([ARCHITECTURE §7](../ARCHITECTURE.md)).
- **문서의 단서로 덮지 않는다.** 틀린 그림에 "이 부분은 실제와 다르다"를 붙이면 덮은 것이지
  고친 것이 아니고, 그림 파일을 직접 여는 사람에게는 그 단서가 따라가지 않는다.

그림을 고쳤으면 **그것을 실은 문서의 단서 문단도 함께 줄인다.** 남겨 두면 이번과 반대 방향의
부정확이 된다.
