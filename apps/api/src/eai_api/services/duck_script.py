"""연합 조회를 **그대로 돌아가는 파이썬 스크립트**로 내보낸다.

편집기에서 쿼리를 맞춰 놓고 나면 그다음에 하고 싶은 일은 대개 정해져 있다 — 노트북에
붙여 넣거나, 배치로 돌리거나, 동료에게 보내는 것. 그때마다 ATTACH·시크릿 조립을 손으로
다시 쓰는 것은 이 기능이 애초에 없애려던 수고다.

세 가지를 지킨다.

1. **붙여 넣고 바로 돌아가야 한다.** 편집기 문법(`연결이름.데이터베이스.테이블`)은 EAI
   안에서만 통하므로, SQL 도 DuckDB 가 아는 카탈로그 이름으로 바꿔 넣는다.
2. **비밀번호는 넣지 않는다.** 코드는 복사되고 커밋된다 — 한 번 새면 되돌릴 수 없다.
   자리는 환경변수로 두고 무엇을 설정해야 하는지 머리말에 적는다.
3. **읽을 수 있어야 한다.** 실행 경로의 해시 별칭(`eai_37e8cde540e6`)이 늘어서 있으면
   어느 연결인지 알 수 없다. 연결 이름을 그대로 쓰되 식별자로 다듬는다.

파일 잠금(`disabled_filesystems`)은 넣지 않는다. 그건 **남의 SQL 을 받는 서버**의 사정이고,
자기 스크립트를 자기가 돌리는 자리에서는 디스크 스필만 막아 손해다.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Connection

if TYPE_CHECKING:  # pragma: no cover - 순환 참조를 피하려고 타입만
    from .duck_service import AliasFactory

#: 환경변수 이름에 쓸 수 없는 글자
_ENV_UNSAFE = re.compile(r"[^A-Z0-9]+")
#: 파이썬/SQL 식별자로 쓸 수 없는 글자
_IDENT_UNSAFE = re.compile(r"[^A-Za-z0-9]+")


def script_alias_factory() -> AliasFactory:
    """사람이 읽을 카탈로그 별칭을 짓는다 — 실행 경로의 해시 별칭과 반대 목적이다.

    연결 이름을 식별자로 다듬어 쓰고, 겹치면 데이터베이스 이름을, 그래도 겹치면 번호를
    붙인다. 같은 (연결, 범위)는 항상 같은 별칭을 받는다 — 한 SQL 안에서 같은 테이블이
    두 번 나오면 다른 카탈로그로 갈라지면 안 된다.
    """
    taken: dict[tuple[str, str], str] = {}
    used: set[str] = set()

    def alias_of(conn: Connection, scope: str) -> str:
        key = (conn.id, scope)
        if key in taken:
            return taken[key]
        base = _IDENT_UNSAFE.sub("_", conn.name).strip("_").lower() or "db"
        if base[0].isdigit():
            base = f"c_{base}"
        candidate = base
        if candidate in used and scope:
            candidate = f"{base}_{_IDENT_UNSAFE.sub('_', scope).strip('_').lower()}"
        n = 2
        while candidate in used:
            candidate = f"{base}_{n}"
            n += 1
        used.add(candidate)
        taken[key] = candidate
        return candidate

    return alias_of


def password_env(alias: str) -> str:
    """그 카탈로그의 비밀번호를 담을 환경변수 이름."""
    return "EAI_PW_" + _ENV_UNSAFE.sub("_", alias.upper()).strip("_")


def _catalog_literal(
    *, alias: str, conn_name: str, conn_type: str, extension: str, community: bool,
    kind: str, options: dict[str, Any], env: str,
) -> str:
    """CATALOGS 목록의 항목 하나 (생성 코드에 그대로 들어간다)."""
    lines = [
        "    {",
        f"        # {conn_name} ({conn_type})",
        f"        {'alias'!r}: {alias!r},",
        f"        {'extension'!r}: {extension!r},",
        f"        {'community'!r}: {community!r},",
        f"        {'kind'!r}: {kind!r},",
        f"        {'options'!r}: {options!r},",
        f"        {'password_env'!r}: {env!r},",
        "    },",
    ]
    return "\n".join(lines)


def build(
    session: Session,
    *,
    duck_sql: str,
    plans: list[Any],
    extension_of: dict[str, tuple[str, bool]],
    kind_of: dict[str, str],
    default_port: dict[str, int],
) -> str:
    """재작성된 SQL + ATTACH 계획을 스크립트 한 편으로 조립한다.

    ``duck_service`` 에서 재작성한 결과를 받는다 — 문법·재작성의 단일 출처는 그쪽이고
    여기는 **코드 모양만** 책임진다.
    """
    catalogs: list[str] = []
    envs: list[str] = []
    for plan in sorted(plans, key=lambda p: p.alias):
        conn = session.get(Connection, plan.connection_id)
        cfg: dict[str, Any] = dict(conn.config) if conn is not None else {}
        env = password_env(plan.alias)
        envs.append(env)
        extension, community = extension_of[plan.connection_type]
        catalogs.append(
            _catalog_literal(
                alias=plan.alias,
                conn_name=plan.connection_name,
                conn_type=plan.connection_type,
                extension=extension,
                community=community,
                kind=kind_of[plan.connection_type],
                options={
                    "HOST": str(cfg.get("host") or ""),
                    "PORT": int(cfg.get("port") or default_port[plan.connection_type]),
                    "DATABASE": plan.database,
                    "USER": str(cfg.get("user") or ""),
                },
                env=env,
            )
        )

    return _TEMPLATE.format(
        env_block="\n".join(f"    {e}" for e in envs),
        memory_limit=repr(get_settings().duckdb_memory_limit),
        catalogs="\n".join(catalogs),
        sql=duck_sql.strip(),
    )


# 템플릿 안의 중괄호는 `str.format` 때문에 `{{`/`}}` 로 이스케이프해야 한다.
_TEMPLATE = '''"""이기종 연합 조회 — EAI SQL 편집기에서 내보냄.

