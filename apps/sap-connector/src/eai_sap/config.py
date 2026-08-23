"""사이드카 설정.

SAP 접속 자격증명은 **이 컨테이너 안에만** 있다. 워커·API 는 SDK 도 자격증명도 갖지 않고
HTTP 로만 이야기한다 — 그것이 전용 컨테이너로 격리하는 이유다 (설계 문서 §2, §3).
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class SapBackendKind(StrEnum):
    NWRFC = "nwrfc"
    MOCK = "mock"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EAI_SAP_", env_file=".env", extra="ignore")

    #: nwrfc = 실제 SAP, mock = 픽스처 (SDK 없이 개발·CI)
    backend: SapBackendKind = SapBackendKind.MOCK
    mock_fixture: str = "fixtures/sap_mock.json"

    # ── SAP 접속 파라미터 (폴백) ──
    # 방안 A 이후 접속 정보는 요청 body 로 온다(연결 설정에 저장). 아래 값은 요청에
    # 접속 정보가 전혀 없을 때만 쓰이는 폴백이다. 그래서 nwrfc 라도 필수가 아니다 —
    # 접속 정보가 요청에 있으면 되니까. 폴백을 안 쓰면 전부 비워두면 된다.
    ashost: str = ""
    sysnr: str = ""
    client: str = ""
    user: str = ""
    passwd: str = Field(default="", repr=False)
    lang: str = ""
    #: 로드밸런싱 접속을 쓸 때
    mshost: str = ""
    group: str = ""
    sysid: str = ""
    #: SNC (보안 네트워크 통신)
    snc_qop: str = ""
    snc_myname: str = ""
    snc_partnername: str = ""
    snc_lib: str = ""

    #: 사이드카 호출용 공유 토큰. 내부망 전용이지만 무인증으로 두지 않는다.
    api_token: str = Field(default="", repr=False)

    #: 한 번에 읽을 행 수 — 게이트웨이 타임아웃을 피하려면 무한정 읽지 않는다
    page_size: int = 2000
    call_timeout: int = 300

    def connection_params(self) -> dict[str, str]:
        """pyrfc.Connection 인자. 값이 빈 항목은 넘기지 않는다."""
        candidates = {
            "ashost": self.ashost,
            "sysnr": self.sysnr,
            "mshost": self.mshost,
            "group": self.group,
            "sysid": self.sysid,
            "client": self.client,
            "user": self.user,
            "passwd": self.passwd,
            "lang": self.lang,
            "snc_qop": self.snc_qop,
            "snc_myname": self.snc_myname,
            "snc_partnername": self.snc_partnername,
            "snc_lib": self.snc_lib,
        }
        return {k: v for k, v in candidates.items() if v}


@lru_cache
def get_settings() -> Settings:
    return Settings()
