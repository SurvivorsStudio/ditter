"""플로우 칩 라벨 — NodeKind 를 추가하고 라벨을 빠뜨리면 UI 에 raw 값이 노출된다."""

from __future__ import annotations

from eai_api.schemas.dag import NodeKind
from eai_api.services.pipeline_service import _FLOW_LABEL


def test_every_node_kind_has_a_label() -> None:
    missing = [str(kind) for kind in NodeKind if str(kind) not in _FLOW_LABEL]
    assert missing == [], f"플로우 라벨이 없는 노드 종류: {missing}"


def test_no_stale_labels() -> None:
    """없어진 노드 종류의 라벨이 남아 있으면 오해를 부른다."""
    known = {str(kind) for kind in NodeKind}
    stale = [key for key in _FLOW_LABEL if key not in known]
    assert stale == [], f"존재하지 않는 노드 종류의 라벨: {stale}"


def test_labels_are_human_readable() -> None:
    """라벨에 'source.' 같은 내부 표기가 새어 나오면 안 된다."""
    leaked = [v for v in _FLOW_LABEL.values() if "." in v]
    assert leaked == [], f"내부 표기가 노출된 라벨: {leaked}"
