"""변수 문법 — `$이름` 자리표시자.

프론트 `src/canvas/variables.test.ts` 에 **같은 사례**가 들어 있다. 한쪽 문법만 고치면
양쪽 테스트가 함께 깨지도록 의도한 것이다 — 문법이 갈리면 저작 화면과 실행이 어긋난다.
"""

from __future__ import annotations

import ast

import pytest

from eai_api.schemas.variables import (
    InvalidVariableValueError,
    MissingVariableError,
    NodeRef,
    VariableError,
    assert_sql_safe,
    extract,
    extract_from_params,
    extract_node_refs,
    extract_node_refs_from_params,
    malformed_placeholders,
    missing,
    render,
    sql_context_names,
    substitute,
    substitute_params,
)


class TestExtract:
    def test_plain(self) -> None:
        assert extract("SELECT * FROM t WHERE id = $order_id") == ["order_id"]

    def test_braced(self) -> None:
        assert extract("orders_${suffix}_raw") == ["suffix"]

    def test_braced_disambiguates(self) -> None:
        """`$table_x` 는 통째로 한 이름이다 — 경계를 나누려면 중괄호를 써야 한다."""
        assert extract("$table_x") == ["table_x"]
        assert extract("${table}_x") == ["table"]

    def test_multiple_in_order_without_duplicates(self) -> None:
        assert extract("$b and $a and $b") == ["b", "a"]

    def test_no_variables(self) -> None:
        assert extract("SELECT 1") == []
        assert extract("") == []

    def test_escaped_dollar_is_not_a_variable(self) -> None:
        assert extract("price >= $$100") == []

    def test_name_cannot_start_with_digit(self) -> None:
        assert extract("$1st") == []

    def test_bare_dollar_is_ignored(self) -> None:
        assert extract("cost in $ only") == []

    def test_nested_params(self) -> None:
        params = {
            "table": "orders",
            "where": "dt >= $since",
            "options": {"prefix": "$env", "tags": ["$env", "static"]},
        }
        assert extract_from_params(params) == ["since", "env"]

    def test_empty_params(self) -> None:
        assert extract_from_params(None) == []
        assert extract_from_params({}) == []


class TestSubstitute:
    def test_replaces_value(self) -> None:
        assert substitute("id = $order_id", {"order_id": 42}) == "id = 42"

    def test_braced_form(self) -> None:
        assert substitute("orders_${suffix}_raw", {"suffix": "kr"}) == "orders_kr_raw"

    def test_repeated_variable(self) -> None:
        assert substitute("$a-$a", {"a": "x"}) == "x-x"

    def test_escaped_dollar_survives_as_literal(self) -> None:
        assert substitute("price >= $$100", {}) == "price >= $100"

    def test_missing_value_raises(self) -> None:
        """빈 문자열로 때우면 `WHERE d > ''` 가 되어 전체 재적재가 조용히 일어난다."""
        with pytest.raises(MissingVariableError) as exc:
            substitute("dt > $since", {})
        assert "since" in str(exc.value)

    def test_untouched_when_no_placeholder(self) -> None:
        assert substitute("SELECT 1", {"a": 1}) == "SELECT 1"

    def test_dollar_quoted_body_is_not_substituted(self) -> None:
        """프로시저·함수 본문의 $procedure$ 는 변수가 아니다 — 값이 없어도 실행이 깨지면 안 된다."""
        ddl = "CREATE PROCEDURE p() AS $procedure$ DECLARE x int; BEGIN NULL; END; $procedure$"
        assert substitute(ddl, {}) == ddl

    def test_variable_outside_dollar_quote_still_substitutes(self) -> None:
        ddl = "$since $procedure$ SELECT $inside $procedure$"
        assert substitute(ddl, {"since": "2026"}) == "2026 $procedure$ SELECT $inside $procedure$"

    def test_extract_skips_names_inside_dollar_quote(self) -> None:
        assert extract("$a $body$ $b $c $body$ $d") == ["a", "d"]


class TestRender:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [(42, "42"), (1.5, "1.5"), ("x", "x"), (True, "true"), (False, "false"), (None, "null")],
    )
    def test_json_flavored_scalars(self, value: object, expected: str) -> None:
        """`True` 를 그대로 쓰면 SQL 이 못 알아듣는다 — JSON 표기로 맞춘다."""
        assert render(value) == expected


