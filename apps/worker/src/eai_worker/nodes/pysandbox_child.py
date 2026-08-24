"""Python 전처리 노드의 **격리 자식 프로세스** — 사용자 코드가 여기서만 돈다.

이 파일은 일부러 ``eai_worker`` 패키지에 의존하지 않는 **독립 스크립트**다.
부모(pysandbox.py)가 ``python <이 파일 절대경로>`` 로 띄우므로 패키지 __init__ 이
실행되지 않고, 따라서 시크릿·메타DB·Celery·커넥터 드라이버가 이 프로세스에는
아예 로드되지 않는다. import 는 표준 라이브러리로만 한정한다.

격리 수단(리눅스에서 강제, macOS 는 best-effort):
  - resource.setrlimit 로 CPU 시간·주소공간(메모리)·파일쓰기·자식프로세스 제한
  - 부모가 환경변수를 스크럽해 넘기므로 EAI_*/AWS_*/DB URL 이 존재하지 않는다
  - 사용자 코드에 노출하는 builtins 를 화이트리스트로 제한하고, import 는
    안전한 표준 모듈 목록으로만 허용한다 (os·sys·socket·subprocess·open 차단)

프로토콜(부모 stdin → 자식, 자식 stdout → 부모 · 한 줄 = JSON 한 건):
  init  : {"code": "<사용자 코드>"}          → {"ok": true} | {"ok": false, "error": "..."}
  batch : {"rows": [ {...}, ... ]}            → {"ok": true, "rows": [...]}  # None 반환 행은 빠짐
                                              | {"ok": false, "error": "...", "index": i}

경계가 JSON 이라 값은 정규화된다: datetime/date → ISO 문자열, Decimal → 숫자,
bytes → base64 문자열. 사용자 코드는 이 정규화된 뷰를 다룬다.
"""

from __future__ import annotations

import base64
import builtins as _builtins
import contextlib
import datetime as _dt
import decimal as _decimal
import io
import json
import resource
import sys
from typing import Any

# ── 자원 한계 (부모가 argv 로 덮어쓸 수 있다) ──────────────────────────────
# pandas/numpy 를 기본 제공하므로 한계가 넉넉하다: numpy·OpenBLAS 가 큰 가상
# 주소공간을 예약해 256MB 로는 import 조차 못 한다(실측 최소 ≈768MB).
CPU_SECONDS = 15  # pandas import(≈1s) 여유 포함
MEMORY_MB = 1024
FSIZE_BYTES = 0  # 파일 쓰기 전면 차단 (stdout/stderr 는 파이프라 영향 없음)
MAX_CAPTURED_STDOUT = 8192  # 배치당 사용자 print 캡처 상한 (바이트) — 로그 폭주 방지

#: 프로토콜 전용 실제 stdout. 사용자 코드의 print 가 이 채널을 오염시키지 못하도록
#: 시작 시점에 붙잡아 두고, sys.stdout 은 따로 갈아끼운다 (main 참조).
_PROTOCOL_OUT = sys.stdout

# ── 사용자 코드가 import 할 수 있는 모듈 화이트리스트 ──────────────────────
# 순수 데이터 변환에 필요한 것들만. os·sys·socket·subprocess·importlib·pathlib·
# io·open 계열은 의도적으로 제외한다.
#
# pandas·numpy 는 서드파티지만 전처리에 흔히 쓰여 기본 제공한다. 이들 내부의
# os·sys import 는 pandas 모듈 자체의 (제한 없는) 빌트인으로 이뤄지므로 사용자
# 코드의 import 가드와 무관하다 — 사용자가 직접 os 를 import 하는 건 여전히 막힌다.
_ALLOWED_MODULES = frozenset(
    {
        "pandas",
        "numpy",
        "datetime",
        "re",
        "json",
        "math",
        "statistics",
        "hashlib",
        "hmac",
        "decimal",
        "fractions",
        "base64",
        "binascii",
        "uuid",
        "unicodedata",
        "textwrap",
        "string",
        "itertools",
        "functools",
        "collections",
        "collections.abc",
        "random",
        "urllib.parse",
        "html",
        "calendar",
        "zoneinfo",
    }
)

# ── 사용자 코드에 노출할 builtins 화이트리스트 ────────────────────────────
# eval/exec/compile/open/input/__import__/globals/vars/getattr(간접 접근) 등은 제외.
_SAFE_BUILTINS = frozenset(
    {
        "abs", "all", "any", "ascii", "bin", "bool", "bytearray", "bytes",
        "callable", "chr", "complex", "dict", "divmod", "enumerate", "filter",
        "float", "format", "frozenset", "hash", "hex", "int", "isinstance",
        "issubclass", "iter", "len", "list", "map", "max", "min", "next", "oct",
        "ord", "pow", "print", "range", "repr", "reversed", "round", "set",
        "slice", "sorted", "str", "sum", "tuple", "type", "zip",
        "True", "False", "None",
        "KeyError", "ValueError", "TypeError", "IndexError", "ZeroDivisionError",
        "ArithmeticError", "AttributeError", "Exception", "StopIteration",
    }
)


