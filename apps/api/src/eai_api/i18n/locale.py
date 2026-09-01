"""표시 언어 — 이 **요청**의 응답을 어느 언어로 쓸지.

`ContextVar` 인 이유가 설계의 핵심이다.

서비스 계층(`services/*.py`)은 `Session` 만 받고 `Request` 를 모른다. 게다가
`schemas/dag.py` 는 워커(`eai_worker.tasks`)와 **공유**한다 — locale 을 인자로 흘리면
워커가 의미 없는 값을 계속 넘겨야 하고, 수십 개 시그니처가 그 뒷바라지를 하게 된다.
요청 스코프 변수는 그 배관을 통째로 없앤다.

**요청 밖에서는 기본값 ko 다.** 이게 실수가 아니라 안전장치다:

- 워커는 실행 시각에 쓰고 화면은 나중에 아무 때나 읽는다. `run_logs.message` ·
  `runs.error` 는 **영구 저장**이라 쓰는 시점 언어로 문자열째 굳는다. 기본 ko 덕분에
  저장되는 문자열이 지금과 **바이트 동일**하다.
- 그래서 **워커에서 `set_locale()` 을 부르면 안 된다.** 부르는 순간 en 사용자가 실행한
  파이프라인의 로그가 영어로 저장되고, 그걸 ko 사용자가 읽는다.
- 기존 테스트 160여 건이 한글을 단언하는데, 서비스를 직접 부르므로 전부 ko 를 본다.

전파는 실측으로 확인했다 (starlette 0.46.2 / anyio 4.14.2). `BaseHTTPMiddleware` 가
다운스트림을 `start_soon` 으로 띄울 때 컨텍스트가 복사되고, 동기 `def` 라우터를 도는
`run_in_threadpool` 도 `copy_context()` 후 `context.run()` 으로 실행한다 —
**동기 라우터·동기 Depends·예외 핸들러가 모두 같은 값을 본다.**

복사는 **단방향 스냅샷**이다. 다운스트림에서 `set_locale()` 한 값은 미들웨어로 돌아오지
않는다. 그래서 "라우터가 정하고 미들웨어가 읽는" 설계는 성립하지 않는다.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Literal

Locale = Literal["ko", "en"]

DEFAULT_LOCALE: Locale = "ko"

#: 이 요청의 표시 언어. 미들웨어가 요청마다 **무조건** 세팅한다 (아래 참조).
_locale: ContextVar[Locale] = ContextVar("eai_locale", default=DEFAULT_LOCALE)


def get_locale() -> Locale:
    return _locale.get()


def set_locale(locale: Locale) -> None:
    """요청 미들웨어 전용. **워커에서 부르지 말 것** — 위 docstring 참조."""
    _locale.set(locale)


def locale_from_header(value: str | None) -> Locale:
    """`Accept-Language` 를 읽는다. 첫 태그가 `en` 이면 en, 그 밖은 전부 ko.

    q-value 협상을 하지 않는 이유: 프론트가 화면 언어 한 값만 명시적으로 보낸다
    (`api/client.ts`). 협상할 것이 없는데 파서를 두면 그것이 틀릴 수 있는 자리가 된다.

    브라우저는 이 헤더를 **자동으로도** 붙인다. 그래서 프론트가 명시적으로 덮어쓰지
    않으면 영어 OS 를 쓰는 한국인이 UI 는 한국어인데 오류만 영어로 받게 된다 —
    `web/src/i18n/locale.ts` 가 `navigator.language` 를 일부러 보지 않는 것과 같은 이유다.
    """
    if not value:
        return DEFAULT_LOCALE
    first = value.split(",")[0].split(";")[0].strip().lower()
    return "en" if first == "en" or first.startswith("en-") else DEFAULT_LOCALE