class TestSqlInjectionGuard:
    @pytest.mark.parametrize("bad", ["o'brien", 'a"b', "1; DROP TABLE t", "x -- c", "a /* c */ b"])
    def test_rejected_in_sql_context(self, bad: str) -> None:
        with pytest.raises(InvalidVariableValueError):
            substitute("dt > $v", {"v": bad}, context_key="where")

    def test_control_characters_rejected(self) -> None:
        with pytest.raises(InvalidVariableValueError):
            substitute("dt > $v", {"v": "a\nb"}, context_key="query")

    def test_allowed_outside_sql_context(self) -> None:
        """테이블 접두사나 S3 경로에 들어가는 값까지 막을 이유는 없다."""
        assert substitute("$v", {"v": "o'brien"}, context_key="prefix") == "o'brien"

    def test_ordinary_value_passes(self) -> None:
        assert substitute("dt > $v", {"v": "2026-08-13"}, context_key="where") == "dt > 2026-08-13"


class TestSubstituteParams:
    def test_walks_nested_structures(self) -> None:
        params = {"table": "t_$env", "options": {"tags": ["$env"]}}
        assert substitute_params(params, {"env": "prd"}) == {
            "table": "t_prd",
            "options": {"tags": ["prd"]},
        }

    def test_sql_context_inherited_by_nested_values(self) -> None:
        """`query.text` 도 결국 SQL 로 조립된다 — 최상위 키의 문맥을 물려받아야 한다."""
        with pytest.raises(InvalidVariableValueError):
            substitute_params({"query": {"text": "$v"}}, {"v": "a';--"})

    def test_non_string_values_untouched(self) -> None:
        params = {"limit": 100, "enabled": True, "ratio": 1.5}
        assert substitute_params(params, {}) == params


class TestSqlContextNames:
    """SQL 자리에 꽂히는 변수 이름 — 호출을 받는 시점에 주입 가드를 걸기 위한 것."""

    def test_finds_names_in_sql_params(self) -> None:
        assert sql_context_names({"where": "dt >= $since"}) == {"since"}

    def test_ignores_names_outside_sql_params(self) -> None:
        assert sql_context_names({"table": "t_$env", "prefix": "$env/"}) == set()

    def test_nested_inherits_the_top_level_key(self) -> None:
        """`query.text` 도 결국 SQL 로 조립된다."""
        assert sql_context_names({"query": {"text": "$v"}}) == {"v"}

    def test_mixed_params(self) -> None:
        params = {"where": "dt >= $since", "table": "t_$env"}
        assert sql_context_names(params) == {"since"}

    def test_empty(self) -> None:
        assert sql_context_names(None) == set()
        assert sql_context_names({}) == set()


class TestAssertSqlSafe:
    def test_rejects_injection(self) -> None:
        with pytest.raises(InvalidVariableValueError):
            assert_sql_safe("v", "a';--")

    def test_allows_ordinary_value(self) -> None:
        assert_sql_safe("v", "kim")

    def test_renders_before_checking(self) -> None:
        """숫자·불리언도 문자열로 만든 뒤 본다 — 통과해야 한다."""
        assert_sql_safe("v", 42)
        assert_sql_safe("v", True)


class TestMissing:
    def test_lists_only_absent_names(self) -> None:
        assert missing(["a", "b", "c"], {"a": 1, "c": 3}) == ["b"]

    def test_empty_when_all_present(self) -> None:
        assert missing(["a"], {"a": None}) == []