def _apply_limits(cpu_seconds: int, memory_mb: int) -> None:
    """자원 한계를 건다. macOS 는 일부 한계를 강제하지 않으므로 개별 try 로 감싼다."""

    def _try(res: int, soft: int, hard: int) -> None:
        # 이 플랫폼에서 지원하지 않는 한계는 조용히 넘긴다 — best-effort
        with contextlib.suppress(ValueError, OSError):
            resource.setrlimit(res, (soft, hard))

    _try(resource.RLIMIT_CPU, cpu_seconds, cpu_seconds + 1)
    _try(resource.RLIMIT_FSIZE, FSIZE_BYTES, FSIZE_BYTES)
    if memory_mb > 0:
        b = memory_mb * 1024 * 1024
        # RLIMIT_AS(주소공간)가 있으면 그것으로, 없으면 RLIMIT_DATA 로 메모리를 묶는다.
        _try(getattr(resource, "RLIMIT_AS", resource.RLIMIT_DATA), b, b)
    # NPROC 은 걸지 않는다 — numpy/OpenBLAS 가 워커 스레드를 만들어야 하고, NPROC=0 은
    # 그것까지 막아 pandas 를 못 쓰게 한다. 프로세스 생성 방어는 os·subprocess·threading
    # 임포트 차단 + 환경 스크럽으로 대신한다(스레드는 부모가 num-threads=1 로 묶는다).


def _guarded_import(name: str, *args: Any, **kwargs: Any) -> Any:
    """화이트리스트에 있는 표준 모듈만 import 를 허용한다."""
    root = name.split(".")[0]
    if name in _ALLOWED_MODULES or root in _ALLOWED_MODULES:
        return _real_import(name, *args, **kwargs)
    raise ImportError(f"이 노드에서는 '{name}' 모듈을 사용할 수 없습니다")


_real_import = _builtins.__import__


def _build_sandbox_globals() -> dict[str, Any]:
    safe = {k: getattr(_builtins, k) for k in _SAFE_BUILTINS if hasattr(_builtins, k)}
    safe["__import__"] = _guarded_import
    return {"__builtins__": safe}


def _json_default(value: Any) -> Any:
    """JSON 으로 직렬화되지 않는 값을 정규화한다 — 경계를 넘는 유일한 표현."""
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, _decimal.Decimal):
        # 정수면 int, 아니면 float. 문자열 대신 숫자로 둬 downstream 계산을 유지한다.
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (set, frozenset)):
        return list(value)
    # numpy 스칼라(np.int64·np.float64·np.bool_ 등)는 그대로 직렬화되지 않는다 —
    # .item() 으로 파이썬 스칼라로 내린다 (pandas 배치 모드에서 흔히 나온다).
    item = getattr(value, "item", None)
    if callable(item) and not isinstance(value, (str, bytes, bytearray)):
        try:
            return item()
        except (ValueError, TypeError):
            pass
    return str(value)


def _emit(obj: dict[str, Any]) -> None:
    # 프로토콜은 항상 붙잡아 둔 실제 stdout 으로만 나간다 — 사용자 print 로 갈아끼운
    # sys.stdout 을 쓰면 응답이 사용자 출력과 섞여 부모의 파싱이 깨진다.
    _PROTOCOL_OUT.write(json.dumps(obj, ensure_ascii=False, default=_json_default))
    _PROTOCOL_OUT.write("\n")
    _PROTOCOL_OUT.flush()


