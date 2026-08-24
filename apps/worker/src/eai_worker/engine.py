"""DAG 실행 엔진 (설계 문서 §6).

실행 모델은 **타깃 주도 풀(pull) 스트리밍**이다. 타깃 노드마다 자신의 상류
경로를 거슬러 올라가 소스까지 이어지는 제너레이터 체인을 만들고, 타깃이
배치를 당겨오면서 흐름이 생긴다. 덕분에 중간 결과가 메모리에 쌓이지 않는다.

분기(팬아웃)는 **스풀**로 처리한다. 한 노드가 여러 소비자를 가지면 첫 소비 때
디스크에 적어두고 나머지는 그것을 되읽는다 — 소스는 정확히 한 번만 읽힌다 (spool.py).

남은 한계(의도된 것):
- 여러 상류가 한 노드로 모이면 **순차 concat(UNION ALL)** 로 처리한다. 조인은 별도 노드로 다룰 일이다.
- 타깃은 순차 실행된다. 병렬로 돌리면 스풀이 완성되기 전에 두 번째 소비자가 붙는다.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from eai_api.db import session_scope
from eai_api.models import Checkpoint, LogLevel
from eai_api.schemas import variables as var_syntax
from eai_api.schemas.dag import (
    DB_TARGET_TYPES,
    NODE_CONNECTOR_TYPE,
    NodeKind,
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    topological_order,
)
from eai_api.services import connection_service
from eai_connectors import BaseConnector, ConnectorError, RecordBatch, WriteSpec

from .context import RunContext
from .nodes import extract, load, transform
from .nodes.transform import ROUTE_KEY
from .spool import SpooledStream

logger = logging.getLogger(__name__)


class ExecutionError(Exception):
    """노드 실행 실패. 어느 노드에서 끊겼는지 함께 들고 다닌다."""

    def __init__(self, node_id: str, message: str, *, cause: BaseException | None = None) -> None:
        super().__init__(f"[{node_id}] {message}")
        self.node_id = node_id
        self.__cause__ = cause


@dataclass
class _Exec:
    """한 번의 실행 동안 공유되는 상태."""

    node_map: dict[str, PipelineNode]
    upstream: dict[str, list[str]]
    downstream: dict[str, list[str]]
    ctx: RunContext
    #: target 노드 → 들어오는 [(source_id, source_handle)]. 스위치 라우팅에 필요하다
    #: (어느 출력 포트에서 온 엣지인지). upstream 과 달리 핸들을 보존한다.
    in_edges: dict[str, list[tuple[str, str | None]]] = field(default_factory=dict)
    opened: dict[str, BaseConnector] = field(default_factory=dict)
    #: 여러 타깃이 공유하는 노드의 스풀. 소스를 한 번만 읽기 위한 것이다.
    spools: dict[str, SpooledStream] = field(default_factory=dict)

    def close(self) -> None:
        for node_id, connector in self.opened.items():
            try:
                connector.close()
            except Exception:
                logger.warning("커넥터 종료 실패 (node=%s)", node_id, exc_info=True)
        for spool in self.spools.values():
            spool.cleanup()


#: 단일 노드 미리보기가 읽는 최대 행 수 — "이 노드가 데이터를 내보내는가"를 확인하는 용도라
#: 전량을 셀 필요가 없다. 넘으면 거기서 멈춘다.
NODE_PREVIEW_ROW_CAP = 10_000


def execute(
    definition: PipelineDefinition, ctx: RunContext, *, only_node: str | None = None
) -> dict[str, Any]:
    """DAG 를 실행하고 노드별 결과 요약을 돌려준다.

    ``only_node`` 가 있으면 그 노드만 독립 실행한다 (그 노드까지 필요한 상류만).
    타깃이면 실제 적재, 소스·변환이면 적재 없이 출력을 훑어보는 미리보기다.
    """
    # 부분 실행이면 그 노드까지 필요한 상류만 본다 — 범위 밖 노드가 참조하는 변수까지
    # 요구하면 반쯤 그린 파이프라인에서 테스트 실행이 막힌다.
    scope = _ancestor_ids(definition.upstream_map(), only_node) if only_node else None
    # 노드 결과 참조(`${이름.컬럼}`)를 먼저 값으로 바꿔 둔다 — 참조된 노드를 실제로 돌려
    # 첫 행을 얻는 단계라, 그 결과가 있어야 아래 치환이 완성된다.
    values = {**ctx.variables, **_resolve_node_refs(definition, ctx, scope=scope)}
    definition = _apply_variables(definition, ctx, scope=scope, values=values)
    node_map = definition.node_map()

    state = _build_exec(definition, ctx)
    if only_node is not None:
        return _execute_single_node(only_node, state)

    order = topological_order(definition.nodes, definition.edges)
    targets = [node_map[nid] for nid in order if node_map[nid].is_target]
    if not targets:
        raise ExecutionError("-", "타깃 노드가 없습니다")

    executable = definition.executable_nodes()
    ctx.total_nodes = len(executable)
    ctx.register_targets({n.id for n in targets})
    for node in executable:
        ctx.set_node(node.id, status="pending")

    ctx.log(f"DAG 실행 시작 — 노드 {len(executable)}개, 타깃 {len(targets)}개")
    ctx.log(
        "실행 순서: "
        + " → ".join(nid for nid in order if not node_map[nid].is_trigger and not node_map[nid].is_note)
    )

    shared = [
        nid for nid, outs in state.downstream.items() if len(outs) > 1 and not node_map[nid].is_trigger
    ]
    if shared:
        ctx.log(f"분기 노드 {', '.join(shared)} 는 한 번만 읽고 스풀로 재사용합니다")

    results: dict[str, Any] = {}
    try:
        for target in targets:
            results[target.id] = _run_target_chain(target, state)
    finally:
        state.close()

    # 모든 타깃이 성공한 뒤에야 워터마크를 전진시킨다 (소스 노드 단위로 저장)
    _persist_checkpoints(ctx)
    return results


def _build_exec(definition: PipelineDefinition, ctx: RunContext) -> _Exec:
    """치환이 끝난 정의로 실행 상태를 짠다. 참조 해석(peek)도 같은 것을 쓴다 —
    peek 이 본 실행과 다른 경로로 데이터를 만들면 참조한 값과 실제 값이 어긋난다."""
    downstream: dict[str, list[str]] = {n.id: [] for n in definition.nodes}
    in_edges: dict[str, list[tuple[str, str | None]]] = {n.id: [] for n in definition.nodes}
    for edge in definition.edges:
        downstream[edge.source].append(edge.target)
        in_edges[edge.target].append((edge.source, edge.source_handle))

    return _Exec(
        node_map=definition.node_map(),
        upstream=definition.upstream_map(),
        downstream=downstream,
        in_edges=in_edges,
        ctx=ctx,
    )


def _apply_variables(
    definition: PipelineDefinition,
    ctx: RunContext,
    *,
    scope: set[str] | None = None,
    values: dict[str, Any] | None = None,
) -> PipelineDefinition:
    """`$변수` 를 실제 값으로 바꾼 정의를 돌려준다 — 실행의 **첫 단계**.

    치환을 여기 한 곳에 두는 이유가 있다. 라우터에서만 채우면 스케줄·재시도 경로가 값 없이
    돌아 "화면에서는 되는데 스케줄로는 안 된다"가 난다. 실행이 시작되는 지점은 여기뿐이다.

    값이 없으면 실패시킨다. 빈 문자열 치환은 `WHERE dt > ''` 가 되어 전체 재적재를
    조용히 일으킨다 — 조용한 사고보다 시끄러운 실패가 낫다.

    ``scope`` 는 부분 실행에서 실제로 도는 노드 집합이다. 주면 그 안의 노드만 보고 판단한다 —
    아직 설정도 안 끝난 하류 노드가 참조하는 변수 때문에 테스트 실행이 막히면 안 된다.

    원본을 고치지 않고 사본을 만든다. 정의는 재시도 때 다시 읽히므로 제자리에서 바꾸면
    두 번째 실행이 이미 치환된 값을 또 치환하려다 어긋난다.
    """
    values = ctx.variables if values is None else values
    in_scope = [n for n in definition.nodes if scope is None or n.id in scope]
    referenced = {name for node in in_scope for name in var_syntax.extract_from_params(node.params)}
    if not referenced and not any(
        var_syntax.extract_node_refs_from_params(n.params) for n in in_scope
    ):
        return definition

    absent = sorted(name for name in referenced if name not in values)
    if absent:
        raise ExecutionError(
            "-", f"변수 값이 없습니다: {', '.join('$' + n for n in absent)} — 호출 본문을 확인하세요"
        )

    substituted, applied = _substituted(definition, values, {n.id for n in in_scope})

    shown = ", ".join(f"${k}={v!r}" for k, v in sorted(values.items()) if k in referenced)
    if shown:
        ctx.log(f"변수 치환 완료 — {shown}")

    # 트리거 노드 상태에 실어 엣지가 "이 선으로 무엇이 넘어갔나"를 띄울 수 있게 한다.
    # 트리거 자신은 실행 대상이 아니라 상태가 따로 생기지 않으므로 여기서 만들어 준다.
    trigger = next((n for n in definition.nodes if n.is_api_trigger), None)
    if trigger is not None and applied:
        ctx.set_node(
            trigger.id,
            status="success",
            message="값 전달",
            handed={k: v for k, v in ctx.variables.items() if k in referenced},
            applied=applied,
        )

    return definition.model_copy(update={"nodes": substituted})


def _substituted(
    definition: PipelineDefinition, values: dict[str, Any], scoped_ids: set[str]
) -> tuple[list[PipelineNode], dict[str, dict[str, Any]]]:
    """치환만 하는 순수 부분. 참조 해석(peek)도 같은 규칙을 써야 해서 떼어 두었다.

    원본을 고치지 않고 사본을 만든다. 정의는 재시도 때 다시 읽히므로 제자리에서 바꾸면
    두 번째 실행이 이미 치환된 값을 또 치환하려다 어긋난다.
    """
    substituted: list[PipelineNode] = []
    applied: dict[str, dict[str, Any]] = {}
    for node in definition.nodes:
        has_placeholder = bool(
            var_syntax.extract_from_params(node.params)
            or var_syntax.extract_node_refs_from_params(node.params)
        )
        if node.id in scoped_ids and has_placeholder:
            try:
                params = var_syntax.substitute_params(node.params, values)
            except var_syntax.VariableError as exc:
                raise ExecutionError(node.id, str(exc), cause=exc) from exc
            applied[node.id] = {k: v for k, v in params.items() if v != node.params.get(k)}
            substituted.append(node.model_copy(update={"params": params}))
        else:
            substituted.append(node)
    return substituted, applied


def _resolve_node_refs(
    definition: PipelineDefinition, ctx: RunContext, *, scope: set[str] | None = None
) -> dict[str, Any]:
    """`${노드이름.컬럼}` 을 실제 값으로 만든다 — 참조된 노드를 **먼저 돌려** 첫 행을 얻는다.

    데이터 흐름(엣지)과 별개의 의존이다. 참조는 값을 설정에 꽂기 위한 것이라, 참조된 노드가
    값을 내야 참조하는 노드의 설정이 완성된다. 그래서 참조 순서대로 하나씩 해석한다 —
    참조된 노드가 또 다른 노드를 참조할 수 있기 때문이다.

    비용을 숨기지 않는다: 참조된 노드는 **한 번 더 읽힌다**(첫 행까지만). 본 실행의
    스트림을 재사용하려면 실행 순서를 참조에 맞춰 뒤집어야 하는데, 그러면 타깃 주도
    풀 스트리밍이라는 실행 모델 자체가 무너진다. 첫 행만 읽는 비용이 훨씬 싸다.
    """
    in_scope = [n for n in definition.nodes if scope is None or n.id in scope]
    refs_by_target: dict[str, list[var_syntax.NodeRef]] = {}
    for node in in_scope:
        for ref in var_syntax.extract_node_refs_from_params(node.params):
            target = definition.node_by_label(ref.node)
            if target is None:
                raise ExecutionError(node.id, f"{ref} 가 가리키는 노드가 없습니다: 「{ref.node}」")
            if target.id == node.id:
                raise ExecutionError(node.id, f"{ref} — 자기 자신의 결과는 참조할 수 없습니다")
            if target.is_trigger or target.is_note or target.is_target:
                raise ExecutionError(node.id, f"{ref} — 결과를 내지 않는 노드입니다")
            refs_by_target.setdefault(target.id, []).append(ref)

    if not refs_by_target:
        return {}

    # 참조를 엣지처럼 세워 실행 순서를 정한다. 순환이면 어느 쪽도 먼저 돌 수 없다.
    extra = [
        PipelineEdge(source=dep, target=node_id)
        for node_id, deps in definition.node_ref_dependencies().items()
        for dep in deps
    ]
    try:
        order = topological_order(definition.nodes, definition.edges + extra)
    except ValueError as exc:
        raise ExecutionError("-", f"노드 결과 참조가 순환합니다: {exc}", cause=exc) from exc

    ctx.log(f"노드 결과 참조 {len(refs_by_target)}개 노드 — 값을 먼저 확인합니다")
    resolved: dict[str, Any] = {}
    for node_id in order:
        refs = refs_by_target.get(node_id)
        if not refs:
            continue
        # `[]` 가 하나라도 있으면 전체를 읽어야 한다. 없으면 첫 행에서 멈춘다.
        wants_list = any(ref.many for ref in refs)
        rows = _peek_rows(
            definition,
            node_id,
            ctx,
            {**ctx.variables, **resolved},
            limit=NODE_REF_LIST_CAP + 1 if wants_list else 1,
        )
        for ref in refs:
            if ref.column not in rows[0]:
                available = ", ".join(rows[0]) or "(없음)"
                raise ExecutionError(
                    node_id, f"{ref} — 결과에 그런 컬럼이 없습니다. 있는 컬럼: {available}"
                )
            resolved[ref.key] = [r.get(ref.column) for r in rows] if ref.many else rows[0][ref.column]

    ctx.log("노드 결과 참조 해석 완료 — " + ", ".join(f"${{{k}}}={_brief(v)}" for k, v in resolved.items()))
    return resolved


#: `${이름.컬럼[]}` 이 모을 수 있는 최대 행 수.
#:
#: 넘으면 **조용히 자르지 않고 실패시킨다.** 잘린 `IN (...)` 은 문법도 맞고 실행도 되지만
#: 결과만 조용히 빠진다 — 이 저장소가 가장 싫어하는 종류의 사고다. 이만큼 큰 목록이
#: 필요하면 그건 변수가 아니라 조인으로 다룰 일이다.
NODE_REF_LIST_CAP = 1_000


def _brief(value: Any) -> str:
    """로그용 축약 — 1000개짜리 목록을 그대로 적으면 로그가 결과 덤프가 된다."""
    if isinstance(value, list):
        head = ", ".join(repr(v) for v in value[:3])
        return f"[{head}{', …' if len(value) > 3 else ''}] ({len(value)}개)"
    return repr(value)


def _peek_rows(
    definition: PipelineDefinition,
    node_id: str,
    ctx: RunContext,
    values: dict[str, Any],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    """그 노드가 내놓는 행을 ``limit`` 까지 읽는다. 참조 값의 출처다.

    낱값 참조면 ``limit=1`` 이라 첫 행에서 멈춘다 — 대부분이 이 경우다.
    목록 참조(`[]`)면 상한+1 까지 읽어 **넘쳤는지**를 판별한다.

    행이 하나도 없으면 실패시킨다. 값을 비워 두면 `WHERE dt > ''` 처럼 조용히 전체를
    긁는 조건이 만들어진다 — 이 저장소가 변수에 대해 지켜 온 규칙과 같다.
    """
    scope = _ancestor_ids(definition.upstream_map(), node_id)
    nodes, _ = _substituted(definition, values, scope)
    prepared = definition.model_copy(update={"nodes": nodes})

    state = _build_exec(prepared, ctx)
    node = state.node_map[node_id]
    rows: list[dict[str, Any]] = []
    # peek 은 본 실행의 집계에 끼어들면 안 된다 (특히 워터마크 — 아래 참고)
    with _isolated_progress(ctx):
        stream = _stream_of(node, state)
        try:
            for batch in stream:
                for raw in batch.rows:
                    rows.append(_json_safe_row(raw))
                    if len(rows) >= limit:
                        break
                if len(rows) >= limit:
                    break
        except ConnectorError as exc:
            ctx.set_node(node_id, status="failed", message=str(exc))
            raise ExecutionError(node_id, str(exc), cause=exc) from exc
        finally:
            # 상한에서 빠져나오므로 스트림이 살아 있다. 명시적으로 닫아야 커서와
            # 샘플 기록(_sampled 의 finally)이 GC 시점에 좌우되지 않는다.
            close = getattr(stream, "close", None)
            if callable(close):
                close()
            state.close()

    label = node.label or node_id
    if not rows:
        raise ExecutionError(
            node_id,
            f"「{label}」 가 행을 내지 않아 참조 값을 만들 수 없습니다 "
            "— 조건을 확인하거나 참조를 지우세요",
        )
    if len(rows) > NODE_REF_LIST_CAP:
        raise ExecutionError(
            node_id,
            f"「{label}」 의 행이 {NODE_REF_LIST_CAP:,}개를 넘습니다 — 목록 참조(`[]`)로 쓰기엔 "
            "너무 큽니다. 상류에서 줄이거나 조인으로 다루세요",
        )

    ctx.log(f"참조 값 확보 — {len(rows)}행 · 컬럼 {len(rows[0])}개", node_id=node_id)
    return rows


@contextmanager
def _isolated_progress(ctx: RunContext) -> Iterator[None]:
    """참조 해석이 본 실행의 집계를 오염시키지 않게 한다.

    **워터마크가 핵심이다.** peek 은 첫 배치만 읽고 멈추므로 거기서 관측한 최대값은
    구간의 일부일 뿐인데, 그것이 체크포인트로 승격되면 다음 실행이 읽지 않은 구간을
    영영 건너뛴다. 건수도 함께 되돌린다 — 같은 행을 두 번 세면 화면이 거짓말을 한다.
    """
    watermarks = dict(ctx.watermarks)
    records = {nid: s.records for nid, s in ctx.node_states.items()}
    try:
        yield
    finally:
        ctx.watermarks = watermarks
        for nid, state in ctx.node_states.items():
            state.records = records.get(nid, 0)


def _ancestor_ids(upstream: dict[str, list[str]], node_id: str) -> set[str]:
    """``node_id`` 로 데이터를 흘려보내는 모든 상류 노드 id (자신 포함)."""
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(upstream.get(current, []))
    return seen


def _execute_single_node(node_id: str, state: _Exec) -> dict[str, Any]:
    """노드 하나만 독립 실행한다 — 그 노드까지 필요한 상류만 돌린다.

    타깃이면 실제 적재하고, 소스·변환이면 적재 없이 출력을 훑는 미리보기다.
    어느 쪽이든 저장된 워터마크(체크포인트)는 건드리지 않는다 — 테스트 실행이기 때문.
    """
    ctx = state.ctx
    node = state.node_map.get(node_id)
    if node is None:
        raise ExecutionError(node_id, "노드를 찾을 수 없습니다")
    if node.is_api_trigger:
        return {node_id: _check_api_trigger(node, state)}
    if node.is_trigger or node.is_note:
        raise ExecutionError(node_id, "이 노드는 실행할 수 없습니다 (트리거·메모)")

    scope = _ancestor_ids(state.upstream, node_id)
    scope_exec = [
        state.node_map[i] for i in scope if not state.node_map[i].is_trigger and not state.node_map[i].is_note
    ]
    ctx.total_nodes = len(scope_exec)
    if node.is_target:
        ctx.register_targets({node_id})
    for n in scope_exec:
        ctx.set_node(n.id, status="pending")
    ctx.log(f"단일 노드 실행 — 대상 {node_id}, 상류 {len(scope_exec) - 1}개 (워터마크 미변경)")

    try:
        if node.is_target:
            # 실제 적재하면서 들어간 데이터를 샘플로 남긴다. 상류는 _mark_upstream_success 가 처리
            summary = _run_target_chain(node, state, sample=True)
        else:
            summary = _preview_node(node, state)
            # 미리보기는 상류까지 함께 돌았으니 스코프 전체를 성공으로 마감한다
            for n in scope_exec:
                if n.id != node.id:
                    ctx.set_node(n.id, status="success", message="완료")
                    ctx.mark_node_done(n.id)
    finally:
        state.close()

    # 단일 노드 실행은 체크포인트를 승격하지 않는다 (_persist_checkpoints 생략)
    return {node_id: summary}


def _collect_response(node: PipelineNode, stream: Iterator[RecordBatch], ctx: RunContext) -> dict[str, Any]:
    """응답 노드 — 흘러온 행을 모아 호출자에게 돌려줄 본문을 만든다.

    **스트리밍 원칙의 의도된 예외다.** 다른 타깃은 배치를 받는 즉시 흘려보내 메모리를
    상수로 유지하지만, 응답은 전부 모여야 한 번에 돌려줄 수 있다. 그래서 ``max_rows``
    상한이 필수다 — 상한이 없으면 큰 테이블 하나가 워커를 통째로 삼킨다.

    **상한에 걸려도 상류는 끝까지 소비한다.** 중간에 끊으면 그 스트림을 스풀로 함께 쓰는
    다른 타깃이 반쪽짜리 데이터를 받는다. 그래서 break 하지 않고 세기만 한다.

    ``columns`` 로 돌려줄 필드를 고를 수 있다. 응답 본문에 내부 컬럼까지 전부 실어 보낼
    이유가 없고, 외부에 무엇을 노출할지는 명시적으로 정하는 편이 안전하다.
    """
    params = node.params
    max_rows = int(params.get("max_rows", 100))
    picked = params.get("columns") or None
    wanted = list(picked) if isinstance(picked, list) else None

    rows: list[dict[str, Any]] = []
    columns: list[str] = []
    total = 0
    truncated = False

    for batch in stream:
        if batch.columns and not columns:
            columns = list(batch.columns)
        for row in batch.rows:
            total += 1
            if len(rows) >= max_rows:
                truncated = True
                continue  # break 하지 않는다 — 스풀을 공유하는 다른 타깃 때문에
            rows.append(_json_safe_row({k: row.get(k) for k in wanted} if wanted else row))

    if wanted:
        columns = wanted
    elif not columns and rows:
        columns = list(rows[0].keys())

    payload = {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": truncated}

    # 상태 전이보다 **먼저** 저장한다 — 뒤에 쓰면 호출자가 빈손으로 깨어난다
    ctx.set_response(payload)

    if truncated:
        ctx.log(
            f"응답이 {max_rows:,}행에서 잘렸습니다 (전체 {total:,}행) — max_rows 를 올리거나 "
            "상류에 필터를 두세요",
            node_id=node.id,
            level=LogLevel.WARNING,
        )
    ctx.add_records(node.id, len(rows))
    return {"records": len(rows), "location": "API 응답", "truncated": truncated}


def _check_api_trigger(node: PipelineNode, state: _Exec) -> dict[str, Any]:
    """API 트리거만 단독으로 확인한다 — 데이터는 한 줄도 옮기지 않는다.

    확인하는 것은 딱 하나다: **받은 값이 다음 노드에 어떻게 꽂히는가.**
    그래서 하류 노드의 연결·테이블 설정을 요구하지 않는다. 아직 소스도 안 고른 상태에서
    "이 payload 면 WHERE 절이 이렇게 된다"를 먼저 보는 것이 이 버튼의 쓸모다.

    하류를 실제로 돌리고 싶으면 그 노드를 대상으로 부분 실행하면 된다 — 그때는 당연히
    그 노드의 설정이 갖춰져 있어야 한다.
    """
    ctx = state.ctx
    ctx.total_nodes = 1
    ctx.set_node(node.id, status="running")

    values = ctx.variables
    if values:
        ctx.log(
            "받은 값 — " + ", ".join(f"${k}={v!r}" for k, v in sorted(values.items())),
            node_id=node.id,
        )
    else:
        ctx.log("받은 값이 없습니다 (선언된 변수 없음)", node_id=node.id)

    #: 다음 노드들의 파라미터가 어떻게 바뀌는지 — 바뀌는 것만 남긴다
    applied: dict[str, dict[str, Any]] = {}
    for target_id in state.downstream.get(node.id, []):
        target = state.node_map.get(target_id)
        if target is None:
            continue
        changes: dict[str, Any] = {}
        for key, raw in target.params.items():
            if not var_syntax.extract_from_params({key: raw}):
                continue
            try:
                changes[key] = var_syntax.substitute_params({key: raw}, values)[key]
            except var_syntax.VariableError as exc:
                ctx.set_node(node.id, status="failed", message=str(exc))
                raise ExecutionError(node.id, str(exc), cause=exc) from exc
        if changes:
            applied[target_id] = changes
            rendered = ", ".join(f"{k}={v!r}" for k, v in sorted(changes.items()))
            ctx.log(f"→ {target_id}: {rendered}", node_id=node.id)

    if not applied:
        ctx.log(
            "다음 노드에서 이 값을 쓰는 곳이 없습니다 — 노드 설정에 $변수를 넣어 보세요",
            node_id=node.id,
            level=LogLevel.WARNING,
        )

    # handed 는 엣지 칩에, applied 는 엣지 상세에 쓰인다
    ctx.set_node(
        node.id,
        status="success",
        message="값 확인 완료",
        handed=dict(values),
        applied=applied,
    )
    ctx.mark_node_done(node.id)
    return {"variables": dict(values), "applied": applied}


#: 노드 사이에서 미리 보여줄 결과 샘플 최대 행 수 — 화면 확인용이라 넉넉히 이 정도면 충분하다
SAMPLE_ROW_LIMIT = 50


class _Sampler:
    """스트림을 통과시키면서 앞쪽 몇 행을 JSON 안전한 형태로 붙잡아 둔다.

    엣지 위에 "이 노드가 무슨 값을 내보냈나"를 보여주기 위한 것 — 타깃으로 흘러가는
    배치를 소비하지 않고 곁눈질만 한다(제너레이터는 한 번만 소비되므로 통과가 필수).
    """

    def __init__(self, cap: int = SAMPLE_ROW_LIMIT) -> None:
        self.cap = cap
        self.rows: list[dict[str, Any]] = []
        self.columns: list[str] = []
        self.total = 0

    def wrap(self, stream: Iterator[RecordBatch]) -> Iterator[RecordBatch]:
        for batch in stream:
            if batch.columns and not self.columns:
                self.columns = list(batch.columns)
            for row in batch.rows:
                if len(self.rows) < self.cap:
                    self.rows.append(_json_safe_row(row))
            self.total += len(batch.rows)
            yield batch

    def as_dict(self) -> dict[str, Any]:
        columns = self.columns or (list(self.rows[0].keys()) if self.rows else [])
        return {"columns": columns, "rows": self.rows, "truncated": self.total > len(self.rows)}


#: 전체 실행에서 노드마다 남기는 결과 샘플 상한.
#:
#: 단일 노드 실행(50행)보다 훨씬 짜다. 이쪽은 **모든 노드**가 각자 남기므로 노드 수만큼
#: 곱해져 node_states jsonb 와 WebSocket 페이로드를 불린다. 결과 서랍이 "이 노드가 무엇을
#: 내보냈나"를 보여주고 `${이름.컬럼}` 으로 쓸 컬럼을 고르게 하는 데는 몇 줄이면 충분하다.
FLOW_SAMPLE_ROW_LIMIT = 10


def _sampled(node: PipelineNode, raw: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    """노드가 내보내는 스트림을 곁눈질해 결과 샘플을 남긴다 (결과 서랍이 읽는 것).

    스트림이 끝나거나 중간에 버려질 때 남긴다 — 참조 해석(peek)은 첫 배치만 읽고 떠나므로
    ``finally`` 가 아니면 그 노드의 샘플이 영영 생기지 않는다.
    """
    sampler = _Sampler(FLOW_SAMPLE_ROW_LIMIT)
    try:
        yield from sampler.wrap(raw)
    finally:
        if sampler.rows:
            ctx.set_node(node.id, sample=sampler.as_dict())


def _json_safe_row(row: dict[str, Any]) -> dict[str, Any]:
    """jsonb·WebSocket 에 그대로 실을 수 있게 값을 정리한다 (datetime·Decimal·bytes 등)."""
    return {str(k): _json_safe(v) for k, v in row.items()}


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def _preview_node(node: PipelineNode, state: _Exec) -> dict[str, Any]:
    """소스·변환 노드의 출력을 적재 없이 훑는다. 읽은 행 수·컬럼·샘플을 돌려준다."""
    ctx = state.ctx
    ctx.set_node(node.id, status="running")
    sampler = _Sampler()
    try:
        if node.is_source:
            connector = _connector_for(node, state, is_target=False)
            raw = extract(node, connector, ctx, watermark=None)
        else:  # 변환 노드 — 상류를 조립해 통과시킨다
            raw = transform(node, _build_stream(node, state), ctx)
            if node.kind is NodeKind.LOGIC_SWITCH:
                # 스위치 미리보기는 내부 라우팅 태그를 감춘다 (분기 분포는 로그에 남는다)
                raw = (
                    RecordBatch(
                        rows=[{k: v for k, v in r.items() if k != ROUTE_KEY} for r in b.rows],
                        columns=b.columns,
                        max_watermark=b.max_watermark,
                        is_last=b.is_last,
                    )
                    for b in raw
                )

        seen = 0
        for batch in sampler.wrap(raw):
            seen += len(batch.rows)
            if seen >= NODE_PREVIEW_ROW_CAP:
                ctx.log(
                    f"미리보기 상한 {NODE_PREVIEW_ROW_CAP:,}건에서 멈춥니다 (실제로는 더 많을 수 있음)",
                    node_id=node.id,
                )
                break
    except ConnectorError as exc:
        ctx.set_node(node.id, status="failed", message=str(exc))
        raise ExecutionError(node.id, str(exc), cause=exc) from exc
    except ExecutionError:
        ctx.set_node(node.id, status="failed", message="상류 노드 실패")
        raise
    except Exception as exc:
        ctx.set_node(node.id, status="failed", message=str(exc))
        raise ExecutionError(node.id, f"예상치 못한 오류: {exc}", cause=exc) from exc

    ctx.set_node(
        node.id,
        status="success",
        message=f"{seen:,}건 읽음 (미리보기 · 적재 안 함)",
        sample=sampler.as_dict(),
    )
    ctx.mark_node_done(node.id)
    ctx.log(f"미리보기 완료 — {seen:,}건 · 컬럼 {len(sampler.columns)}개", node_id=node.id)
    return {"records": seen, "location": None, "preview": True, "columns": sampler.columns}


def _run_target_chain(target: PipelineNode, state: _Exec, *, sample: bool = False) -> dict[str, Any]:
    """타깃 하나를 끝까지 실행한다.

    타깃은 출력이 없으므로 **들어온 입력**을 결과 샘플로 남긴다 — 그것이 이 노드에 대해
    보여줄 수 있는 유일한 데이터다. ``sample`` (단일 노드 실행)이면 더 넉넉히 붙잡는다.
    """
    ctx = state.ctx
    ctx.set_node(target.id, status="running")
    sampler = _Sampler(SAMPLE_ROW_LIMIT if sample else FLOW_SAMPLE_ROW_LIMIT)
    try:
        source_stream = _build_stream(target, state)
        source_stream = sampler.wrap(source_stream)
        if target.kind is NodeKind.TARGET_RESPONSE:
            # 응답 노드는 커넥터가 없다 — 어디에도 적재하지 않고 호출자에게 돌려준다
            summary = _collect_response(target, source_stream, ctx)
        else:
            connector = _connector_for(target, state, is_target=True)
            summary = load(target, connector, source_stream, ctx)
    except ConnectorError as exc:
        _fail_chain(target, ctx, str(exc))
        raise ExecutionError(target.id, str(exc), cause=exc) from exc
    except ExecutionError:
        ctx.set_node(target.id, status="failed", message="상류 노드 실패")
        raise
    except Exception as exc:
        _fail_chain(target, ctx, str(exc))
        raise ExecutionError(target.id, f"예상치 못한 오류: {exc}", cause=exc) from exc

    ctx.set_node(
        target.id,
        status="success",
        message=f"{summary['records']:,}건",
        location=summary.get("location"),
        sample=sampler.as_dict(),
    )
    ctx.mark_node_done(target.id)
    _mark_upstream_success(target, state)
    return summary


def _build_stream(node: PipelineNode, state: _Exec) -> Iterator[RecordBatch]:
    """``node`` 로 흘러들어올 배치 스트림을 상류에서부터 조립한다.

    스위치 상류에서 오는 엣지는 그 엣지의 source_handle 에 해당하는 행만 통과시킨다
    — 스위치가 붙인 라우팅 태그를 보고 걸러낸 뒤 태그를 제거한다.
    """
    # 결정적 순서: (source_id, source_handle) 로 정렬한다
    incoming = sorted(
        (e for e in state.in_edges[node.id] if not state.node_map[e[0]].is_trigger),
        key=lambda e: (e[0], e[1] or ""),
    )
    if not incoming:
        raise ExecutionError(node.id, "입력이 없습니다")

    streams: list[Iterator[RecordBatch]] = []
    for source_id, source_handle in incoming:
        parent = state.node_map[source_id]
        s = _stream_of(parent, state)
        if parent.kind is NodeKind.LOGIC_SWITCH:
            s = _route_filter(s, source_handle)
        streams.append(s)

    if len(streams) == 1:
        return streams[0]

    state.ctx.log(
        f"상류 {len(streams)}개를 순차 결합합니다 (UNION ALL)", node_id=node.id, level=LogLevel.WARNING
    )
    return _concat(streams)


def _route_filter(stream: Iterator[RecordBatch], handle: str | None) -> Iterator[RecordBatch]:
    """스위치 출력 중 ``handle`` 포트로 라우팅된 행만 통과시키고 라우팅 태그를 제거한다."""
    for batch in stream:
        rows: list[dict[str, Any]] = []
        for row in batch.rows:
            if row.get(ROUTE_KEY) == handle:
                clean = dict(row)
                clean.pop(ROUTE_KEY, None)
                rows.append(clean)
        yield RecordBatch(
            rows=rows, columns=batch.columns, max_watermark=batch.max_watermark, is_last=batch.is_last
        )


def _stream_of(node: PipelineNode, state: _Exec) -> Iterator[RecordBatch]:
    """``node`` 가 **내보내는** 스트림. 여러 소비자가 있으면 스풀을 거친다.

    스풀 덕분에 분기가 있어도 소스는 정확히 한 번만 읽힌다 — 원격 DB 부하가
    소비자 수만큼 곱해지지 않고, 읽는 사이 원본이 바뀌어 타깃끼리 어긋나는 일도 없다.
    """
    if node.id in state.spools:
        return state.spools[node.id].tee()

    state.ctx.set_node(node.id, status="running")
    if node.is_source:
        connector = _connector_for(node, state, is_target=False)
        watermark = _load_watermark(state.ctx.pipeline_id, node.id)
        raw = extract(node, connector, state.ctx, watermark=watermark)
    else:  # 변환 노드 — 재귀로 그 상류를 먼저 조립
        raw = transform(node, _build_stream(node, state), state.ctx)

    raw = _sampled(node, raw, state.ctx)

    if len(state.downstream[node.id]) <= 1:
        return raw

    spool = SpooledStream(raw, label=node.id)
    state.spools[node.id] = spool
    return spool.tee()


def _concat(streams: list[Iterator[RecordBatch]]) -> Iterator[RecordBatch]:
    """여러 스트림을 이어붙인다. 마지막 스트림의 마지막 배치에만 is_last 를 남긴다."""
    for index, stream in enumerate(streams):
        is_final_stream = index == len(streams) - 1
        for batch in stream:
            if batch.is_last and not is_final_stream:
                batch.is_last = False
            yield batch


def _connector_for(node: PipelineNode, state: _Exec, *, is_target: bool) -> BaseConnector:
    """노드 파라미터로 커넥터를 열고 노드별로 재사용한다."""
    if node.id in state.opened:
        return state.opened[node.id]

    connection_id = node.params.get("connection_id")
    if not connection_id:
        raise ExecutionError(node.id, "connection_id 가 없습니다")

    write_spec = _write_spec_for(node, state.ctx) if is_target else None
    with session_scope() as session:
        conn = connection_service.get_connection(session, str(connection_id))
        expected = NODE_CONNECTOR_TYPE.get(node.kind)
        if expected and conn.type != expected:
            raise ExecutionError(
                node.id, f"연결 타입 불일치: 노드는 {expected} 를 기대하지만 연결은 {conn.type} 입니다"
            )
        # target.db 는 특정 RDB 로 고정되지 않지만, 아무 커넥터나 받아서도 안 된다
        if node.kind is NodeKind.TARGET_DB and conn.type not in DB_TARGET_TYPES:
            raise ExecutionError(
                node.id,
                f"Target DB 노드에는 RDB 연결이 필요합니다 (가능: {', '.join(sorted(DB_TARGET_TYPES))}) "
                f"— 현재 연결은 {conn.type} 입니다",
            )
        connector = connection_service.open_connector(session, conn, write_spec=write_spec)

    state.opened[node.id] = connector
    state.ctx.log(f"연결 준비 완료: {conn.name} ({conn.type})", node_id=node.id)
    return connector


def _write_spec_for(node: PipelineNode, ctx: RunContext) -> WriteSpec:
    params = node.params
    return WriteSpec(
        table=params.get("table"),
        namespace=params.get("namespace"),
        key_columns=tuple(params.get("key_columns") or ()),
        path_prefix=params.get("path_prefix"),
        file_format=params.get("file_format", "parquet"),
        partition_by=tuple(params.get("partition_by") or ()),
        run_id=ctx.run_id,  # 실행 단위 경로 분리 → S3 멱등성
    )


def _mark_upstream_success(target: PipelineNode, state: _Exec) -> None:
    """타깃이 끝났다는 것은 그 상류가 전부 소진되었다는 뜻이다.

    분기 노드는 다른 타깃도 함께 쓰므로 이미 success 로 찍혀 있을 수 있다 —
    그때는 진행 카운터를 두 번 올리지 않는다.
    """
    ctx = state.ctx
    for parent_id in state.upstream[target.id]:
        parent = state.node_map[parent_id]
        if parent.is_trigger:
            continue
        node_state = ctx.node_state(parent_id)
        if node_state.status != "success":
            ctx.set_node(parent_id, status="success", message=f"{node_state.records:,}건")
            ctx.mark_node_done(parent_id)
        _mark_upstream_success(parent, state)


def _fail_chain(node: PipelineNode, ctx: RunContext, message: str) -> None:
    ctx.set_node(node.id, status="failed", message=message[:500])
    ctx.log(message, node_id=node.id, level=LogLevel.ERROR)


def _encode_watermark(value: Any) -> dict[str, Any]:
    """워터마크를 JSONB 에 넣을 수 있는 형태로 바꾼다.

    증분키로 흔히 쓰이는 datetime/date/Decimal 은 JSON 이 직접 담지 못하므로
    타입 태그를 붙여 문자열로 저장하고, 읽을 때 원래 타입으로 되돌린다.
    타입을 잃으면 다음 실행의 비교 연산이 조용히 어긋난다.
    """
    if isinstance(value, datetime):
        return {"kind": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"kind": "date", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"kind": "decimal", "value": str(value)}
    return {"kind": "scalar", "value": value}


def _decode_watermark(state: dict[str, Any]) -> Any:
    raw = state.get("watermark")
    if not isinstance(raw, dict) or "kind" not in raw:
        return raw  # 태그 없는 옛 형식 — 있는 그대로 쓴다
    kind, value = raw["kind"], raw["value"]
    try:
        if kind == "datetime":
            return datetime.fromisoformat(value)
        if kind == "date":
            return date.fromisoformat(value)
        if kind == "decimal":
            return Decimal(value)
    except (ValueError, TypeError, InvalidOperation):
        logger.warning("워터마크 복원 실패 (%s=%r) — 전체 적재로 대체합니다", kind, value)
        return None
    return value


def _load_watermark(pipeline_id: str, node_id: str) -> Any:
    with session_scope() as session:
        checkpoint = (
            session.query(Checkpoint)
            .filter(Checkpoint.pipeline_id == pipeline_id, Checkpoint.node_id == node_id)
            .one_or_none()
        )
        return _decode_watermark(checkpoint.state) if checkpoint else None


def _persist_checkpoints(ctx: RunContext) -> None:
    """소스 노드별 워터마크를 체크포인트로 승격한다.

    호출 순서가 핵심이다 — 적재가 끝나기 전에 워터마크를 올리면 실패 시 그 구간이
    영원히 유실된다. 그래서 ``execute`` 는 모든 타깃이 성공한 뒤에만 이 함수를 부른다.
    ``full_refresh`` 실행도 워터마크를 갱신한다 — 전체를 다시 읽었으므로 최신 지점이 맞다.
    """
    watermarks = {nid: wm for nid, wm in ctx.watermarks.items() if wm is not None}
    if not watermarks:
        return

    with session_scope() as session:
        for node_id, watermark in watermarks.items():
            checkpoint = (
                session.query(Checkpoint)
                .filter(Checkpoint.pipeline_id == ctx.pipeline_id, Checkpoint.node_id == node_id)
                .one_or_none()
            )
            state = {"watermark": _encode_watermark(watermark)}
            if checkpoint is None:
                session.add(
                    Checkpoint(
                        pipeline_id=ctx.pipeline_id,
                        node_id=node_id,
                        state=state,
                        last_run_id=ctx.run_id,
                    )
                )
            else:
                checkpoint.state = state
                checkpoint.last_run_id = ctx.run_id
    ctx.log(f"체크포인트 저장: {watermarks}")
