"""RFC_READ_TABLE — SAP 의 512자·72자 제약을 넘기는 로직."""

from __future__ import annotations

import pytest

from eai_sap.backends.base import SapCallError
from eai_sap.read_table import (
    MAX_OPTION_LINE,
    MAX_ROW_WIDTH,
    SapField,
    parse_row,
    split_fields_by_width,
    split_where_clause,
)


def f(name: str, length: int, offset: int = 0) -> SapField:
    return SapField(name=name, length=length, offset=offset)


class TestSplitFieldsByWidth:
    def test_narrow_fields_stay_in_one_group(self) -> None:
        groups = split_fields_by_width([f("A", 10), f("B", 20)], delimiter="")
        assert len(groups) == 1

    def test_splits_when_exceeding_limit(self) -> None:
        # 300 + 300 = 600 > 512
        groups = split_fields_by_width([f("A", 300), f("B", 300)], delimiter="")
        assert len(groups) == 2
        assert [x.name for x in groups[0]] == ["A"]
        assert [x.name for x in groups[1]] == ["B"]

    def test_every_group_fits_the_limit(self) -> None:
        fields = [f(f"F{i}", 100) for i in range(12)]  # 1200자
        for group in split_fields_by_width(fields, delimiter=""):
            assert sum(x.length for x in group) <= MAX_ROW_WIDTH

    def test_field_order_is_preserved(self) -> None:
        fields = [f(f"F{i}", 100) for i in range(12)]
        flattened = [x.name for group in split_fields_by_width(fields, delimiter="") for x in group]
        assert flattened == [x.name for x in fields]

    def test_no_field_is_lost_or_duplicated(self) -> None:
        fields = [f(f"F{i}", 77) for i in range(20)]
        flattened = [x.name for group in split_fields_by_width(fields, delimiter="") for x in group]
        assert sorted(flattened) == sorted(x.name for x in fields)
        assert len(flattened) == len(set(flattened))

    def test_delimiter_counts_toward_width(self) -> None:
        """구분자도 512자 안에 들어간다 — 빼먹으면 SAP 이 거부한다."""
        fields = [f(f"F{i}", 64) for i in range(8)]  # 512 정확히
        assert len(split_fields_by_width(fields, delimiter="")) == 1
        assert len(split_fields_by_width(fields, delimiter="|")) == 2

    def test_single_field_wider_than_limit_is_rejected(self) -> None:
        with pytest.raises(SapCallError, match="넓어"):
            split_fields_by_width([f("HUGE", 600)], delimiter="")

    def test_empty_input(self) -> None:
        assert split_fields_by_width([], delimiter="") == []


class TestSplitWhereClause:
    def test_empty_clause(self) -> None:
        assert split_where_clause("") == []
        assert split_where_clause("   ") == []

    def test_short_clause_stays_one_line(self) -> None:
        assert split_where_clause("MTART = 'FERT'") == ["MTART = 'FERT'"]

    def test_long_clause_is_split(self) -> None:
        clause = " AND ".join(f"FIELD{i} = 'VALUE{i}'" for i in range(10))
        lines = split_where_clause(clause)
        assert len(lines) > 1
        assert all(len(line) <= MAX_OPTION_LINE for line in lines)

    def test_rejoining_lines_reproduces_the_clause(self) -> None:
        """줄을 공백으로 다시 이으면 원래 조건이어야 한다 — 토큰이 잘리면 문법이 깨진다."""
        clause = "MTART = 'FERT' AND LAEDA > '20260101' AND MATKL = 'PAPER-001'"
        assert " ".join(split_where_clause(clause)) == clause

    def test_quoted_values_with_spaces_are_not_broken(self) -> None:
        clause = "GROES = '1200x800x25 mm' AND MTART = 'FERT'"
        lines = split_where_clause(clause)
        assert " ".join(lines) == clause
        # 리터럴이 두 줄로 쪼개지지 않았는지
        assert any("'1200x800x25 mm'" in line for line in lines)

    def test_token_longer_than_line_limit_is_reported(self) -> None:
        with pytest.raises(SapCallError, match="한 줄 한계"):
            split_where_clause(f"FIELD = '{'x' * 100}'")

    def test_whitespace_is_normalized(self) -> None:
        assert split_where_clause("  MTART   =    'FERT'  ") == ["MTART = 'FERT'"]


class TestParseRow:
    def test_fixed_width_parsing(self) -> None:
        fields = [f("A", 5, 0), f("B", 3, 5)]
        assert parse_row("HELLO123", fields, "") == {"A": "HELLO", "B": "123"}

    def test_fixed_width_strips_padding(self) -> None:
        fields = [f("A", 5, 0), f("B", 5, 5)]
        assert parse_row("AB   CD   ", fields, "") == {"A": "AB", "B": "CD"}

    def test_delimited_parsing(self) -> None:
        fields = [f("A", 5), f("B", 5)]
        assert parse_row("AB|CD", fields, "|") == {"A": "AB", "B": "CD"}

    def test_missing_trailing_parts_become_empty(self) -> None:
        """마지막 필드가 비면 SAP 이 조각을 덜 주기도 한다 — 빠뜨리지 않고 채운다."""
        fields = [f("A", 5), f("B", 5), f("C", 5)]
        assert parse_row("AB|CD", fields, "|") == {"A": "AB", "B": "CD", "C": ""}

    def test_korean_values_survive(self) -> None:
        fields = [f("A", 10), f("B", 10)]
        assert parse_row("펄프 100%|MDF", fields, "|") == {"A": "펄프 100%", "B": "MDF"}
