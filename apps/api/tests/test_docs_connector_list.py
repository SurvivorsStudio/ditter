"""문서의 **커넥터 목록**이 실제 ``ConnectorType`` 과 어긋나지 않게 한다.

README·CLAUDE.md 의 구조 트리가 커넥터를 6종에 멈춰 둔 것을 뒤늦게 발견했다. 실제는
10종이었고, 특히 **AI 를 커넥터로 다룬다는 것이 README 서두의 핵심 주장인데 정작 구조
블록에는 그 커넥터가 없었다.**

검사 범위를 「문서 어딘가」가 아니라 **그 목록 자리**로 좁히는 것이 이 파일의 요점이다.
파일 전체를 훑으면 AI 커넥터 이름이 다른 절(README 「AI 모델」)에 있어 **고치기 전에도
통과한다** — 실제로 그렇게 짰다가 통과하는 것을 보고 다시 썼다. 통과만 보고 넘어갔으면
커버리지를 주장만 하는 테스트가 남을 뻔했다.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from eai_connectors.base import ConnectorType

_REPO = Path(__file__).resolve().parents[3]

#: 커넥터 종류 → 목록에 나와야 하는 표기(하나라도 맞으면 통과).
#: 사람이 읽는 글이라 ``sap_rfc`` 대신 「SAP RFC」로 쓰는 편이 자연스럽다.
_ALIASES: dict[ConnectorType, tuple[str, ...]] = {
    ConnectorType.MYSQL: ("MySQL", "mysql"),
    ConnectorType.POSTGRES: ("PostgreSQL", "postgres"),
    ConnectorType.MSSQL: ("MSSQL", "SQL Server", "mssql"),
    ConnectorType.MONGO: ("MongoDB", "mongo"),
    ConnectorType.SAP_RFC: ("SAP RFC", "SAP", "sap_rfc"),
    ConnectorType.S3: ("S3", "s3"),
    ConnectorType.LOCAL_FILE: ("로컬파일", "로컬 파일", "local_file"),
    ConnectorType.GEMINI: ("Gemini", "gemini"),
    ConnectorType.BEDROCK: ("Bedrock", "bedrock"),
    ConnectorType.OLLAMA: ("Ollama", "ollama"),
}

_FENCE = re.compile(r"^```.*?^```", re.M | re.S)


def _structure_block(text: str) -> str:
    """커넥터 목록이 든 구조 트리(펜스 코드블록)만 떼어 낸다."""
    for block in _FENCE.findall(text):
        if "connectors/" in block:
            return block
    raise AssertionError(
        "구조 트리에서 `connectors/` 를 찾지 못했다. 트리가 옮겨졌거나 사라졌다 — "
        "이 테스트가 무엇을 검사하는지부터 다시 정해야 한다."
    )


def _architecture_table(text: str) -> str:
    """ARCHITECTURE 의 「지금 있는 커넥터」 표. 다음 제목 앞에서 끊는다."""
    start = text.index("### 지금 있는 커넥터")
    end = text.index("\n#", start + 1)
    return text[start:end]


_SECTIONS = {
    "README.md": _structure_block,
    "CLAUDE.md": _structure_block,
    "docs/ARCHITECTURE.md": _architecture_table,
}


def test_alias_table_covers_every_connector_type() -> None:
    """새 커넥터를 만들면 여기부터 걸린다 — 그다음이 문서다."""
    assert set(_ALIASES) == set(ConnectorType)


@pytest.mark.parametrize("doc", sorted(_SECTIONS))
def test_connector_list_matches_reality(doc: str) -> None:
    section = _SECTIONS[doc]((_REPO / doc).read_text(encoding="utf-8"))
    missing = [k.value for k, names in _ALIASES.items() if not any(n in section for n in names)]
    assert not missing, (
        f"{doc} 의 커넥터 목록에 없는 것: {missing}. "
        "커넥터를 늘렸으면 문서의 목록도 함께 늘린다 — 한쪽만 고치면 문서가 거짓말을 한다."
    )
