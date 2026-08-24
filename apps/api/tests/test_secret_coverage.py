"""시크릿 분리 누락 방지.

커넥터를 추가하면서 비밀 성격의 설정 키를 SECRET_KEYS 에 넣지 않으면
**평문으로 메타DB 에 남는다.** 이름만 보고도 걸리도록 검사한다.
"""

from __future__ import annotations

import pytest

from eai_api.schemas.connection import SECRET_KEYS
from eai_api.services.connection_service import split_secrets

#: 비밀을 가리키는 이름 조각. 설정 키에 이게 들어 있으면 시크릿이어야 한다.
SECRET_HINTS = ("password", "passwd", "secret", "token", "private_key", "passphrase", "credential")

#: 위 조각을 포함하지만 비밀이 아닌 키 (식별자·설정 스위치)
NOT_SECRET = {
    "access_key_id",  # 식별자다. 짝인 secret_access_key 가 비밀.
}


def all_connector_config_keys() -> set[str]:
    """레지스트리가 인정하는 모든 커넥터 설정 키."""
    from eai_connectors.registry import _ALLOWED_KEYS

    keys: set[str] = set()
    for allowed in _ALLOWED_KEYS.values():
        keys |= set(allowed)
    return keys


def test_every_secret_looking_key_is_declared_secret() -> None:
    suspicious = {
        key
        for key in all_connector_config_keys()
        if key not in NOT_SECRET and any(hint in key for hint in SECRET_HINTS)
    }
    missing = suspicious - set(SECRET_KEYS)
    assert missing == set(), f"SECRET_KEYS 에 빠진 비밀 설정 키: {sorted(missing)} — 평문 저장된다"


def test_sap_sidecar_token_is_split_out() -> None:
    public, secret = split_secrets(
        {"sidecar_url": "http://sap-connector:8100", "api_token": "shared-secret", "tables": "MARA"}
    )
    assert "api_token" not in public
    assert secret == {"api_token": "shared-secret"}
    assert public == {"sidecar_url": "http://sap-connector:8100", "tables": "MARA"}


@pytest.mark.parametrize(
    ("config", "expected_public"),
    [
        ({"host": "h", "password": "p"}, {"host": "h"}),
        ({"bucket": "b", "secret_access_key": "s"}, {"bucket": "b"}),
        ({"uri": "mongodb://x", "password": "p"}, {"uri": "mongodb://x"}),
        ({"sidecar_url": "u", "api_token": "t"}, {"sidecar_url": "u"}),
    ],
)
def test_public_config_never_carries_secrets(
    config: dict[str, str], expected_public: dict[str, str]
) -> None:
    public, _ = split_secrets(config)
    assert public == expected_public


def test_connection_uri_with_embedded_password_is_flagged() -> None:
    """Mongo URI 에 비밀번호를 박아 넣으면 평문으로 남는다 — 알려진 한계로 못박아 둔다.

    URI 는 호스트 정보이기도 해서 통째로 시크릿 처리하면 UI 에서 접속 대상을
    분간할 수 없다. 대신 UI 가 user/password 필드를 따로 두어 유도한다.
    """
    public, secret = split_secrets({"uri": "mongodb://user:pw@host/db"})
    assert public == {"uri": "mongodb://user:pw@host/db"}
    assert secret == {}
