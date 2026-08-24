"""연결 수정 규칙.

편집 화면은 시크릿을 **되돌려주지 않는다** (서버가 절대 내보내지 않으므로).
그래서 비밀번호 칸을 비운 채 저장하는 것이 정상 흐름이고, 그때 기존 시크릿이
지워지면 연결이 조용히 끊긴다. 그 계약을 여기서 고정한다.
"""

from __future__ import annotations

from eai_api.schemas.connection import SECRET_KEYS
from eai_api.services.connection_service import split_secrets


class TestSecretPreservationOnEdit:
    def test_config_without_secret_yields_empty_secret(self) -> None:
        """비밀번호를 빼고 보내면 시크릿 저장소를 건드리지 않아야 한다.

        서비스 계층이 ``if secret:`` 으로 분기하므로, 빈 시크릿은 곧 '유지'를 뜻한다.
        """
        public, secret = split_secrets(
            {"host": "localhost", "port": 5432, "database": "eai", "user": "eai"}
        )
        assert secret == {}
        assert public == {"host": "localhost", "port": 5432, "database": "eai", "user": "eai"}

    def test_config_with_secret_replaces_it(self) -> None:
        public, secret = split_secrets({"host": "h", "password": "new-password"})
        assert secret == {"password": "new-password"}
        assert public == {"host": "h"}

    def test_blank_secret_is_treated_as_absent(self) -> None:
        """폼이 빈 문자열을 보내더라도 기존 시크릿을 지우면 안 된다."""
        _, secret = split_secrets({"host": "h", "password": ""})
        assert secret == {}

    def test_sap_token_follows_the_same_rule(self) -> None:
        _, keep = split_secrets({"sidecar_url": "http://sap:8100"})
        _, replace = split_secrets({"sidecar_url": "http://sap:8100", "api_token": "t2"})
        assert keep == {}
        assert replace == {"api_token": "t2"}


class TestPublicConfigIsReplacedWholesale:
    def test_omitted_public_key_disappears(self) -> None:
        """공개 설정은 통째로 교체된다 — 폼이 전체 필드를 보내야 하는 이유다.

        일부만 보내면 나머지가 사라진다. 편집 폼이 기존 값을 미리 채워 넣는 것은
        편의가 아니라 **정확성 요건**이다.
        """
        public, _ = split_secrets({"host": "h"})
        assert "database" not in public


def test_every_password_kind_field_is_a_secret() -> None:
    """폼에서 password 로 그리는 항목은 모두 SECRET_KEYS 에 있어야 한다.

    아니면 편집 시 평문으로 config 에 저장되고, 화면에도 되돌아온다.
    """
    password_like = {"password", "secret_access_key", "api_token"}
    assert password_like <= set(SECRET_KEYS)
