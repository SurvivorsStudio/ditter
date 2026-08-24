"""SAP 접속 정보 — 요청 body 로 전달된다.

방안 A: 접속 정보는 사이드카 ``.env`` 가 아니라 **연결 설정에 저장**되고, 워커가 호출할 때
암호화 구간을 지나 요청 body 로 온다. 사이드카는 SDK 만 든 순수 게이트웨이가 된다.
``.env`` 접속 정보는 요청에 아무것도 없을 때의 폴백으로만 남는다.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

#: pyrfc.Connection 이 받는 접속 파라미터. 값이 있는 것만 넘긴다.
_PARAM_KEYS = (
    "ashost",
    "sysnr",
    "mshost",
    "group",
    "sysid",
    "client",
    "user",
    "passwd",
    "lang",
    "snc_qop",
    "snc_myname",
    "snc_partnername",
    "snc_lib",
)


class SapCredentials(BaseModel):
    """SAP 접속 정보. 전부 선택이며, 준 것만 pyrfc 로 넘어간다."""

    ashost: str = ""
    sysnr: str = ""
    client: str = ""
    user: str = ""
    passwd: str = Field(default="", repr=False)  # repr 에서 가려 로그 유출을 막는다
    lang: str = ""
    # 로드밸런싱 접속
    mshost: str = ""
    group: str = ""
    sysid: str = ""
    # SNC (보안 네트워크 통신)
    snc_qop: str = ""
    snc_myname: str = ""
    snc_partnername: str = ""
    snc_lib: str = ""

    def is_empty(self) -> bool:
        return not any(getattr(self, k) for k in _PARAM_KEYS)

    def to_params(self) -> dict[str, str]:
        """값이 있는 항목만 담은 pyrfc 인자."""
        return {k: v for k in _PARAM_KEYS if (v := getattr(self, k))}
