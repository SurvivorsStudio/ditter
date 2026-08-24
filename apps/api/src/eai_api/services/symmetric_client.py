"""SymmetricDS 사이드카 HTTP 클라이언트.

``cdc_connect.DebeziumClient`` 와 같은 자리에 있지만 **의존하는 정도가 훨씬 얕다.**
Debezium 은 REST 가 없으면 아무것도 못 하지만, SymmetricDS 는 설정이 원본 DB 안의
SYM_* 테이블이라 우리가 SQL 로 직접 넣는다.

**공식 이미지(jumpmind/symmetricds:3.15)에는 REST API 모듈이 아예 없다.** 2026-08-18 에
3.15.22 이미지를 뒤져 확인했다 — ``find / -iname '*rest*'`` 가 한 건도 없고,
``rest.api.enable=true`` 를 켜도 ``/api/*`` 는 계속 404 다(Spring 의 "No static resource").
그래서 이 클라이언트는 REST 를 **있으면 쓰고 없으면 넘어가는 것**으로 다룬다.

- 살아 있는지·엔진이 있는지는 **동기화 서블릿**(``/sync/{engine}``)으로 본다. REST 없이도
  답하고, 무엇보다 우리가 진짜 알고 싶은 것(그 엔진이 등록됐는가)을 바로 알려준다.
  ``/sync/{engine}/pull`` 을 두드린다 — 있으면 659, 없으면 602 다 (아래 상수 참고).
- ``synctriggers`` 는 REST 가 있을 때만 통한다. 없어도 sync-triggers 잡이 다음 주기에
  반영하므로 **늦을 뿐 틀리지 않는다** — 그래서 실패를 경고로 낮춘다.
  (엔진 properties 의 ``job.synctriggers.period.time.ms`` 가 그 주기다.)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode

import urllib3

from ..config import get_settings

logger = logging.getLogger(__name__)

#: 엔진이 없을 때 동기화 서블릿이 내는 코드. **실측으로 확인했다** (3.15.22, 2026-08-18):
#:
#:   602 "..."                       — engines/ 에 .properties 가 **하나도** 없을 때
#:   603 "No matching URI handler"   — 다른 엔진은 있는데 그 이름이 없을 때
#:   659 "Missing node ID or security token" — 엔진이 **있다** (파라미터만 없는 것)
#:
#: 그래서 "없음"은 602·603 둘 다이고, 그 밖의 코드는 전부 "있음"이다. 처음에 602 만
#: 보고 판정했더니 이름이 틀린 경우(603)를 '있음'으로 읽었다 — 그러면 동기화를 켜도
#: 아무 데이터도 오지 않는데 점검은 통과한다.
ENGINE_MISSING_CODES = frozenset({602, 603})

#: 두드릴 하위 경로. **하위 경로 없이 `/sync/{engine}` 만 부르면 안 된다** — 엔진이 살아
#: 있는데도 602 가 나온다(엔진 수에 따라 답이 달라진다). `pull` 은 읽기 전용이고 노드 id 를
#: 요구하므로, 엔진이 있으면 659("Missing node ID or security token")로 확실히 답한다.
#: registration 은 쓰면 안 된다 — 실제 등록을 시도하는 부작용이 있다.
PROBE_PATH = "pull"


class SymmetricUnavailableError(RuntimeError):
    """사이드카에 닿지 못했거나 거절당했다.

    ``DependencyError`` 로 올리지 않는 것은 의도다 — 호출부가 이것을 **잡아서 경고로
    낮추게** 하려는 것이다. 예외 종류로 "치명적이지 않음"을 표현한다.
    """


@dataclass
class SymmetricClient:
    """SymmetricDS REST 래퍼. 테스트는 ``http`` 에 가짜 transport 를 주입한다."""

    base_url: str
    timeout: int = 30
    http: Any = field(default=None)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if self.http is None:
            self.http = urllib3.PoolManager(
                retries=False, timeout=urllib3.Timeout(connect=5, read=self.timeout)
            )

    def _request(
        self, method: str, path: str, params: dict[str, Any] | None = None
    ) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        if params:
            url = f"{url}?{urlencode(params)}"
        try:
            resp = self.http.request(method, url, headers={"Accept": "application/json"})
        except urllib3.exceptions.HTTPError as exc:
            raise SymmetricUnavailableError(
                f"SymmetricDS 에 연결할 수 없습니다 ({self.base_url}): {exc}"
            ) from exc

        payload: Any = None
        if getattr(resp, "data", None):
            try:
                payload = json.loads(resp.data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                payload = {"message": resp.data[:500].decode("utf-8", "replace")}
        return resp.status, payload

    def _ok(self, status: int, payload: Any, action: str) -> Any:
        if status >= 400:
            detail = ""
            if isinstance(payload, dict):
                detail = str(payload.get("message") or payload.get("error") or payload)
            raise SymmetricUnavailableError(f"SymmetricDS {action} 실패 ({status}): {detail}")
        return payload

    # ------------------------------------------------------------- 조회

    def probe_engine(self, engine: str) -> bool:
        """이 엔진이 사이드카에 등록되어 있는가.

        REST 가 아니라 동기화 서블릿을 두드린다 — 공식 이미지에 REST 모듈이 없기 때문이고,
        무엇보다 **데이터가 실제로 오갈 통로**를 확인하는 편이 맞기 때문이다.
        닿지 못하면 예외, 서버는 떴는데 엔진이 없으면 ``False``.
        """
        status, _ = self._request("GET", f"/sync/{quote(engine)}/{PROBE_PATH}")
        return status not in ENGINE_MISSING_CODES

    # ------------------------------------------------------------- 제어

    def sync_triggers(self, engine: str, *, force: bool = False) -> None:
        """SYM_TRIGGER 변경을 원본 테이블의 실제 트리거에 즉시 반영한다.

        이 클라이언트를 두는 유일한 이유다. 부르지 않아도 sync-triggers 잡이 다음 주기에
        반영하므로, 실패는 지연일 뿐 오류가 아니다 — 호출부가 경고로 낮춘다.
        """
        status, payload = self._request(
            "POST", f"/api/engine/{quote(engine)}/synctriggers", {"force": str(force).lower()}
        )
        self._ok(status, payload, f"트리거 반영({engine})")


_client: SymmetricClient | None = None


def get_symmetric_client() -> SymmetricClient:
    """프로세스 공용 클라이언트. 테스트는 이 함수를 monkeypatch 한다 (get_debezium_client 패턴)."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = SymmetricClient(
            settings.symmetric_url, timeout=settings.symmetric_timeout_seconds
        )
    return _client


def reset_client() -> None:
    """설정이 바뀐 테스트에서 캐시된 클라이언트를 버린다."""
    global _client
    _client = None