비밀번호는 코드에 넣지 않았다. 돌리기 전에 환경변수를 설정할 것:

{env_block}

필요 패키지:

    pip install "duckdb>=1.1,<2" "polars>=1.0,<2"
"""

from __future__ import annotations

import os

import duckdb
import polars as pl

#: DuckDB 가 쓸 메모리 상한.
MEMORY_LIMIT = {memory_limit}

#: 붙일 원본 DB. 「연결 관리」에 저장된 값에서 뽑았고 비밀번호만 환경변수로 뺐다.
CATALOGS = [
{catalogs}
]

#: 편집기에서 쓴 SQL 을 카탈로그 별칭으로 바꿔 쓴 것.
#: (편집기 문법 `연결이름.데이터베이스.테이블` 은 EAI 안에서만 통한다.)
SQL = """\\
{sql}
"""


def _literal(value: object) -> str:
    """DuckDB SQL 문자열 리터럴.

    숫자는 감싸지 않는다 — MySQL 확장이 포트를 정수로 곧장 읽어서, 따옴표가 붙으면
    `invalid stoi argument` 로 붙는 것 자체가 실패한다.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def connect() -> duckdb.DuckDBPyConnection:
    """확장을 올리고 원본 DB 를 READ_ONLY 로 붙인 연결을 만든다."""
    con = duckdb.connect(config={{"memory_limit": MEMORY_LIMIT}})
    for cat in CATALOGS:
        install = "INSTALL " + cat["extension"]
        if cat["community"]:
            install += " FROM community"
        con.execute(install)
        con.execute("LOAD " + cat["extension"])

        options = dict(cat["options"])
        password = os.environ.get(cat["password_env"])
        if password:
            options["PASSWORD"] = password
        body = ", ".join(key + " " + _literal(val) for key, val in options.items())

        # 자격증명은 연결 문자열이 아니라 시크릿으로 넘긴다. 확장마다 따옴표 파싱이
        # 다르고, ATTACH 는 실패하면 연결 문자열을 그대로 에러 메시지에 담는다.
        secret = "sec_" + cat["alias"]
        con.execute(
            "CREATE OR REPLACE SECRET " + secret
            + " (TYPE " + cat["kind"] + ", " + body + ")"
        )
        con.execute(
            'ATTACH \\'\\' AS "' + cat["alias"] + '"'
            + " (TYPE " + cat["kind"] + ", READ_ONLY, SECRET " + secret + ")"
        )
    return con


def fetch() -> pl.DataFrame:
    """조회 결과를 polars DataFrame 으로."""
    con = connect()
    table = con.execute(SQL).to_arrow_table()
    # polars 는 Arrow 의 INTERVAL(month_day_nano)을 아직 못 읽는다.
    # 그런 컬럼이 있으면 `table.to_pylist()` 로 직접 꺼낼 것.
    return pl.from_arrow(table)


if __name__ == "__main__":
    print(fetch())
'''
