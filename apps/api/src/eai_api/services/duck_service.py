"""DuckDB 연합 조회 — 서로 다른 연결의 테이블을 한 SQL 로 조인한다.

`/connections/{id}/query` 는 **한 연결 안에서만** 돈다. 이기종 조인(WMS 의 MySQL 과
MES 의 PostgreSQL 을 한 번에)은 그 경로로는 표현할 방법이 없다. 그래서 DuckDB 를
가운데 두고, 각 연결을 카탈로그로 붙인 뒤(ATTACH) 한 문장으로 조인한다.
결과를 파이썬으로 꺼내는 구간은 polars 가 맡는다 (Arrow → 행 변환·타입 정규화).

### 사용자가 쓰는 문법

    MySQL             연결이름.데이터베이스.테이블
    PostgreSQL·MSSQL  연결이름[.데이터베이스].스키마.테이블   ← 데이터베이스는 생략 가능

    SELECT * FROM mysql_wms.wms.aaa
    SELECT * FROM postgre_mes.mes.k123.bbb
    SELECT * FROM sqlsrv.dbo.customers          -- 연결에 적힌 데이터베이스를 쓴다

"연결 이름 + 그 엔진의 정식 이름"이 규칙이다. MySQL 의 정식 이름은 `데이터베이스.테이블`,
PostgreSQL·SQL Server 는 `데이터베이스.스키마.테이블` — 단계 수가 갈리는 건 그래서다.
뒤의 둘은 연결이 이미 데이터베이스를 알고 있으므로 그 자리를 생략할 수 있다.

**DuckDB 자체 문법이 아니다.** DuckDB 는 `카탈로그.스키마.테이블` 3단계까지만 안다 —
PostgreSQL 의 4단계는 그대로 넘기면 파싱되지 않는다. 그래서 실행 전에 참조를 찾아
붙인 카탈로그 이름으로 **바꿔 쓴다**(:func:`rewrite`).

연결 이름을 그대로 쓰게 한 이유는 하나다. **DuckDB 가 있다는 사실을 사용자가 몰라도
되게 하려고.** ATTACH·DSN·카탈로그 별칭은 전부 여기서 만들고 화면에는 나가지 않는다.
사용자가 아는 것은 「연결 관리」에 저장해 둔 이름뿐이다.

### 어떤 DB 가 되는가

`ATTACH` 로 붙일 수 있는 DuckDB 확장이 있는 것만 지원한다 — **MySQL · PostgreSQL ·
SQL Server**. 앞의 둘은 코어 확장이고 SQL Server 는 **커뮤니티 확장**(`mssql`)이라
`INSTALL mssql FROM community` 로 받아야 한다.

MongoDB 는 낄 수 없다. `odbc_scanner` 처럼 **함수만 제공하고 ATTACH 를 등록하지 않는**
확장도 마찬가지다 — 카탈로그가 없으면 `연결이름.…` 을 재작성할 대상이 없고, 조인·자동완성도
성립하지 않는다. 억지로 끼우려면 원본 테이블을 통째로 메모리에 당겨와야 하는데,
그건 조회가 아니라 적재다(그 일은 파이프라인이 한다).

### 단계 수가 타입마다 다른 이유

DuckDB 는 붙인 커넥션 하나를 카탈로그 하나로 본다.

- **MySQL** 은 커넥션 하나로 서버의 모든 데이터베이스가 보인다. DuckDB 는 그것을
  스키마로 펼친다 — `카탈로그.데이터베이스.테이블`. 그래서 연결당 한 번만 붙이면 된다.
- **PostgreSQL·SQL Server** 는 커넥션이 데이터베이스 하나에 묶인다. 다른 데이터베이스를
  보려면 따로 붙어야 한다 — 그래서 **(연결, 데이터베이스)** 마다 카탈로그를 만들고,
  사용자가 쓴 데이터베이스 자리는 재작성에서 사라진다(`카탈로그.스키마.테이블`).

즉 3단계/4단계는 우리가 정한 규칙이 아니라 두 DB 의 구조가 다른 결과다.

### 안전장치

1. **읽기 전용** — 단일 SELECT/WITH 만 통과시키고(`ensure_select_only`),
   ATTACH 는 전부 `READ_ONLY` 다. 실수로도 원본을 건드릴 수 없다.
2. **로컬 파일 차단** — DuckDB 는 `read_csv('/etc/passwd')` 로 서버 파일을 읽을 수
   있다. 확장과 ATTACH 를 **다 마친 뒤** `disabled_filesystems` 로 잠근다.
   순서가 곧 안전장치다. `ATTACH ... (TYPE MYSQL)` 도 파일 시스템 계층을 거치므로
   먼저 잠그면 붙는 것 자체가 막히고, 이 설정은 되돌릴 수도 없다(DuckDB 가 거부한다).
   그래서 카탈로그가 늘어날 때마다 허브를 새로 만들어 "붙인다 → 잠근다"를 다시 한다
   (:func:`_ensure_attached`).

   **대가가 있다: 디스크 스필도 함께 막힌다.** DuckDB 는 메모리를 넘으면 임시 파일로
   흘려 계속 도는데 그 길이 끊긴다 — 즉 `memory_limit` 은 "넘으면 느려지는 선"이 아니라
   **넘으면 실패하는 선**이다(:func:`_memory_limit_message`). `allowed_directories` 로
   임시 디렉터리만 열어 두는 길을 시험했지만 1.5.5 에서는 그 설정이 `read_csv` 를
   막지 못해(잠금 여부와 무관) 경계로 쓸 수 없었다.
3. **자격증명은 DuckDB 시크릿으로** — ATTACH 에 연결 문자열을 직접 넘기지 않는다.
   확장마다 파싱 규칙이 다를뿐더러, 실패하면 그 문자열이 에러 메시지에 그대로 실린다
   (:func:`_build_secret`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date, datetime
from datetime import time as clock_time
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Connection
from .connection_service import (
    EXPORT_FORMATS,
    ensure_select_only,
    iter_delimited,
    iter_json,
    resolve_config,
    strip_sql_noise,
)
from .errors import ValidationError

if TYPE_CHECKING:  # pragma: no cover - 타입 전용
    import duckdb

logger = logging.getLogger(__name__)

#: DuckDB 가 ATTACH 로 붙일 수 있는 연결 타입. 프론트 `duckRefs.ts` 의 `DUCK_TYPES` 와
#: 반드시 같아야 한다 — 한쪽만 늘리면 화면에는 보이는데 실행이 거부된다.
DUCK_TYPES = frozenset({"mysql", "postgres", "mssql"})

#: 타입별 DuckDB 확장. `community` 인 것은 `INSTALL … FROM community` 로 받아야 한다 —
#: 코어 저장소에 없어서 그냥 `INSTALL` 하면 못 찾는다.
_EXTENSION: dict[str, tuple[str, bool]] = {
    "mysql": ("mysql", False),
    "postgres": ("postgres", False),
    # SQL Server 는 커뮤니티 확장이다. 코어(postgres·mysql)와 달리 DuckDB 팀이 아니라
    # 커뮤니티가 관리하므로, 배포 플랫폼에 빌드가 없을 수 있다 — 그래서 허브를 만들 때
    # **필요한 것만** 올리고 실패하면 그 타입만 막는다 (다른 연결은 계속 쓸 수 있어야 한다).
    "mssql": ("mssql", True),
}

#: 타입별로 **받아들이는** 참조 단계 수. 위 도크스트링 "단계 수가 타입마다 다른 이유" 참고.
#:
#: PostgreSQL·MSSQL 은 데이터베이스를 생략할 수 있다(3단계) — 연결이 이미 어느
#: 데이터베이스에 붙는지 알고 있어서다. 두 형태가 헷갈리지 않는 이유는 그 엔진들의
#: 테이블이 **반드시 스키마 안에** 있기 때문이다. 3단계는 `스키마.테이블`,
#: 4단계는 `데이터베이스.스키마.테이블` — 다르게 읽힐 여지가 없다.
#:
#: MySQL 에는 생략형을 두지 않는다. `연결.테이블` 2단계는 `별칭.컬럼` 과 구별할 수 없고,
#: 그쪽이 훨씬 흔하다.
_REF_PARTS: dict[str, frozenset[int]] = {
    "mysql": frozenset({3}),
    "postgres": frozenset({3, 4}),
    "mssql": frozenset({3, 4}),
}

_REF_SHAPE = {
    "mysql": "연결이름.데이터베이스.테이블",
    "postgres": "연결이름[.데이터베이스].스키마.테이블",
    "mssql": "연결이름[.데이터베이스].스키마.테이블",
}

#: ATTACH 의 `TYPE …` 과 시크릿의 `TYPE …` 에 쓰는 이름
_DUCK_KIND = {"mysql": "MYSQL", "postgres": "POSTGRES", "mssql": "MSSQL"}

_DEFAULT_PORT = {"mysql": 3306, "postgres": 5432, "mssql": 1433}

#: SELECT 안에 있어도 거부할 DuckDB 고유 구문. `ensure_select_only` 가 이미 단일
#: SELECT 만 통과시키므로 대부분 도달 불가능하지만, 파일·확장·설정에 손대는 통로는
#: 한 겹 더 막아 둔다 (2번 안전장치가 무력화되는 경로가 여기밖에 없다).
_DUCK_FORBIDDEN = re.compile(
    r"\b(attach|detach|install|load|copy|export|import|pragma|checkpoint|force)\b",
    re.IGNORECASE,
)

#: 서버 파일을 읽는 DuckDB 함수들. **이건 보안 경계가 아니다** — 실제 차단은 허브의
#: `disabled_filesystems` 가 한다(목록에 없는 함수까지 막는다). 여기 두는 이유는
#: 메시지다. "Permission Error: File system LocalFileSystem has been disabled" 보다
#: "연합 조회는 DB 만 읽습니다"가 사용자에게 훨씬 쓸모 있다.
_FILE_FUNCS = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|parquet_scan|read_json|read_json_auto|"
    r"read_text|read_blob|read_ndjson|sniff_csv|glob)\s*\(",
    re.IGNORECASE,
)


class DuckError(ValidationError):
    """연합 조회 고유 오류. 라우터에서 ValidationError 와 같은 400 으로 나간다."""


# --------------------------------------------------------------------- 참조 파싱

#: 인용 식별자. 안쪽의 `""` 는 따옴표 한 개를 뜻한다 (SQL 표준).
_QUOTED = r'"(?:[^"]|"")*"'
#: 인용하지 않은 식별자. `[^\W\d]` 는 유니코드 글자·밑줄이라 **한글 연결 이름도 통과**한다.
_BARE = r"[^\W\d][\w$]*"
_PART = rf"(?:{_QUOTED}|{_BARE})"
#: 점으로 이어진 식별자 사슬(2단계 이상). 3~4단계만 참조 후보가 되지만, 오타를 짚어
#: 주려면 2단계도 일단 잡아야 한다.
_CHAIN_RE = re.compile(rf"{_PART}(?:\s*\.\s*{_PART})+")
_PART_RE = re.compile(_PART)


@dataclass(frozen=True, slots=True)
class NodeRefPart:
    """사슬 한 조각. 사용자가 인용했는지를 기억해 둔다."""

    raw: str

    @property
    def name(self) -> str:
        if self.raw.startswith('"') and self.raw.endswith('"') and len(self.raw) >= 2:
            return self.raw[1:-1].replace('""', '"')
        return self.raw


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def mask_noise(sql: str) -> str:
    """문자열 리터럴·주석을 **같은 길이의 공백**으로 덮는다.

    :func:`strip_sql_noise` 와 목적은 같지만 길이를 보존한다는 점이 다르다. 참조를
    찾아 **원문의 그 자리를** 바꿔야 하므로 위치가 어긋나면 안 된다.

    큰따옴표는 덮지 않는다 — SQL 에서 그것은 문자열이 아니라 식별자이고,
    `"운영 MySQL".wms.aaa` 처럼 참조의 일부일 수 있다. 대신 안쪽에 점·따옴표가 있어도
    사슬이 끊기지 않도록 건너뛰기만 한다.
    """
    out = list(sql)
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            end = min(j + 1, n)
            for k in range(i, end):
                out[k] = " "
            i = end
        elif c == '"':
            j = i + 1
            while j < n:
                if sql[j] == '"':
                    if j + 1 < n and sql[j + 1] == '"':
                        j += 2
                        continue
                    break
                j += 1
            i = min(j + 1, n)
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def _split_chain(text: str) -> list[NodeRefPart]:
    return [NodeRefPart(m.group(0)) for m in _PART_RE.finditer(text)]


# ------------------------------------------------------------------ ATTACH 계획


@dataclass(frozen=True, slots=True)
class AttachPlan:
    """DuckDB 에 붙일 카탈로그 하나.

    ``secret_sql`` 에는 **비밀번호가 들어 있다**. 로그·에러 메시지에 절대 싣지 말 것.
    """

    alias: str
    connection_id: str
    connection_name: str
    connection_type: str
    database: str
    #: `CREATE OR REPLACE SECRET …` 원문 (ATTACH 직전에 실행한다)
    secret_sql: str
    #: config/시크릿이 바뀌면 달라진다 — 달라지면 붙인 것을 떼고 다시 붙인다.
    fingerprint: str

    @property
    def secret_name(self) -> str:
        return f"sec_{self.alias}"


def _alias_for(connection_id: str, database: str) -> str:
    """카탈로그 별칭. 연결 이름을 그대로 쓰면 한글·공백·중복이 문제가 되므로 해시로 만든다.

    같은 입력이면 같은 별칭이어야 한다 — 그래야 붙여 둔 것을 재사용한다.
    """
    digest = hashlib.sha256(f"{connection_id}\x00{database}".encode()).hexdigest()[:12]
    return f"eai_{digest}"


def _option(key: str, value: object) -> str:
    """`CREATE SECRET` 옵션 한 개. 숫자는 그대로, 나머지는 SQL 문자열 리터럴로."""
    if isinstance(value, int) and not isinstance(value, bool):
        return f"{key} {value}"
    return f"{key} '" + str(value).replace("'", "''") + "'"


def _build_secret(name: str, conn_type: str, cfg: dict[str, Any], database: str) -> str:
    """접속 정보를 DuckDB **시크릿**으로 만드는 SQL.

    ATTACH 에 연결 문자열을 직접 넘기지 않는 이유가 셋 있다.

    1. **파싱 규칙이 확장마다 다르다.** MySQL 확장은 값의 따옴표를 벗기지 않고
       (`host='h'` → 호스트 이름이 `'h'` 가 된다) 포트는 정수로 곧장 읽는다
       (`port='3306'` → `invalid stoi argument`). 감싸도, 안 감싸도 어느 한쪽이 깨진다.
    2. **그래서 공백·따옴표가 든 비밀번호를 안전하게 실을 방법이 없다.** 시크릿 옵션은
       평범한 SQL 문자열 리터럴이라 `''` 이스케이프 하나로 끝난다.
    3. **실패 메시지에 자격증명이 안 실린다.** ATTACH 는 실패하면 연결 문자열을 그대로
       에러에 담는데, 시크릿을 쓰면 그 자리가 빈 문자열이다. `duckdb_secrets()` 에도
       비밀번호는 `redacted` 로만 보인다.
    """
    options: list[str] = [f"TYPE {_DUCK_KIND[conn_type]}"]
    # MySQL 은 붙고 나면 서버의 모든 데이터베이스가 스키마로 보이므로 DATABASE 는 기본
    # 스키마를 정할 뿐이다. PostgreSQL·MSSQL 은 여기 적은 데이터베이스 하나만 보인다.
    pairs: dict[str, Any] = {
        "HOST": cfg.get("host"),
        "PORT": int(cfg.get("port") or _DEFAULT_PORT[conn_type]),
        "DATABASE": database,
        "USER": cfg.get("user"),
        "PASSWORD": cfg.get("password"),
    }
    # SSL 표기가 엔진마다 다르다. MSSQL 시크릿에는 sslmode 계열 옵션이 아예 없다 —
    # 연결이 기본으로 암호화되고(`use_encrypt=true`) 인증서 신뢰 여부는 받지 않는다.
    if cfg.get("ssl") and conn_type == "postgres":
        pairs["SSLMODE"] = "require"
    elif cfg.get("ssl") and conn_type == "mysql":
        pairs["SSL_MODE"] = "required"
    options += [_option(k, v) for k, v in pairs.items() if v not in (None, "")]
    return f"CREATE OR REPLACE SECRET {name} ({', '.join(options)})"


def _fingerprint(conn_type: str, cfg: dict[str, Any], database: str) -> str:
    payload = {k: v for k, v in cfg.items() if k not in {"pool_size"}}
    return f"{conn_type}|{database}|" + json.dumps(payload, sort_keys=True, default=str)


# ---------------------------------------------------------------------- 재작성


def _duck_connections(session: Session) -> list[Connection]:
    stmt = select(Connection).where(Connection.type.in_(sorted(DUCK_TYPES)))
    return list(session.execute(stmt).scalars())


def _all_connections(session: Session) -> list[Connection]:
    return list(session.execute(select(Connection)).scalars())


#: 인용 없이 그대로 쓸 수 있는 이름. 프론트 `duckRefs.ts` 의 `BARE` 와 같아야 한다.
_PLAIN_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*")


def display_name(name: str) -> str:
    """SQL 에 **그대로 쳐 넣을 수 있는** 형태.

    연결 이름은 사람이 짓는 것이라 `pg-target` 처럼 하이픈이 흔하다. SQL 에서 하이픈은
    빼기라 `pg-target.warehouse.t` 는 `pg` 빼기 `target.warehouse.t` 로 읽힌다 —
    참조가 아예 성립하지 않는다. 그래서 안내에 이름을 실을 때는 **필요하면 인용해서**
    보여 준다. 목록을 그대로 복사했는데 안 되는 것만큼 나쁜 안내가 없다.
    """
    return name if _PLAIN_NAME.fullmatch(name) else _quote_ident(name)


#: 카탈로그 별칭을 짓는 함수 — (연결, 데이터베이스) → 별칭.
AliasFactory = Callable[[Connection, str], str]


def rewrite(
    session: Session, sql: str, *, alias_of: AliasFactory | None = None
) -> tuple[str, list[AttachPlan]]:
    """사용자 SQL 의 `연결이름.…` 참조를 DuckDB 가 아는 이름으로 바꾼다.

    반환: (DuckDB 에 보낼 SQL, 붙여야 할 카탈로그 목록).

    ``alias_of`` 로 별칭 짓는 방식을 갈아 끼울 수 있다. 실행 경로는 기본값(해시)을 쓴다 —
    같은 입력이면 같은 별칭이라 붙여 둔 것을 재사용한다. 사람이 읽을 코드를 만들 때만
    읽기 좋은 이름을 넣는다 (:func:`build_python_script`).

    **머리가 저장된 연결 이름과 일치하는 사슬만** 손댄다. 그 외에는 손대지 않는다 —
    CTE·서브쿼리 별칭까지 건드리면 멀쩡한 쿼리가 깨진다.

    2단계 사슬(`t.col`)은 일치해도 넘어간다. 연결 이름과 같은 별칭을 쓸 수 있고,
    그쪽이 훨씬 흔하기 때문이다. 3단계 이상인데 단계 수가 안 맞으면 **에러로 세운다** —
    그 모양은 별칭일 수 없고, 조용히 넘기면 DuckDB 가 "카탈로그가 없다"고만 말한다.

    PostgreSQL·MSSQL 은 데이터베이스를 생략한 3단계(`연결.스키마.테이블`)도 받는다.
    그때 데이터베이스는 **연결 설정의 것**을 쓴다 (`_REF_PARTS` 주석 참고).
    """
    conns = _duck_connections(session)
    by_name = {c.name.strip().casefold(): c for c in conns}

    masked = mask_noise(sql)
    plans: dict[str, AttachPlan] = {}
    pieces: list[str] = []
    cursor = 0

    for m in _CHAIN_RE.finditer(masked):
        parts = _split_chain(sql[m.start() : m.end()])
        head = parts[0].name.strip().casefold()
        conn = by_name.get(head)
        if conn is None:
            continue
        if len(parts) not in _REF_PARTS[conn.type]:
            if len(parts) < 3:
                continue  # 별칭.컬럼 일 수 있다 — 손대지 않는다
            allowed = "·".join(f"{n}단계" for n in sorted(_REF_PARTS[conn.type]))
            raise DuckError(
                f"「{conn.name}」 은(는) {conn.type.upper()} 연결이라 "
                f"{_REF_SHAPE[conn.type]} ({allowed})로 써야 합니다 — "
                f"받은 것: {'.'.join(p.name for p in parts)}"
            )

        # 데이터베이스를 적었으면 그것, 생략했으면(3단계) 연결 설정의 것.
        wrote_database = conn.type == "mysql" or len(parts) == 4
        if wrote_database:
            database = parts[1].name
        else:
            database = str(conn.config.get("database") or "")
            if not database:
                raise DuckError(
                    f"「{conn.name}」 연결에 데이터베이스가 설정돼 있지 않아 생략할 수 없습니다 "
                    f"— {_REF_SHAPE[conn.type]} 처럼 데이터베이스까지 적으세요."
                )
        # MySQL 은 서버 하나가 카탈로그 하나다 — 데이터베이스별로 따로 붙지 않는다.
        scope = "" if conn.type == "mysql" else database
        alias = alias_of(conn, scope) if alias_of else _alias_for(conn.id, scope)
        if alias not in plans:
            cfg = resolve_config(session, conn)
            plans[alias] = AttachPlan(
                alias=alias,
                connection_id=conn.id,
                connection_name=conn.name,
                connection_type=conn.type,
                database=database,
                secret_sql=_build_secret(f"sec_{alias}", conn.type, cfg, database),
                fingerprint=_fingerprint(conn.type, cfg, database),
            )

        # MySQL: 데이터베이스가 DuckDB 의 스키마로 그대로 보인다 → 이름만 갈아 끼운다.
        # PostgreSQL·MSSQL: 데이터베이스는 ATTACH 로 흡수됐다 → 적었으면 그 자리를 없앤다.
        tail = parts[1:] if conn.type == "mysql" or not wrote_database else parts[2:]
        replacement = ".".join([_quote_ident(alias), *(_quote_ident(p.name) for p in tail)])
        pieces.append(sql[cursor : m.start()])
        pieces.append(replacement)
        cursor = m.end()

    pieces.append(sql[cursor:])
    return "".join(pieces), list(plans.values())


def ensure_duck_select_only(sql: str) -> str:
    """읽기 전용 가드 + DuckDB 고유 구문 차단."""
    q = ensure_select_only(sql)
    scan = strip_sql_noise(q)
    hit = _DUCK_FORBIDDEN.search(scan)
    if hit:
        raise DuckError(
            f"연합 조회에서 쓸 수 없는 구문입니다: {hit.group(0).upper()} "
            "— 조회(SELECT)만 실행할 수 있습니다."
        )
    file_hit = _FILE_FUNCS.search(scan)
    if file_hit:
        raise DuckError(
            f"연합 조회는 데이터베이스만 읽습니다 — 서버 파일은 열 수 없습니다 "
            f"({file_hit.group(1)})."
        )
    return q


# ------------------------------------------------------------------- DuckDB 허브

#: 프로세스마다 DuckDB 인메모리 인스턴스 하나를 두고 카탈로그를 붙인 채 재사용한다.
#: 요청마다 붙였다 떼면 원격 DB 핸드셰이크를 매번 낸다 (연결 캐시와 같은 이유).
_HUB: duckdb.DuckDBPyConnection | None = None
#: 지금 허브에 붙어 있는 카탈로그들 (alias → 계획). 허브를 다시 만들 때 그대로 복원한다.
_ATTACHED: dict[str, AttachPlan] = {}
_HUB_LOCK = threading.RLock()


def _load_extension(hub: duckdb.DuckDBPyConnection, conn_type: str) -> None:
    """그 타입에 필요한 확장을 올린다. 이미 깔려 있으면 LOAD 만으로 끝난다."""
    ext, community = _EXTENSION[conn_type]
    try:
        hub.execute(f"LOAD {ext}")
        return
    except Exception:  # 아직 안 깔린 것뿐일 수 있다 — 받아서 다시 시도한다
        logger.debug("DuckDB %s 확장 LOAD 실패 — INSTALL 시도", ext, exc_info=True)
    hub.execute(f"INSTALL {ext}" + (" FROM community" if community else ""))
    hub.execute(f"LOAD {ext}")


def _new_hub(
    required: set[str], optional: set[str]
) -> tuple[duckdb.DuckDBPyConnection, set[str]]:
    """확장을 올린 새 DuckDB 인스턴스와, **실제로 올라간 타입 집합**을 돌려준다.

    `required` 는 이번 쿼리가 쓰는 타입이라 하나라도 실패하면 세운다.
    `optional` 은 예전에 붙여 둔 카탈로그의 타입이다 — 실패해도 그 카탈로그만 빠진다.

    둘을 가르는 이유는 MSSQL 이 **커뮤니티 확장**이라서다. 배포 플랫폼에 그 빌드가
    없을 수 있는데, 그것 때문에 MySQL·PostgreSQL 조회까지 막히면 안 된다.

    올라간 타입을 `duckdb_extensions()` 로 되묻지 않고 **여기서 세어 돌려주는** 이유:
    그 뷰가 쓰는 이름은 INSTALL 이름과 다르다 (`mysql` → `mysql_scanner`).
    한 번 어긋나면 모든 카탈로그가 조용히 건너뛰어진다.
    """
    import duckdb  # 지연 임포트 — 이 기능을 안 쓰면 프로세스에 올리지 않는다

    settings = get_settings()
    config: dict[str, Any] = {"memory_limit": settings.duckdb_memory_limit}
    if settings.duckdb_extension_dir:
        # 폐쇄망 배포용 — 미리 받아 둔 확장을 여기서 읽는다 (INSTALL 이 네트워크를 타지 않는다)
        config["extension_directory"] = settings.duckdb_extension_dir

    hub = duckdb.connect(":memory:", config=config)
    loaded: set[str] = set()
    for conn_type in sorted(required):
        try:
            _load_extension(hub, conn_type)
        except Exception as exc:
            hub.close()
            ext, community = _EXTENSION[conn_type]
            where = "커뮤니티 확장 저장소" if community else "확장 저장소"
            raise DuckError(
                f"DuckDB {ext} 확장을 준비하지 못했습니다 ({conn_type} 연결에 필요). "
                f"폐쇄망이라면 {where}에서 미리 받아 EAI_DUCKDB_EXTENSION_DIR 로 지정하세요 "
                f"— {str(exc).splitlines()[0]}"
            ) from exc
        loaded.add(conn_type)
    for conn_type in sorted(optional - required):
        try:
            _load_extension(hub, conn_type)
            loaded.add(conn_type)
        except Exception:
            logger.info("확장을 못 올려 이전 카탈로그를 뺍니다: %s", conn_type, exc_info=True)
    return hub, loaded


def _attach(hub: duckdb.DuckDBPyConnection, plan: AttachPlan) -> None:
    """시크릿을 만들고 그것으로 카탈로그를 붙인다 (:func:`_build_secret` 참고)."""
    hub.execute(plan.secret_sql)
    hub.execute(
        f"ATTACH '' AS {_quote_ident(plan.alias)} "
        f"(TYPE {_DUCK_KIND[plan.connection_type]}, READ_ONLY, SECRET {plan.secret_name})"
    )


def _lock_down(hub: duckdb.DuckDBPyConnection) -> None:
    """사용자 SQL 을 받기 전에 로컬 파일 접근을 끊는다.

    **반드시 ATTACH 를 다 한 뒤에** 불러야 한다. `ATTACH ... (TYPE MYSQL)` 도 파일
    시스템 계층을 거치기 때문에, 먼저 잠그면 붙는 것 자체가 막힌다. 그리고 이 설정은
    되돌릴 수 없다 — DuckDB 가 재활성화를 거부한다. 그래서 "붙인다 → 잠근다"가
    한 인스턴스에서 한 번뿐인 흐름이고, 그것이 :func:`_ensure_attached` 가 카탈로그를
    늘릴 때 허브를 새로 만드는 이유다.
    """
    hub.execute("SET disabled_filesystems='LocalFileSystem'")


def _ensure_attached(plans: list[AttachPlan]) -> duckdb.DuckDBPyConnection:
    """필요한 카탈로그가 붙어 있는 허브의 커서를 돌려준다.

    이미 다 붙어 있으면 그대로 재사용한다. 새 카탈로그가 필요하면(또는 연결 설정이
    바뀌었으면) **허브를 새로 만들어** 예전 것까지 함께 붙이고 잠근다. 붙인 목록은
    한 번 쓴 조합이 대부분 다시 쓰이므로, 재구축은 처음 몇 번만 일어나고 그 뒤로는
    캐시가 그대로 산다.

    커서(`hub.cursor()`)를 돌려주는 이유는 스레드 안전이다 — FastAPI 는 요청을
    스레드풀에 흩뿌리는데 DuckDB 커넥션 하나를 여럿이 동시에 쓰면 안 된다.
    """
    global _HUB, _ATTACHED
    with _HUB_LOCK:
        fresh = _HUB is not None and all(
            _ATTACHED.get(p.alias) is not None
            and _ATTACHED[p.alias].fingerprint == p.fingerprint
            for p in plans
        )
        if fresh and _HUB is not None:
            return _HUB.cursor()

        wanted = dict(_ATTACHED)
        wanted.update({p.alias: p for p in plans})
        requested = {p.alias for p in plans}

        # 이번 쿼리가 쓰는 타입만 **필수**다. 예전 카탈로그의 타입은 확장이 안 올라와도
        # 그 카탈로그만 빠질 뿐이어야 한다 — MSSQL(커뮤니티 확장)이 없는 배포에서
        # MySQL·PostgreSQL 조회까지 멈추면 안 된다.
        required = {p.connection_type for p in plans}
        hub, ready = _new_hub(required, {p.connection_type for p in wanted.values()})
        attached: dict[str, AttachPlan] = {}
        try:
            for alias, plan in wanted.items():
                if plan.connection_type not in ready:
                    # 이번 쿼리가 쓰는 타입은 _new_hub 가 이미 보장했다 — 여기 걸리는 것은
                    # 예전 카탈로그뿐이다. 그것 때문에 조회를 세우지 않는다.
                    logger.info(
                        "확장이 없어 이전 카탈로그를 건너뜁니다: %s (%s)",
                        plan.connection_name,
                        plan.connection_type,
                    )
                    continue
                try:
                    _attach(hub, plan)
                except Exception as exc:
                    if alias in requested:
                        # 실패 원문에 DSN(비밀번호 포함)이 실려 오므로 그대로 내보내지 않는다.
                        logger.warning("DuckDB ATTACH 실패: %s", plan.connection_name)
                        raise DuckError(
                            f"「{plan.connection_name}」 에 붙지 못했습니다 "
                            f"(데이터베이스: {plan.database}) — {_scrub(str(exc))}"
                        ) from exc
                    # 이번 쿼리가 안 쓰는 예전 카탈로그다. 그것 때문에 조회를 세우지 않는다.
                    logger.info("이전 카탈로그 재연결 실패 — 목록에서 뺍니다: %s", plan.connection_name)
                    continue
                attached[alias] = plan
            _lock_down(hub)
        except Exception:
            hub.close()
            raise

        # 예전 허브는 닫지 않고 참조만 놓는다. 다른 스레드가 그 커서로 아직 조회 중일 수
        # 있어서다 — 마지막 커서가 사라지면 파이썬이 알아서 닫는다.
        _HUB, _ATTACHED = hub, attached
        return hub.cursor()


def _scrub(message: str) -> str:
    """오류 메시지에 자격증명이 섞여 나가지 않게 한다.

    시크릿을 쓰면 ATTACH 실패 메시지의 연결 문자열 자리가 비어 있어 보통은 지울 것이
    없다. 그래도 한 번 훑는 이유는 드라이버가 **스스로 조립한** 문자열을 되돌려주는
    경우가 있어서다 — 한 번 새면 로그에 영구히 남는 종류라 싸게 한 겹 더 둔다.
    """
    first = message.splitlines()[0]
    return re.sub(
        r"(password|passwd|pwd)\s*=\s*('(?:[^']|'')*'|\S+)",
        r"\1=***",
        first,
        flags=re.IGNORECASE,
    )


def detach_connection(connection_id: str) -> None:
    """연결이 수정·삭제되면 그 연결로 붙인 카탈로그를 버린다.

    허브에서 `DETACH` 만 해도 될 것 같지만, 별칭 목록을 줄인 채로는 다시 붙일 방법이
    없다(허브가 이미 잠겨 있다). 그래서 목록에서 빼고 허브를 통째로 버린다 —
    연결 수정은 드문 일이라 다음 조회가 한 번 다시 붙는 비용이면 충분하다.
    """
    with _HUB_LOCK:
        stale = [a for a, plan in _ATTACHED.items() if plan.connection_id == connection_id]
        if not stale:
            return
        for alias in stale:
            _ATTACHED.pop(alias, None)
        _drop_hub()


# ------------------------------------------------------------------------ 실행


def _sort_clause(sort_col: str | None, sort_dir: str) -> str:
    if not sort_col:
        return ""
    direction = "DESC" if str(sort_dir).lower() == "desc" else "ASC"
    # NULL 위치를 고정한다 — 정렬 방향을 바꿔도 빈 값이 튀어다니지 않는다
    return f" ORDER BY {_quote_ident(sort_col)} {direction} NULLS LAST"


def _filter_clause(filters: list[dict[str, Any]] | None) -> tuple[str, list[Any]]:
    """컬럼 필터(부분 일치)를 WHERE 로. 값은 전부 파라미터로 넘긴다."""
    clauses: list[str] = []
    params: list[Any] = []
    for f in filters or []:
        col = str(f.get("col") or "").strip()
        value = str(f.get("value") or "").strip()
        if not col or not value:
            continue
        clauses.append(f"CAST({_quote_ident(col)} AS VARCHAR) ILIKE ?")
        params.append(f"%{value}%")
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _rows_from(cursor: duckdb.DuckDBPyConnection) -> tuple[list[str], list[dict[str, Any]]]:
    """실행 결과를 Arrow 로 받아 polars 로 행 목록을 만든다.

    Arrow 를 거치는 이유는 타입이다 — `fetchall()` 은 컬럼 이름을 따로 붙여야 하고,
    polars 는 DECIMAL·DATE·LIST·STRUCT 를 파이썬 값으로 정확히 풀어 준다.

    폴백이 있는 이유: polars 는 아직 Arrow 의 INTERVAL(month_day_nano)을 못 읽는다.
    그때는 Arrow 에서 직접 꺼내고 JSON 이 모르는 값만 문자열로 눕힌다 —
    컬럼 하나 때문에 조회 전체가 실패하는 편이 훨씬 나쁘다.
    """
    import polars as pl

    fetch = getattr(cursor, "to_arrow_table", None) or cursor.fetch_arrow_table
    table = fetch()
    names = list(table.column_names)
    try:
        frame = pl.from_arrow(table)
        assert isinstance(frame, pl.DataFrame)  # 테이블을 넣었으니 테이블이 나온다
        return names, frame.to_dicts()
    except Exception:
        logger.debug("polars 변환 실패 — Arrow 직접 변환으로 폴백", exc_info=True)
        return names, [{k: _plain(v) for k, v in row.items()} for row in table.to_pylist()]


#: 라우터(FastAPI 인코더)가 그대로 다룰 수 있는 값들. 나머지는 문자열로 눕힌다.
_JSON_SAFE = (
    str, int, float, bool, bytes, list, dict, date, datetime, clock_time, Decimal, type(None),
)


def _plain(value: Any) -> Any:
    return value if isinstance(value, _JSON_SAFE) else str(value)


#: 메모리가 모자라 디스크로 흘리려다 파일 잠금에 막힐 때 DuckDB 가 내는 문구.
#: 원문("File system LocalFileSystem has been disabled")은 원인을 전혀 알려주지 못한다 —
#: 사용자가 한 일은 조인이 컸던 것뿐인데 파일 시스템 이야기를 듣는다.
_SPILL_BLOCKED = "File system LocalFileSystem has been disabled"


def _memory_limit_message() -> str:
    """메모리 상한 초과를 사용자 언어로.

    연합 조회는 **디스크로 흘리지 않는다.** 서버 파일 접근을 끊어 둔 대가다(도크스트링
    §안전장치 2). 그래서 상한은 "넘으면 느려지는 선"이 아니라 **넘으면 실패하는 선**이고,
    그 사실을 오류가 분명히 말해 줘야 조건을 좁힐 생각을 할 수 있다.
    """
    limit = get_settings().duckdb_memory_limit
    return (
        f"메모리 상한({limit})을 넘었습니다 — 읽는 양을 줄이세요. "
        "WHERE 로 조건을 좁히거나, 필요한 컬럼만 고르거나, 미리 집계해서 가져오면 됩니다. "
        "연합 조회는 디스크로 흘리지 않습니다(서버 파일 접근을 막아 두었습니다). "
        "상한 자체를 올리려면 EAI_DUCKDB_MEMORY_LIMIT 를 조정하세요."
    )


def _execute(
    cursor: duckdb.DuckDBPyConnection, sql: str, params: list[Any]
) -> duckdb.DuckDBPyConnection:
    try:
        return cursor.execute(sql, params) if params else cursor.execute(sql)
    except Exception as exc:
        first = str(exc).splitlines()[0]
        if _SPILL_BLOCKED in first:
            raise DuckError(_memory_limit_message()) from exc
        raise DuckError(f"쿼리 실행 실패: {first}") from exc


def run_query(
    session: Session,
    *,
    query: str,
    limit: int | None = None,
    offset: int = 0,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    filters: list[dict[str, Any]] | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool, int, int | None]:
    """이기종 조회를 실행한다.

    반환: (columns, rows, has_more, elapsed_ms, total).

    페이징은 `LIMIT page+1 OFFSET n` 으로 한다 — 단일 연결 경로처럼 스트림을 앞에서
    버릴 필요가 없다. DuckDB 가 서브쿼리를 그대로 받으므로 사용자 SQL 을 손대지 않는다.
    """
    q = ensure_duck_select_only(query)
    duck_sql, plans = rewrite(session, q)
    if not plans:
        raise no_reference_error(session, q)

    cap = get_settings().query_row_limit
    page = min(limit or cap, cap)
    offset = max(0, offset)
    where, params = _filter_clause(filters)
    base = f"SELECT * FROM (\n{duck_sql}\n) AS _eai_q{where}"

    cursor = _ensure_attached(plans)
    started = time.perf_counter()
    _execute(cursor, f"{base}{_sort_clause(sort_col, sort_dir)} LIMIT {page + 1} OFFSET {offset}", params)
    columns, rows = _rows_from(cursor)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    has_more = len(rows) > page
    rows = rows[:page]
    if not columns and rows:
        columns = list(rows[0].keys())

    total: int | None = None
    if offset == 0:
        # 한 페이지에 다 담겼으면 읽은 수가 곧 전체다 — COUNT 를 또 돌릴 이유가 없다.
        total = _count(cursor, base, params) if has_more else len(rows)
    return columns, rows, has_more, elapsed_ms, total


def _count(cursor: duckdb.DuckDBPyConnection, base: str, params: list[Any]) -> int | None:
    """전체 행 수. 실패하면 None — 건수 표시를 생략할 뿐 조회 자체는 멀쩡하다.

    두 번 시도하는 이유는 DuckDB MySQL 스캐너의 버그다(1.5.5 확인). MySQL 테이블 스캔을
    서브쿼리로 감싼 뒤 COUNT 하면 내부 오류가 난다::

        SELECT COUNT(*) FROM (SELECT * FROM <mysql 테이블>) c
        -- INTERNAL Error: Failed to bind column reference "count_star()"

    COUNT 를 스캔으로 밀어넣는 최적화 경로가 이 모양에서 깨지는 것으로 보인다. 조인이나
    필터가 끼면 그 경로를 안 타서 멀쩡하고, PostgreSQL·MSSQL 도 멀쩡하다. 하필 **테이블
    하나를 그냥 훑어보는** 가장 흔한 모양에서만 터져서, 전체 건수가 조용히 사라진다.

    ``OFFSET 0`` 은 의미상 아무것도 하지 않으면서 그 경로를 비켜 간다. 첫 시도를 그냥
    두는 것은, 멀쩡한 엔진에서까지 우회로를 강제해 최적화를 막지 않기 위해서다.
    """
    for suffix in ("", " OFFSET 0"):
        try:
            _execute(cursor, f"SELECT COUNT(*) FROM (\n{base}{suffix}\n) AS _eai_count", params)
            row = cursor.fetchone()
        except DuckError:
            continue
        return int(row[0]) if row and row[0] is not None else None
    logger.info("전체 건수 계산 실패 — 건수 없이 결과만 돌려준다")
    return None


def federation_reference_hint(session: Session, sql: str) -> str:
    """SQL 이 저장된 연결 이름으로 시작하는 참조를 담고 있으면 안내 문구를 돌려준다.

    **일반 쿼리 탭이 실패했을 때** 부르는 함수다(`connection_service._federation_hint`).
    연합 조회 표기를 일반 탭에 붙여 넣으면 엔진이 "그런 개체 없음"이라고만 답해서,
    표기가 잘못된 게 아니라 **탭을 잘못 골랐다**는 걸 알 방법이 없다.
    """
    masked = mask_noise(sql)
    for conn in _duck_connections(session):
        name = re.escape(conn.name)
        # 인용했든 안 했든 잡는다 — 둘 다 사용자가 쓰는 형태다.
        if re.search(rf'(?:"{name}"|\b{name})\s*\.', masked, re.IGNORECASE):
            return (
                f" — 「{conn.name}」 은(는) 저장된 연결 이름입니다. 여러 연결에 걸친 조회라면 "
                "SQL 편집기의 「연합 조회」 탭에서 실행하세요(일반 탭은 고른 연결로 SQL 을 "
                "그대로 보냅니다)."
            )
    return ""


def no_reference_error(session: Session, sql: str) -> DuckError:
    """참조를 하나도 못 찾았을 때, **왜** 못 찾았는지까지 말해 주는 오류를 만든다.

    "연결 이름으로 시작해야 합니다"만 던지면 정작 흔한 두 원인을 못 짚는다.

    1. 이름에 하이픈이 있어 인용이 필요한데 그냥 쓴 경우 (`pg-target.…`). SQL 에서
       하이픈은 빼기라 참조 자체가 성립하지 않는다 — 목록을 보고 그대로 옮겨 적으면
       바로 걸리는 함정이라 이름을 짚어 알려 준다.
    2. MSSQL·MongoDB 연결을 가리킨 경우. 그 연결은 목록에 아예 없어서, 사용자는
       "이름을 잘못 썼나"만 의심하게 된다. 지원 범위 문제라고 말해 줘야 한다.
    """
    conns = _all_connections(session)
    masked = mask_noise(sql)

    def mentioned(name: str) -> bool:
        return re.search(re.escape(name) + r"\s*\.", masked, re.IGNORECASE) is not None

    unquoted = [
        c.name
        for c in conns
        if c.type in DUCK_TYPES and not _PLAIN_NAME.fullmatch(c.name) and mentioned(c.name)
    ]
    if unquoted:
        shown = ", ".join(display_name(n) for n in unquoted)
        return DuckError(
            f"연결 이름을 큰따옴표로 감싸야 합니다: {shown} — "
            "이름에 하이픈·공백이 있으면 SQL 이 그것을 이름의 일부로 읽지 않습니다."
        )

    unsupported = [c for c in conns if c.type not in DUCK_TYPES and mentioned(c.name)]
    if unsupported:
        listed = ", ".join(f"{c.name}({c.type})" for c in unsupported)
        return DuckError(
            f"연합 조회에 쓸 수 없는 연결입니다: {listed} — "
            "MySQL·PostgreSQL 만 됩니다(DuckDB 확장이 그 둘뿐입니다). "
            "다른 종류는 일반 쿼리 탭에서 조회하세요."
        )

    return DuckError(
        f"연결 참조를 찾지 못했습니다 — {_REF_SHAPE['mysql']} 처럼 "
        f"저장된 연결 이름으로 시작해야 합니다. ({_available(session)})"
    )


def _available(session: Session) -> str:
    """쓸 수 있는 연결 이름 — **SQL 에 그대로 칠 수 있는 형태**로 보여 준다."""
    names = [display_name(c.name) for c in _duck_connections(session)]
    return ("쓸 수 있는 연결: " + ", ".join(names)) if names else "MySQL·PostgreSQL 연결이 없습니다"


def export_rows(
    session: Session,
    *,
    query: str,
    fmt: str = "csv",
    sort_col: str | None = None,
    sort_dir: str = "asc",
    filters: list[dict[str, Any]] | None = None,
) -> tuple[str, str, Iterator[bytes]]:
    """조회 결과를 파일로 내보낸다 (현재 정렬·필터 반영, 서버 상한까지).

    반환: (파일명, MIME, 바이트 스트림). 형식·직렬화는 단일 연결 내보내기와 같은
    것을 쓴다 — 같은 그리드에서 나가는 파일이 형식만 다르면 곤란하다.
    """
    fmt = (fmt or "csv").lower()
    if fmt not in EXPORT_FORMATS:
        raise DuckError(f"지원하지 않는 형식입니다: {fmt} (csv·json·txt 만 됩니다).")
    ext, mime = EXPORT_FORMATS[fmt]

    q = ensure_duck_select_only(query)
    duck_sql, plans = rewrite(session, q)
    if not plans:
        raise no_reference_error(session, q)

    cap = get_settings().export_row_limit
    where, params = _filter_clause(filters)
    base = f"SELECT * FROM (\n{duck_sql}\n) AS _eai_q{where}"
    cursor = _ensure_attached(plans)
    _execute(cursor, f"{base}{_sort_clause(sort_col, sort_dir)} LIMIT {cap}", params)
    columns, rows = _rows_from(cursor)

    if fmt == "json":
        stream = iter_json(iter(rows))
    elif fmt == "txt":
        stream = iter_delimited(columns, iter(rows), "\t")
    else:
        stream = iter_delimited(columns, iter(rows), ",")
    return f"duckdb_result.{ext}", mime, stream


# ------------------------------------------------------- 파이썬 코드로 내보내기


def build_python_script(session: Session, *, query: str) -> str:
    """편집기에서 쓴 연합 쿼리를 그대로 돌아가는 파이썬 스크립트로 만든다.

    문법·재작성은 여기(단일 출처)에서 하고, 코드 모양은 :mod:`duck_script` 가 맡는다.
    실행 경로와 다른 점은 **별칭**뿐이다 — 사람이 읽을 이름을 쓴다.
    """
    from . import duck_script

    q = ensure_duck_select_only(query)
    duck_sql, plans = rewrite(session, q, alias_of=duck_script.script_alias_factory())
    if not plans:
        raise no_reference_error(session, q)
    return duck_script.build(
        session,
        duck_sql=duck_sql,
        plans=plans,
        extension_of=_EXTENSION,
        kind_of=_DUCK_KIND,
        default_port=_DEFAULT_PORT,
    )


def _drop_hub() -> None:
    """허브 참조를 놓는다 (호출자가 _HUB_LOCK 을 쥐고 있어야 한다)."""
    global _HUB
    _HUB = None


def reset_hub() -> None:
    """허브와 붙인 목록을 통째로 버린다 (테스트·설정 변경용). 다음 조회가 새로 만든다."""
    with _HUB_LOCK:
        _ATTACHED.clear()
        _drop_hub()
