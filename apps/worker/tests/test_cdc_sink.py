"""Phase 4c — CDC Sink Worker.

Kafka·DB 없이 순수 로직(파싱·삭제정책·라우팅·커밋순서)을 검증한다.
가장 중요한 불변식: **오프셋은 write 성공 뒤에만 커밋된다** (at-least-once).
"""

from __future__ import annotations

from typing import Any

import pytest
from eai_api.schemas.dag import PipelineDefinition, PipelineEdge, PipelineNode

from eai_worker.cdc_sink import (
    SinkAction,
    SinkRecord,
    TargetRoute,
    TopicRoute,
    normalize_row,
    parse_event,
    process_records,
    resolve_target_routes,
    run_once,
    source_table_from_topic,
)

TOPIC = "eai_stream1.shop.orders"


def route(table: str | None = None, keys: tuple[str, ...] = ("id",)) -> TargetRoute:
    return TargetRoute(
        node_id="tgt", connection_id="c1", source_table=None, target_table=table, key_columns=keys
    )


def topic_router(delete_mode: str, *routes: TargetRoute) -> dict[str, TopicRoute]:
    return {TOPIC: TopicRoute(delete_mode=delete_mode, routes=routes or (route(),))}


class FakeWriter:
    def __init__(self) -> None:
        self.upserts: list[tuple[str, list[dict[str, Any]]]] = []
        self.deletes: list[tuple[str, list[dict[str, Any]]]] = []
        self.fail = False

    def upsert(self, r: TargetRoute, table: str, rows: list[dict[str, Any]]) -> int:
        if self.fail:
            raise RuntimeError("타깃 적재 실패")
        self.upserts.append((table, rows))
        return len(rows)

    def delete(self, r: TargetRoute, table: str, keys: list[dict[str, Any]]) -> int:
        self.deletes.append((table, keys))
        return len(keys)


class FakeConsumer:
    def __init__(self, records: list[SinkRecord]) -> None:
        self._records = records
        self.committed = False
        self.closed = False

    def poll(self, timeout_ms: int, max_records: int) -> list[SinkRecord]:
        out, self._records = self._records, []
        return out

    def commit(self) -> None:
        self.committed = True

    def resubscribe(self, topics: list[str]) -> None:
        self.subscribed = topics

    def close(self) -> None:
        self.closed = True


def insert(**cols: Any) -> SinkRecord:
    return SinkRecord(topic=TOPIC, value={**cols, "__op": "c", "__ts_ms": 1}, key={"id": cols.get("id")})


def deleted(**cols: Any) -> SinkRecord:
    return SinkRecord(
        topic=TOPIC,
        value={**cols, "__op": "d", "__deleted": "true", "__ts_ms": 1},
        key={"id": cols.get("id")},
    )


def tombstone(pk: int) -> SinkRecord:
    return SinkRecord(topic=TOPIC, value=None, key={"id": pk})


class TestHelpers:
    def test_source_table_from_topic(self) -> None:
        assert source_table_from_topic(TOPIC) == "orders"

    def test_normalize_strips_meta_but_keeps_soft_deleted(self) -> None:
        row = normalize_row({"id": 1, "name": "a", "__op": "u", "__ts_ms": 9, "__deleted": "false"}, "soft")
        assert row == {"id": 1, "name": "a", "__deleted": False}

    def test_normalize_drops_all_meta_for_ignore(self) -> None:
        row = normalize_row({"id": 1, "__op": "c", "__deleted": "false"}, "ignore")
        assert row == {"id": 1}


class TestParseEvent:
    def test_insert_is_upsert(self) -> None:
        action, row = parse_event({"id": 1, "__op": "c"}, "soft")
        assert action is SinkAction.UPSERT and row == {"id": 1}

    def test_soft_delete_upserts_with_flag(self) -> None:
        action, row = parse_event({"id": 1, "__deleted": "true"}, "soft")
        assert action is SinkAction.UPSERT and row["__deleted"] is True

    def test_ignore_delete_skips(self) -> None:
        action, _ = parse_event({"id": 1, "__deleted": "true"}, "ignore")
        assert action is SinkAction.SKIP

    def test_hard_delete_deletes(self) -> None:
        action, _ = parse_event({"id": 1, "__deleted": "true"}, "hard")
        assert action is SinkAction.DELETE

    def test_tombstone_deletes_only_for_hard(self) -> None:
        assert parse_event(None, "hard")[0] is SinkAction.DELETE
        assert parse_event(None, "soft")[0] is SinkAction.SKIP
        assert parse_event(None, "ignore")[0] is SinkAction.SKIP


