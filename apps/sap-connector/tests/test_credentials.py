"""접속 정보 수신과 백엔드 풀 (방안 A).

접속 정보가 요청 body 로 오고, 사이드카는 접속 정보별로 커넥션을 캐시한다.
비밀번호가 로그·키에 평문으로 새지 않는지도 함께 본다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from eai_sap.backends import _params_key, reset_backends, resolve_backend
from eai_sap.config import Settings
from eai_sap.credentials import SapCredentials

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "sap_mock.json"


class TestSapCredentials:
    def test_empty_by_default(self) -> None:
        assert SapCredentials().is_empty()

    def test_not_empty_with_any_field(self) -> None:
        assert not SapCredentials(ashost="h").is_empty()

    def test_only_set_fields_in_params(self) -> None:
        creds = SapCredentials(ashost="sap-prd", client="100", user="EAI", passwd="pw")
        assert creds.to_params() == {
            "ashost": "sap-prd",
            "client": "100",
            "user": "EAI",
            "passwd": "pw",
        }
        assert "sysnr" not in creds.to_params()  # 빈 값은 안 넘긴다

    def test_password_hidden_in_repr(self) -> None:
        """접속 정보가 로그에 찍혀도 비밀번호는 가려져야 한다."""
        assert "sup3rsecret" not in repr(SapCredentials(passwd="sup3rsecret"))


class TestParamsKey:
    def test_same_params_same_key(self) -> None:
        p = {"ashost": "h", "client": "100", "passwd": "pw"}
        assert _params_key(p) == _params_key(dict(p))

    def test_key_order_independent(self) -> None:
        a = {"ashost": "h", "client": "100"}
        b = {"client": "100", "ashost": "h"}
        assert _params_key(a) == _params_key(b)

    def test_different_password_different_key(self) -> None:
        assert _params_key({"user": "u", "passwd": "a"}) != _params_key({"user": "u", "passwd": "b"})

    def test_key_does_not_contain_plaintext_password(self) -> None:
        """키는 해시라 비밀번호가 그대로 드러나면 안 된다."""
        key = _params_key({"user": "u", "passwd": "sup3rsecret"})
        assert "sup3rsecret" not in key


class TestResolveBackend:
    @pytest.fixture(autouse=True)
    def _clean(self) -> None:
        reset_backends()

    def test_mock_ignores_credentials(self) -> None:
        settings = Settings(backend="mock", mock_fixture=str(FIXTURE))
        b1 = resolve_backend(settings, SapCredentials(ashost="a"))
        b2 = resolve_backend(settings, SapCredentials(ashost="b"))
        assert b1 is b2  # 목은 접속 정보와 무관한 단일 인스턴스

    def test_mock_works_without_credentials(self) -> None:
        settings = Settings(backend="mock", mock_fixture=str(FIXTURE))
        assert resolve_backend(settings, None).ping()["mock"] is True

    def test_nwrfc_without_credentials_and_no_env_fails(self) -> None:
        """nwrfc 인데 요청에도 .env 에도 접속 정보가 없으면 명확히 알린다."""
        from eai_sap.backends.base import SapConnectionError

        settings = Settings(backend="nwrfc")  # .env 폴백 비어 있음
        with pytest.raises(SapConnectionError, match="접속 정보가 없습니다"):
            resolve_backend(settings, SapCredentials())
