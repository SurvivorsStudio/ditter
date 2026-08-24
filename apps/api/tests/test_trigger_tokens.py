"""웹훅 토큰 — 해시 저장과 조회 규칙.

토큰이 곧 자격증명이라 "원문을 남기지 않는다"와 "없는 토큰과 꺼진 토큰을 구분해 알려주지
않는다"가 이 기능의 보안 성질 전부다. DB 를 타지 않는 부분만 여기서 고정한다.
"""

from __future__ import annotations

import re

from eai_api.models import PipelineTrigger
from eai_api.services.trigger_service import PREFIX_LEN, TOKEN_BYTES, hash_token


class TestHashToken:
    def test_is_stable(self) -> None:
        """발급과 검증이 같은 함수를 쓰지 않으면 조회가 영영 안 맞는다."""
        assert hash_token("abc") == hash_token("abc")

    def test_differs_per_token(self) -> None:
        assert hash_token("abc") != hash_token("abd")

    def test_is_sha256_hex(self) -> None:
        digest = hash_token("abc")
        assert len(digest) == 64
        assert re.fullmatch(r"[0-9a-f]{64}", digest)

    def test_known_vector(self) -> None:
        # SHA-256("abc") — 해시 알고리즘을 바꾸면 기존 토큰이 전부 죽는다는 것을 못으로 박는다
        assert hash_token("abc") == ("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


class TestTokenShape:
    def test_token_is_long_enough_to_resist_guessing(self) -> None:
        """32바이트 난수라 사전 공격 대상이 아니다 — 그래서 SHA-256 으로 충분하다."""
        assert TOKEN_BYTES >= 32

    def test_prefix_is_short(self) -> None:
        """앞자리는 구분용이다. 길어지면 토큰 일부가 목록에 노출되는 셈이 된다."""
        assert PREFIX_LEN <= 12


class TestStoredRecord:
    def test_model_has_no_plaintext_column(self) -> None:
        """원문을 담을 자리가 아예 없어야 한다 — 있으면 언젠가 채워진다."""
        columns = set(PipelineTrigger.__table__.c.keys())
        assert "token" not in columns
        assert "token_hash" in columns

    def test_token_hash_is_unique(self) -> None:
        """조회 키다. 유니크가 아니면 같은 해시가 둘일 때 어느 창구인지 알 수 없다."""
        assert PipelineTrigger.__table__.c.token_hash.unique is True

    def test_token_hash_is_indexed(self) -> None:
        """호출마다 해시로 찾는다 — 인덱스가 없으면 전체 스캔이 된다."""
        assert PipelineTrigger.__table__.c.token_hash.index is True

    def test_cascades_with_pipeline(self) -> None:
        """파이프라인을 지우면 창구도 사라져야 한다 — 남으면 주인 없는 토큰이 살아 있다."""
        fk = next(iter(PipelineTrigger.__table__.c.pipeline_id.foreign_keys))
        assert fk.ondelete == "CASCADE"
