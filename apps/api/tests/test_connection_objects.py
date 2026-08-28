"""연결 객체 목록(DBeaver 식 카테고리 트리) 서비스 로직.

실제 information_schema 조회(테이블·뷰·함수·시퀀스)는 엔진별이라 통합 검증 몫이고,
여기서는 DB 없이 되는 두 가지만 본다:
 - ``DbObject.qualified_name`` (스키마 접두)
 - ``list_objects`` 가 커넥터에 위임하되, 미지원 커넥터(S3·SAP)면 빈 목록으로 폴백하는지
"""

from __future__ import annotations

from eai_connectors.base import ColumnSchema, DbObject, IndexInfo, ObjectDetail

from eai_api.services import connection_service as svc


class TestDbObject:
    def test_qualified_name_with_namespace(self) -> None:
        assert DbObject(name="orders", kind="table", namespace="public").qualified_name == "public.orders"

    def test_qualified_name_without_namespace(self) -> None:
        assert DbObject(name="orders", kind="table").qualified_name == "orders"


class _ConnNoObjects:
    """list_objects 를 구현하지 않는 커넥터(S3·SAP 등)."""


class _ConnWithObjects:
    def list_objects(self) -> list[DbObject]:
        return [
            DbObject(name="orders", kind="table", namespace="public"),
            DbObject(name="v_sales", kind="view", namespace="public"),
        ]


def test_list_objects_falls_back_to_empty_when_unsupported(monkeypatch) -> None:
    monkeypatch.setattr(svc, "get_connection", lambda _s, _cid: object())
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: _ConnNoObjects())
    assert svc.list_objects(None, "c1") == []  # type: ignore[arg-type]


def test_list_objects_delegates_to_connector(monkeypatch) -> None:
    monkeypatch.setattr(svc, "get_connection", lambda _s, _cid: object())
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: _ConnWithObjects())
    out = svc.list_objects(None, "c1")  # type: ignore[arg-type]
    assert [(o.name, o.kind) for o in out] == [("orders", "table"), ("v_sales", "view")]


class _ConnWithDetail:
    def object_detail(self, kind: str, schema: str | None, name: str) -> ObjectDetail:
        return ObjectDetail(
            kind=kind,
            name=name,
            namespace=schema,
            columns=[ColumnSchema(name="id", data_type="int", nullable=False, primary_key=True)],
            indexes=[IndexInfo(name="pk", columns=["id"], unique=True, primary=True)],
        )


def test_object_detail_qualified_name() -> None:
    d = ObjectDetail(kind="table", name="orders", namespace="public")
    assert d.qualified_name == "public.orders"


def test_object_detail_falls_back_to_none_when_unsupported(monkeypatch) -> None:
    monkeypatch.setattr(svc, "get_connection", lambda _s, _cid: object())
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: _ConnNoObjects())
    assert svc.object_detail(None, "c1", "table", "public", "orders") is None  # type: ignore[arg-type]


def test_object_detail_delegates(monkeypatch) -> None:
    monkeypatch.setattr(svc, "get_connection", lambda _s, _cid: object())
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: _ConnWithDetail())
    d = svc.object_detail(None, "c1", "table", "public", "orders")  # type: ignore[arg-type]
    assert d.name == "orders"
    assert d.columns[0].primary_key is True
    assert d.indexes[0].name == "pk"