class TestNodeRefExtract:
    """`${노드이름.컬럼}` — 그 노드가 낸 첫 행의 그 컬럼 값."""

    def test_plain(self) -> None:
        assert extract_node_refs("dt > '${주문조회.max_dt}'") == [NodeRef("주문조회", "max_dt")]

    def test_name_may_contain_spaces(self) -> None:
        assert extract_node_refs("${daily agg.v}") == [NodeRef("daily agg", "v")]

    def test_padding_is_trimmed(self) -> None:
        assert extract_node_refs("${ 집계 . v }") == [NodeRef("집계", "v")]

    def test_last_dot_splits_name_from_column(self) -> None:
        """이름에 점이 있어도 컬럼을 잃지 않는다 — 컬럼 쪽이 점을 못 쓰기 때문."""
        assert extract_node_refs("${주문.집계.dt}") == [NodeRef("주문.집계", "dt")]

    def test_braces_are_required(self) -> None:
        """중괄호가 없으면 이름의 끝을 알 수 없다 — 노드 참조로 보지 않는다."""
        assert extract_node_refs("$집계.v") == []

    def test_multiple_in_order_without_duplicates(self) -> None:
        text = "${a.x} ${b.y} ${a.x}"
        assert extract_node_refs(text) == [NodeRef("a", "x"), NodeRef("b", "y")]

    def test_escaped_dollar_is_not_a_reference(self) -> None:
        assert extract_node_refs("$${a.x}") == []

    def test_trigger_variable_is_not_a_node_ref(self) -> None:
        assert extract_node_refs("${since}") == []
        assert extract("${집계.v}") == []

    def test_from_nested_params(self) -> None:
        params = {"options": {"prefix": "${집계.dt}"}, "rows": ["${집계.v}"]}
        assert extract_node_refs_from_params(params) == [NodeRef("집계", "dt"), NodeRef("집계", "v")]

    def test_key_is_the_lookup_name(self) -> None:
        assert NodeRef("집계", "v").key == "집계.v"
        assert str(NodeRef("집계", "v")) == "${집계.v}"


class TestNodeRefSubstitute:
    def test_replaces_with_the_value(self) -> None:
        assert substitute("dt > '${집계.max_dt}'", {"집계.max_dt": "2026-08-01"}) == "dt > '2026-08-01'"

    def test_missing_value_raises(self) -> None:
        with pytest.raises(MissingVariableError):
            substitute("${집계.v}", {})

    def test_mixes_with_trigger_variables(self) -> None:
        out = substitute("$env/${집계.v}", {"env": "prd", "집계.v": 7})
        assert out == "prd/7"

    def test_injected_value_is_not_scanned_again(self) -> None:
        """꽂아 넣은 값 안의 `$` 를 다시 변수로 읽으면 안 된다 — 한 번의 순회로 끝낸다."""
        assert substitute("${집계.v}", {"집계.v": "$env"}) == "$env"

    def test_sql_context_guard_applies(self) -> None:
        with pytest.raises(InvalidVariableValueError):
            substitute("name = ${집계.name}", {"집계.name": "o'brien"}, context_key="where")

    def test_non_sql_context_allows_quotes(self) -> None:
        assert substitute("${집계.name}", {"집계.name": "o'brien"}, context_key="table") == "o'brien"

    def test_params_substitution_inherits_sql_context(self) -> None:
        with pytest.raises(InvalidVariableValueError):
            substitute_params({"query": {"text": "${집계.v}"}}, {"집계.v": "a;b"})


class TestMalformedPlaceholders:
    """치환되지 않고 글자 그대로 남는 `${...}` — 대개 오타다."""

    def test_missing_column(self) -> None:
        assert malformed_placeholders({"where": "${집계.}"}) == ["${집계.}"]

    def test_missing_name(self) -> None:
        assert malformed_placeholders({"where": "${.v}"}) == ["${.v}"]

    def test_valid_forms_are_not_reported(self) -> None:
        assert malformed_placeholders({"a": "${since}", "b": "${집계.v}"}) == []

    def test_escaped_dollar_is_not_reported(self) -> None:
        assert malformed_placeholders({"a": "$${x}"}) == []

    def test_reported_once(self) -> None:
        assert malformed_placeholders({"a": "${.v} ${.v}"}) == ["${.v}"]


