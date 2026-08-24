"""시크릿 분리 — config 와 시크릿이 절대 섞이지 않아야 한다 (설계 문서 §4, §11)."""

from __future__ import annotations

import pytest

from eai_api.services.connection_service import split_secrets


def test_password_is_extracted_from_config() -> None:
    public, secret = split_secrets(
        {"host": "db.internal", "port": 5432, "user": "eai", "password": "hunter2"}
    )
    assert "password" not in public
    assert secret == {"password": "hunter2"}
    assert public == {"host": "db.internal", "port": 5432, "user": "eai"}


def test_s3_credentials_are_extracted() -> None:
    public, secret = split_secrets(
        {"bucket": "lake", "region": "ap-northeast-2", "access_key_id": "AKIA", "secret_access_key": "s3cr3t"}
    )
    # access_key_id 는 식별자라 공개 설정에 남고, 비밀값만 분리된다
    assert public == {"bucket": "lake", "region": "ap-northeast-2", "access_key_id": "AKIA"}
    assert secret == {"secret_access_key": "s3cr3t"}


@pytest.mark.parametrize("empty", ["", None])
def test_empty_secret_values_are_not_stored(empty: object) -> None:
    """빈 비밀번호로 기존 시크릿을 덮어써 지워버리는 사고를 막는다."""
    _, secret = split_secrets({"host": "h", "password": empty})
    assert secret == {}


def test_no_secret_keys_yields_empty_secret() -> None:
    public, secret = split_secrets({"host": "h", "database": "d"})
    assert secret == {}
    assert public == {"host": "h", "database": "d"}


def test_all_known_secret_keys_are_split() -> None:
    from eai_api.schemas.connection import SECRET_KEYS

    config = dict.fromkeys(SECRET_KEYS, "value") | {"host": "h"}
    public, secret = split_secrets(config)
    assert set(secret) == set(SECRET_KEYS)
    assert public == {"host": "h"}
