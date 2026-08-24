"""격리 자식 프로세스(pysandbox) 자체의 보안·자원 보장 검증.

실제 subprocess 를 띄우므로 느리다. 여기서는 transform 노드가 아니라 PySandbox 를
직접 조립해 타임아웃·환경 스크럽·차단 규칙을 확인한다.
"""

from __future__ import annotations

import pytest
from eai_connectors.errors import ConfigurationError

from eai_worker.nodes.pysandbox import PySandbox

PASS = "def transform(row):\n    return row"


def test_basic_roundtrip() -> None:
    with PySandbox(PASS) as sb:
        assert sb.run_batch([{"a": 1}, {"a": 2}]) == [{"a": 1}, {"a": 2}]


def test_none_drops_row() -> None:
    code = "def transform(row):\n    return row if row['keep'] else None"
    with PySandbox(code) as sb:
        assert sb.run_batch([{"keep": True, "v": 1}, {"keep": False, "v": 2}]) == [
            {"keep": True, "v": 1}
        ]


def test_timeout_kills_runaway_loop() -> None:
    code = "def transform(row):\n    while True:\n        pass"
    with (
        PySandbox(code, batch_timeout_sec=1.5, cpu_seconds=1) as sb,
        pytest.raises(ConfigurationError, match=r"제한시간|종료"),
    ):
        sb.run_batch([{"a": 1}])


def test_env_is_scrubbed(monkeypatch: pytest.MonkeyPatch) -> None:
    """부모에 시크릿이 있어도 자식은 그 환경변수를 읽을 수 없다.

    os 모듈 import 가 막혀 있어 애초에 os.environ 에 닿을 길이 없다 — 그 차단을 확인해
    "자식은 어떤 환경변수도 볼 수 없다"를 보장한다.
    """
    monkeypatch.setenv("EAI_JWT_SECRET", "super-secret")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "aws-secret")
    # 최상위 import os 는 코드 로드(init) 시점에 막혀 진입에서 바로 실패한다.
    code = "import os\ndef transform(row):\n    return row"
    with pytest.raises(ConfigurationError, match="os"), PySandbox(code):
        pass


def test_blocked_builtins_open() -> None:
    code = "def transform(row):\n    open('/etc/passwd')\n    return row"
    with PySandbox(code) as sb, pytest.raises(ConfigurationError, match=r"open|NameError"):
        sb.run_batch([{"a": 1}])


def test_missing_transform_rejected() -> None:
    with pytest.raises(ConfigurationError, match="transform"), PySandbox("x = 1"):
        pass


def test_syntax_error_rejected() -> None:
    with pytest.raises(ConfigurationError), PySandbox("def transform(row) return row"):
        pass


def test_reuse_across_batches() -> None:
    # 노드 실행당 자식 하나로 여러 배치를 처리한다.
    code = "def transform(row):\n    row['n'] = row['n'] + 1\n    return row"
    with PySandbox(code) as sb:
        assert sb.run_batch([{"n": 1}]) == [{"n": 2}]
        assert sb.run_batch([{"n": 10}]) == [{"n": 11}]


def test_print_does_not_corrupt_protocol_and_is_captured() -> None:
    # 사용자 print 는 프로토콜 stdout 을 오염시키면 안 되고, 캡처돼 콜백으로 와야 한다.
    captured: list[str] = []
    code = "def transform(row):\n    print('debug', row['v'])\n    return row"
    with PySandbox(code, on_output=captured.append) as sb:
        assert sb.run_batch([{"v": 1}, {"v": 2}]) == [{"v": 1}, {"v": 2}]
    joined = "".join(captured)
    assert "debug 1" in joined and "debug 2" in joined


def test_print_batch_isolated() -> None:
    # 배치마다 캡처가 초기화돼 이전 배치의 출력이 다음에 새지 않는다.
    captured: list[str] = []
    code = "def transform(row):\n    print(row['tag'])\n    return row"
    with PySandbox(code, on_output=captured.append) as sb:
        sb.run_batch([{"tag": "A"}])
        sb.run_batch([{"tag": "B"}])
    assert captured[0].strip() == "A"
    assert captured[1].strip() == "B"


def test_pandas_available() -> None:
    # pandas 는 기본 제공된다 (기본 메모리 한계가 numpy·OpenBLAS 를 감당해야 한다).
    pytest.importorskip("pandas")
    code = (
        "import pandas as pd\n"
        "def transform(row):\n"
        "    row['ts'] = pd.Timestamp(row['t']).year\n"
        "    return row"
    )
    with PySandbox(code) as sb:
        assert sb.run_batch([{"t": "2026-08-05"}]) == [{"t": "2026-08-05", "ts": 2026}]


def test_user_os_import_still_blocked_with_pandas_enabled() -> None:
    # pandas 를 허용해도 사용자가 직접 os 를 import 하는 것은 여전히 막힌다.
    with pytest.raises(ConfigurationError, match="os"), PySandbox(
        "import os\ndef transform(row):\n    return row"
    ):
        pass


def test_batch_mode_detected_and_processes_whole_df() -> None:
    pytest.importorskip("pandas")
    # transform_batch 를 정의하면 배치 모드로 뜨고, 전체 행을 DataFrame 으로 받는다.
    code = (
        "import pandas as pd\n"
        "def transform_batch(df):\n"
        "    df['total'] = df['a'] + df['b']\n"
        "    return df.sort_values('total', ascending=False)\n"
    )
    with PySandbox(code) as sb:
        assert sb.mode == "batch"
        out = sb.run_batch([{"a": 1, "b": 4}, {"a": 5, "b": 5}, {"a": 2, "b": 0}])
    assert [r["total"] for r in out] == [10, 5, 2]


def test_batch_mode_groupby_reduces_rows() -> None:
    pytest.importorskip("pandas")
    code = (
        "def transform_batch(df):\n"
        "    return df.groupby('g', as_index=False)['v'].sum()\n"
    )
    with PySandbox(code) as sb:
        out = sb.run_batch([{"g": "x", "v": 1}, {"g": "x", "v": 2}, {"g": "y", "v": 5}])
    assert sorted((r["g"], r["v"]) for r in out) == [("x", 3), ("y", 5)]


def test_batch_mode_nan_becomes_none() -> None:
    pytest.importorskip("pandas")
    # 병합·재색인으로 생긴 NaN 은 None 으로 정리돼 JSON·적재가 깨지지 않는다.
    code = (
        "def transform_batch(df):\n"
        "    df.loc[df['keep'] == 0, 'val'] = None\n"
        "    return df\n"
    )
    with PySandbox(code) as sb:
        out = sb.run_batch([{"keep": 1, "val": 10}, {"keep": 0, "val": 20}])
    assert out[1]["val"] is None


def test_batch_mode_must_return_dataframe() -> None:
    pytest.importorskip("pandas")
    code = "def transform_batch(df):\n    return df.to_dict('records')"
    with PySandbox(code) as sb, pytest.raises(ConfigurationError, match="DataFrame"):
        sb.run_batch([{"a": 1}])


def test_both_functions_rejected() -> None:
    code = "def transform(row):\n    return row\ndef transform_batch(df):\n    return df"
    with pytest.raises(ConfigurationError, match="동시에"), PySandbox(code):
        pass