def main() -> int:
    # argv: [child.py, cpu_seconds, memory_mb]
    cpu_seconds = int(sys.argv[1]) if len(sys.argv) > 1 else CPU_SECONDS
    memory_mb = int(sys.argv[2]) if len(sys.argv) > 2 else MEMORY_MB

    # 첫 줄 = init(코드). 코드를 컴파일·실행해 transform 함수를 얻는다.
    # 한계는 코드 실행 직전에 건다 (컴파일 자체도 사용자 입력이므로 보호 대상).
    init_line = sys.stdin.readline()
    if not init_line:
        return 0
    try:
        code = json.loads(init_line)["code"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        _emit({"ok": False, "error": f"init 파싱 실패: {exc}"})
        return 1

    sandbox = _build_sandbox_globals()
    _apply_limits(cpu_seconds, memory_mb)

    # 이 시점 이후 sys.stdout 은 사용자 코드 몫이다. 실제 프로토콜 채널은 _PROTOCOL_OUT
    # 에 붙잡아 뒀으므로, 사용자 print 를 배치 처리 중에만 버퍼로 가로채고 응답에 실어
    # 부모(런 로그)로 보낸다. 배치 밖에서의 출력은 버려질 뿐 프로토콜을 깨지 않는다.
    capture = io.StringIO()
    sys.stdout = capture

    try:
        # 격리된 자식 프로세스 안에서만 실행 — 부모/워커와 분리돼 있다
        compiled = compile(code, "<pycode-node>", "exec")
        exec(compiled, sandbox)
    except BaseException as exc:  # 사용자 코드의 어떤 예외든 부모에 보고
        _emit({"ok": False, "error": f"코드 실행 오류: {type(exc).__name__}: {exc}"})
        return 1

    # 두 가지 모드를 함수 이름으로 자동 구분한다:
    #   transform(row) -> dict|None       : 행 단위
    #   transform_batch(df) -> DataFrame  : 배치 단위(전체 행을 pandas DataFrame 으로)
    row_fn = sandbox.get("transform")
    batch_fn = sandbox.get("transform_batch")
    if callable(row_fn) and callable(batch_fn):
        _emit({"ok": False, "error": "transform 과 transform_batch 를 동시에 정의할 수 없습니다"})
        return 1
    if callable(batch_fn):
        try:
            pd = _real_import("pandas")
        except ImportError:
            _emit({"ok": False, "error": "배치 모드에는 pandas 가 필요합니다"})
            return 1
        _emit({"ok": True, "mode": "batch"})
        return _run_loop(lambda rows: _apply_batch(batch_fn, rows, pd), capture)
    if callable(row_fn):
        _emit({"ok": True, "mode": "row"})
        return _run_loop(lambda rows: _apply_rows(row_fn, rows), capture)
    _emit({"ok": False, "error": "transform(row) 또는 transform_batch(df) 함수를 정의해야 합니다"})
    return 1


def _apply_rows(fn: Any, rows: list[Any]) -> list[Any]:
    """행 단위: 각 행에 transform 을 적용하고 None 은 제외한다."""
    out: list[Any] = []
    for i, row in enumerate(rows):
        try:
            result = fn(row)
        except BaseException as exc:  # 행 단위 사용자 예외를 위치와 함께 보고
            raise _RowError(i, exc) from exc
        if result is None:
            continue
        out.append(result)
    return out


def _apply_batch(fn: Any, rows: list[Any], pd: Any) -> list[Any]:
    """배치 단위: 전체 행을 DataFrame 으로 만들어 transform_batch 에 넘긴다."""
    df = pd.DataFrame(rows)
    result = fn(df)
    if not isinstance(result, pd.DataFrame):
        raise _BatchError(
            f"transform_batch 는 DataFrame 을 반환해야 합니다 (받은 값: {type(result).__name__})"
        )
    # NaN/NaT → None 으로 정리해 JSON·downstream 적재가 깨지지 않게 한다.
    clean = result.astype(object).where(result.notna(), None)
    records: list[Any] = clean.to_dict("records")
    return records


class _RowError(Exception):
    def __init__(self, index: int, cause: BaseException) -> None:
        self.index = index
        self.cause = cause


class _BatchError(Exception):
    pass


def _run_loop(apply: Any, capture: io.StringIO) -> int:
    """공통 처리 루프 — 각 줄(배치)마다 apply(rows) 를 부르고 결과를 돌려준다."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            rows = json.loads(line)["rows"]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            _emit({"ok": False, "error": f"배치 파싱 실패: {exc}"})
            return 1

        capture.seek(0)
        capture.truncate(0)
        try:
            out = apply(rows)
        except _RowError as exc:
            _emit({"ok": False, "error": f"{type(exc.cause).__name__}: {exc.cause}", "index": exc.index})
            return 1
        except _BatchError as exc:
            _emit({"ok": False, "error": str(exc)})
            return 1
        except BaseException as exc:  # 사용자 코드/변환의 어떤 예외든 부모에 보고
            _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
            return 1

        printed = capture.getvalue()
        if len(printed) > MAX_CAPTURED_STDOUT:
            printed = printed[:MAX_CAPTURED_STDOUT] + "\n…(출력 잘림)"
        reply: dict[str, Any] = {"ok": True, "rows": out}
        if printed:
            reply["stdout"] = printed
        _emit(reply)

    return 0


if __name__ == "__main__":
    sys.exit(main())
