"""이미지 빌드 시 DuckDB 확장을 미리 받아 둔다 (apps/api/Dockerfile 에서 호출).

첫 조회가 네트워크를 기다리지 않게 하고, 폐쇄망 배포에서도 돌게 하려는 것이다.
경로는 ``EAI_DUCKDB_EXTENSION_DIR`` — 런타임 설정(`config.duckdb_extension_dir`)과 같은
환경변수를 쓴다. 한쪽만 바꾸면 구워 둔 확장을 못 찾는다.

**mssql 은 실패해도 빌드를 세우지 않는다.** 코어가 아니라 커뮤니티 확장이라 플랫폼
빌드가 없을 수 있는데, 그것 때문에 MySQL·PostgreSQL 조회까지 못 쓰게 되면 곤란하다.
없으면 그 타입 연결을 실제로 쓸 때 런타임이 분명한 오류를 낸다 (duck_service._new_hub).
"""

from __future__ import annotations

import os
import sys

import duckdb

#: (확장 이름, 커뮤니티 저장소인가, 필수인가)
EXTENSIONS = [
    ("postgres", False, True),
    ("mysql", False, True),
    ("mssql", True, False),
]


def main() -> int:
    directory = os.environ["EAI_DUCKDB_EXTENSION_DIR"]
    con = duckdb.connect(config={"extension_directory": directory})
    failed_required = False
    for name, community, required in EXTENSIONS:
        install = f"INSTALL {name}" + (" FROM community" if community else "")
        try:
            con.execute(install)
            con.execute(f"LOAD {name}")
            print(f"  [duckdb] {name}: OK")
        except Exception as exc:  # 이유를 빌드 로그에 남기는 것이 목적이라 넓게 잡는다
            first = str(exc).splitlines()[0]
            if required:
                print(f"  [duckdb] {name}: 실패 (필수) — {first}", file=sys.stderr)
                failed_required = True
            else:
                print(f"  [duckdb] {name}: 건너뜀 (선택) — {first}", file=sys.stderr)
    return 1 if failed_required else 0


if __name__ == "__main__":
    raise SystemExit(main())