class TestNodeRefList:
    """`${이름.컬럼[]}` — 모든 행의 그 컬럼. `IN (...)` 을 위한 것이다."""

    def test_brackets_mark_a_list(self) -> None:
        assert extract_node_refs("${주문.id[]}") == [NodeRef("주문", "id", True)]

    def test_padding_inside_brackets(self) -> None:
        assert extract_node_refs("${ 주문 . id [ ] }") == [NodeRef("주문", "id", True)]

    def test_scalar_and_list_are_different_keys(self) -> None:
        """한 파이프라인에서 `${주문.id}` 와 `${주문.id[]}` 를 함께 쓸 수 있어야 한다."""
        assert NodeRef("주문", "id").key == "주문.id"
        assert NodeRef("주문", "id", True).key == "주문.id[]"
        assert len(extract_node_refs("${주문.id} ${주문.id[]}")) == 2

    def test_numbers_are_joined_bare(self) -> None:
        out = substitute("id IN (${주문.id[]})", {"주문.id[]": [1, 2, 3]}, context_key="where")
        assert out == "id IN (1, 2, 3)"

    def test_strings_are_quoted_for_us(self) -> None:
        """원소마다 따옴표를 손으로 감쌀 방법이 없다 — 우리가 붙인다."""
        out = substitute("name IN (${주문.name[]})", {"주문.name[]": ["Kim", "Lee"]}, context_key="where")
        assert out == "name IN ('Kim', 'Lee')"

    def test_guard_runs_before_quoting(self) -> None:
        """순서가 뒤집히면 우리가 붙인 따옴표가 그대로 주입 통로가 된다."""
        with pytest.raises(InvalidVariableValueError):
            substitute("name IN (${주문.name[]})", {"주문.name[]": ["o'brien"]}, context_key="where")

    def test_outside_sql_context_no_quotes(self) -> None:
        assert substitute("${주문.id[]}", {"주문.id[]": [1, 2]}, context_key="table") == "1, 2"

    def test_empty_list_is_refused(self) -> None:
        """`IN ()` 은 문법 오류이고, `IN (NULL)` 로 때우면 빈 결과가 조용히 지나간다."""
        with pytest.raises(MissingVariableError):
            substitute("${주문.id[]}", {"주문.id[]": []})

    def test_scalar_in_a_list_slot_is_refused(self) -> None:
        with pytest.raises(VariableError):
            substitute("${주문.id[]}", {"주문.id[]": 1})

    def test_null_stays_null(self) -> None:
        assert substitute("${주문.id[]}", {"주문.id[]": [1, None]}, context_key="where") == "1, null"

    def test_booleans_are_not_quoted(self) -> None:
        assert substitute("${주문.f[]}", {"주문.f[]": [True, False]}, context_key="where") == "true, false"

    def test_list_form_is_valid_syntax(self) -> None:
        assert malformed_placeholders({"where": "${주문.id[]}"}) == []


class TestPythonContext:
    """`transform.python` 의 ``code`` 는 SQL 이 아니라 **Python** 으로 조립된다.

    JSON 표기(true/null)를 그대로 꽂으면 NameError 이고, 문자 목록에 따옴표가 없으면
    그대로 이름으로 읽혀 터진다 — 코드 자리에서는 Python 리터럴이어야 한다.
    """

    def code(self, source: str, values: dict[str, object]) -> str:
        return substitute_params({"code": source}, values)["code"]

    def test_number_list_becomes_python_list(self) -> None:
        assert self.code("ALLOWED = [${주문.id[]}]", {"주문.id[]": [1, 2, 3]}) == "ALLOWED = [1, 2, 3]"

    def test_string_list_is_quoted(self) -> None:
        out = self.code("NAMES = [${주문.name[]}]", {"주문.name[]": ["Kim", "Lee"]})
        assert out == "NAMES = ['Kim', 'Lee']"

    def test_quote_inside_a_value_is_escaped(self) -> None:
        """직접 감싸면 O'Brien 에서 문자열이 깨진다 — repr 에 맡긴다."""
        out = self.code("NAMES = [${주문.name[]}]", {"주문.name[]": ["O'Brien"]})
        assert out == 'NAMES = ["O\'Brien"]'
        # 결과가 실제로 유효한 Python 인지까지 확인한다 (따옴표만 맞춰서는 알 수 없다)
        assert ast.literal_eval(out.split("= ")[1]) == ["O'Brien"]

    def test_boolean_uses_python_spelling(self) -> None:
        assert self.code("flag = ${주문.f}", {"주문.f": True}) == "flag = True"

    def test_none_uses_python_spelling(self) -> None:
        assert self.code("x = ${주문.v}", {"주문.v": None}) == "x = None"

    def test_string_scalar_is_left_bare(self) -> None:
        """낱값은 사용자가 따옴표를 붙이는 자리다 — 또 감싸면 "'2026-08-01'" 이 된다."""
        assert self.code('dt = "${주문.dt}"', {"주문.dt": "2026-08-01"}) == 'dt = "2026-08-01"'

    def test_trigger_variables_too(self) -> None:
        assert self.code("n = $limit", {"limit": 10}) == "n = 10"

    def test_no_injection_guard_in_code(self) -> None:
        """샌드박스에서 도는 코드다. 따옴표를 막으면 O'Brien 을 못 쓴다."""
        assert self.code('who = "${주문.name}"', {"주문.name": "kim"}) == 'who = "kim"'

    def test_sql_context_is_unchanged(self) -> None:
        out = substitute_params({"where": "id IN (${주문.id[]})"}, {"주문.id[]": [1, 2]})
        assert out["where"] == "id IN (1, 2)"