class TestProcessRecords:
    def test_soft_delete_is_upserted(self) -> None:
        w = FakeWriter()
        stats = process_records([insert(id=1), deleted(id=2)], topic_router("soft"), w)
        assert stats.upserted == 2 and stats.deleted == 0
        # 한 테이블로 가는 두 이벤트는 한 번의 upsert 로 묶인다 (마이크로배치)
        assert len(w.upserts) == 1
        assert w.upserts[0][0] == "orders"

    def test_ignore_skips_deletes(self) -> None:
        w = FakeWriter()
        stats = process_records([insert(id=1), deleted(id=2)], topic_router("ignore"), w)
        assert stats.upserted == 1 and stats.skipped == 1 and not w.deletes

    def test_hard_routes_to_delete(self) -> None:
        w = FakeWriter()
        stats = process_records([deleted(id=5)], topic_router("hard"), w)
        assert stats.deleted == 1
        assert w.deletes[0] == ("orders", [{"id": 5}])

    def test_unknown_topic_ignored(self) -> None:
        w = FakeWriter()
        rec = SinkRecord(topic="other.x.y", value={"id": 1}, key={"id": 1})
        stats = process_records([rec], topic_router("soft"), w)
        assert stats.consumed == 0 and not w.upserts

    def test_explicit_target_table_overrides_source_name(self) -> None:
        w = FakeWriter()
        process_records([insert(id=1)], topic_router("soft", route(table="dw_orders")), w)
        assert w.upserts[0][0] == "dw_orders"

    def test_fan_out_to_multiple_targets(self) -> None:
        w = FakeWriter()
        r = topic_router("soft", route(table="a"), route(table="b"))
        process_records([insert(id=1)], r, w)
        assert {t for t, _ in w.upserts} == {"a", "b"}

    def test_applies_column_rename(self) -> None:
        # 컬럼 매핑이 있으면 타깃에 리네임된 컬럼으로 쓴다
        r = TargetRoute(
            node_id="t", connection_id="c", source_table=None, target_table="dw",
            key_columns=("id",), column_map=(("name", "customer_name", None, False),), drop_unmapped=False,
        )
        w = FakeWriter()
        process_records([insert(id=1, name="Kim")], {TOPIC: TopicRoute("soft", (r,))}, w)
        table, rows = w.upserts[0]
        assert table == "dw"
        assert rows[0]["customer_name"] == "Kim"
        assert "name" not in rows[0]  # 리네임되어 원본 키는 사라진다
        assert rows[0]["id"] == 1  # 매핑 안 한 컬럼은 유지(drop_unmapped=False)

    def test_unmapped_columns_keep_identity(self) -> None:
        # 컬럼 매핑 옵션을 켜도(일부만 리네임) 지정 안 한 컬럼은 동일 이름으로 그대로 간다
        r = TargetRoute(
            node_id="t", connection_id="c", source_table=None, target_table="dw",
            key_columns=("id",),
            column_map=(("name", "customer_name", None, False),),  # name 만 리네임
            drop_unmapped=False,
        )
        w = FakeWriter()
        process_records([insert(id=1, name="Kim", email="k@x.com")], {TOPIC: TopicRoute("soft", (r,))}, w)
        row = w.upserts[0][1][0]
        assert row["id"] == 1  # 지정 안 함 → 동일 이름 유지
        assert row["email"] == "k@x.com"  # 지정 안 함 → 동일 이름 유지
        assert row["customer_name"] == "Kim"  # 리네임한 것만 바뀜
        assert "name" not in row

    def test_mapped_deleted_not_duplicated(self) -> None:
        # __deleted 를 다른 이름으로 리네임하면 원본 __deleted 를 다시 넣지 않는다 (중복 금지)
        r = TargetRoute(
            node_id="t", connection_id="c", source_table=None, target_table="dw",
            key_columns=("id",),
            column_map=(("__deleted", "__deleted3", None, False),),
            drop_unmapped=False,
        )
        w = FakeWriter()
        process_records([deleted(id=2)], {TOPIC: TopicRoute("soft", (r,))}, w)
        row = w.upserts[0][1][0]
        assert row["__deleted3"] is True
        assert "__deleted" not in row  # 리네임했으니 원본 키는 없어야 한다

    def test_soft_delete_flag_survives_column_map(self) -> None:
        # drop_unmapped 여도 __deleted 는 반드시 보존돼야 soft 삭제가 타깃에 남는다
        r = TargetRoute(
            node_id="t", connection_id="c", source_table=None, target_table="dw",
            key_columns=("id",), column_map=(("id", "id", None, False),), drop_unmapped=True,
        )
        w = FakeWriter()
        process_records([deleted(id=2, name="Lee")], {TOPIC: TopicRoute("soft", (r,))}, w)
        rows = w.upserts[0][1]
        assert rows[0]["__deleted"] is True