class TestPythonControlChars:
    """제어문자가 든 값도 유효한 Python 리터럴이 되어야 한다.

    프런트 `canvas/variables.test.ts` 의 「제어문자」 사례와 **같은 값·같은 기대치**다.
    한쪽만 고치면 "편집기에서는 되는데 실행하면 다르다"가 나므로 양쪽이 함께 깨져야 한다
    (`variables.ts` 머리말의 전제).
    """

    def code(self, source: str, values: dict[str, object]) -> str:
        return substitute_params({"code": source}, values)["code"]

    def test_newline_is_escaped(self) -> None:
        """따옴표 하나짜리 리터럴은 실제 줄바꿈을 담을 수 없다 — SyntaxError 다."""
        out = self.code("N = [${주문.memo[]}]", {"주문.memo[]": ["a\nb"]})
        assert out == "N = ['a\\nb']"
        assert ast.literal_eval(out.split("= ")[1]) == ["a\nb"]

    def test_carriage_return_and_tab(self) -> None:
        assert self.code("N = [${주문.memo[]}]", {"주문.memo[]": ["line1\r\nline2"]}) == (
            "N = ['line1\\r\\nline2']"
        )
        assert self.code("N = [${주문.memo[]}]", {"주문.memo[]": ["a\tb"]}) == "N = ['a\\tb']"

    def test_unnamed_control_chars_use_hex(self) -> None:
        """NUL 은 Python 소스에 아예 못 들어간다 — 이스케이프가 유일한 길이다."""
        assert self.code("N = [${주문.memo[]}]", {"주문.memo[]": ["a\x00b"]}) == "N = ['a\\x00b']"
        assert self.code("N = [${주문.memo[]}]", {"주문.memo[]": ["a\x1bb"]}) == "N = ['a\\x1bb']"

    def test_backslash_is_doubled(self) -> None:
        assert self.code("N = [${주문.p[]}]", {"주문.p[]": ["C:\\path"]}) == "N = ['C:\\\\path']"
        # 값이 이미 `\n` 두 글자면 그대로 두 글자여야 한다 (줄바꿈으로 오해하지 않는다)
        assert self.code("N = [${주문.p[]}]", {"주문.p[]": ["a\\nb"]}) == "N = ['a\\\\nb']"

    def test_both_quote_kinds(self) -> None:
        out = self.code("N = [${주문.t[]}]", {"주문.t[]": ["has \"dq\" and 'sq'"]})
        assert out == """N = ['has "dq" and \\'sq\\'']"""
        assert ast.literal_eval(out.split("= ")[1]) == ["has \"dq\" and 'sq'"]

    def test_nonascii_invisible_differs_from_front_but_evaluates_the_same(self) -> None:
        """**여기서 양쪽 표기가 갈린다** — 알고 두는 것이지 버그가 아니다.

        `repr` 은 비ASCII 비출력 문자를 ``\\u200b`` 로 쓰지만 프런트는 원문 그대로 둔다.
        그 글자는 리터럴 안에 그냥 있어도 유효한 Python 이라 **값은 같다.** 글자까지 맞추려면
        유니코드 printable 표를 프런트에 복제해야 하는데, 그것이야말로 이 파일이 경계하는
        「양쪽이 어긋난다」를 하나 더 만드는 일이다.

        프런트의 같은 사례: `canvas/variables.test.ts` 의 「비ASCII 비출력 문자」.
        """
        out = self.code("N = [${주문.z[]}]", {"주문.z[]": ["a\u200bb"]})
        assert out == "N = ['a\\u200bb']"          # 백엔드는 이스케이프한다
        assert ast.literal_eval(out.split("= ")[1]) == ["a\u200bb"]
        # 프런트가 내는 원문 그대로도 같은 값으로 읽힌다 — 그래서 안전하다
        assert ast.literal_eval("['a\u200bb']") == ["a\u200bb"]