class TestRunOnceCommitOrdering:
    def test_commits_after_successful_write(self) -> None:
        c = FakeConsumer([insert(id=1)])
        run_once(c, topic_router("soft"), FakeWriter())
        assert c.committed is True

    def test_does_not_commit_when_write_fails(self) -> None:
        """write 가 실패하면 오프셋을 커밋하지 않아야 다음 회차에 다시 받는다."""
        c = FakeConsumer([insert(id=1)])
        w = FakeWriter()
        w.fail = True
        with pytest.raises(RuntimeError):
            run_once(c, topic_router("soft"), w)
        assert c.committed is False

    def test_empty_poll_does_not_commit(self) -> None:
        c = FakeConsumer([])
        stats = run_once(c, topic_router("soft"), FakeWriter())
        assert stats.consumed == 0 and c.committed is False


def _node(nid: str, kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


class TestResolveTargetRoutes:
    def test_extracts_targets(self) -> None:
        d = PipelineDefinition(
            nodes=[
                _node("src", "source.cdc.mysql", connection_id="c1", table="t"),
                _node("tgt", "target.db", connection_id="c2", table="dw", key_columns=["id"]),
            ],
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        routes = resolve_target_routes(d)
        assert len(routes) == 1
        assert routes[0].connection_id == "c2"
        assert routes[0].target_table == "dw"
        assert routes[0].key_columns == ("id",)
        assert routes[0].namespace is None  # 지정 안 하면 기본 스키마
        assert routes[0].source_table is None  # 레거시 단일 타깃 = 모든 소스 테이블

    def test_captures_target_namespace(self) -> None:
        # 타깃이 public 이 아닌 스키마(cdc 등)를 지정하면 그대로 실려야 한다 —
        # 안 그러면 sink 가 public 에 써서 사용자가 만든 스키마엔 안 쌓인다
        d = PipelineDefinition(
            nodes=[
                _node("src", "source.cdc.mysql", connection_id="c1", table="t"),
                _node(
                    "tgt", "target.db", connection_id="c2",
                    table="customers", namespace="cdc", key_columns=["id"],
                ),
            ],
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        routes = resolve_target_routes(d)
        assert routes[0].namespace == "cdc"
        assert routes[0].target_table == "customers"

    def test_target_without_connection_skipped(self) -> None:
        d = PipelineDefinition(nodes=[_node("tgt", "target.s3")])
        assert resolve_target_routes(d) == []

    def test_table_mappings_expand_per_source(self) -> None:
        # 소스 테이블마다 타깃/컬럼/키를 따로 매핑 → 소스별 라우트가 생겨야 한다
        d = PipelineDefinition(
            nodes=[
                _node("src", "source.cdc.mysql", connection_id="c1", tables=["shop.customers", "shop.orders"]),
                _node(
                    "tgt", "target.db", connection_id="c2",
                    table_mappings=[
                        {
                            "source_table": "shop.customers", "target_table": "customer_dim",
                            "target_namespace": "dw", "key_columns": ["id"],
                            "columns": [{"source": "name", "target": "customer_name"}],
                        },
                        {"source_table": "shop.orders", "target_table": "order_fact", "key_columns": ["order_id"]},
                    ],
                ),
            ],
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        routes = resolve_target_routes(d)
        assert len(routes) == 2
        cust = next(r for r in routes if r.source_table == "customers")
        assert cust.target_table == "customer_dim"
        assert cust.namespace == "dw"
        assert cust.column_map == (("name", "customer_name", None, False),)
        assert cust.key_columns == ("id",)
        orders = next(r for r in routes if r.source_table == "orders")
        assert orders.target_table == "order_fact"
        assert orders.key_columns == ("order_id",)
