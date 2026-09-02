import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { auth } from './api/auth'
import { useCreatePipeline } from './api/hooks'
import { Banner, Spinner } from './components/common'
import { Icon } from './components/icons'
import { switchLocale, useLocale, useT, type MsgKey } from './i18n'
import { queryClient } from './api/queryClient'
import { Canvas } from './pages/Canvas'
import { Connections } from './pages/Connections'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Monitor } from './pages/Monitor'
import { NotFound } from './pages/NotFound'
import { SqlEditorPage } from './pages/SqlEditor'

/** 경로 → 상단 머리글. **아래 `<Routes>` 와 짝이다 — 라우트를 더하면 여기도 더한다.**
 *
 *  **각 규칙은 짝이 되는 `<Route path>` 와 정확히 같은 모양**이어야 한다. 넓게 잡으면
 *  본문과 머리글이 갈리고, 그 어긋남은 언제나 한 방향으로 온다 — 본문은 404 인데
 *  머리글은 "여기 있다"고 말한다.
 *
 *  두 번 데였다. 처음엔 홈이 `/^\//` 라 **모든 경로에** 맞아 없는 주소에서도 머리글이
 *  「대시보드」였고(경로가 틀린 것이 아니라 홈이 깨진 것으로 보였다), 다음엔 접두 매칭이
 *  라우트보다 넓어 `/canvasx`·`/sql/foo`·`/monitor/1` 이 각 섹션 이름을 달고 나왔다.
 *  React Router 는 `path="/sql"` 을 `/sql` 하나로만 본다 — `/sql/foo` 는 `path="*"` 로
 *  떨어진다. 그래서 여기도 `$` 로 닫는다.
 *
 *  **끝의 `\/?` 는 장식이 아니다.** 라우터는 꼬리 슬래시를 무시해 `/sql/` 도 `path="/sql"`
 *  로 본다. 이것을 빼면 `/sql/` 에서 본문은 SQL 편집기인데 머리글만 「찾을 수 없음」이 되어,
 *  방금 없앤 거짓말이 방향만 뒤집혀 되살아난다.
 *
 *  `/canvas` 만 뒤에 한 칸을 허용하는 것은 `<Route path="/canvas/:pipelineId">` 가 있어서다.
 *  `[^/]+` 인 이유도 같다 — 라우트 파라미터는 한 칸이라 `/canvas/p1/x` 는 라우트가 없다.
 *
 *  마지막 `/^\//` 는 catch-all 이라 **반드시 맨 뒤**여야 한다.
 *
 *  슬래시를 겹쳐 친 주소(`//`·`/canvas//`)는 여기서 catch-all 로 떨어지지만 라우터는 홈·캔버스로
 *  본다 — 알고 남긴 어긋남이다. `pathname.replace(/\/{2,}/g, '/')` 로 눌러 맞추고 싶어지는데,
 *  그러면 라우터가 `*` 로 보내는 `/canvas//p1` 이 여기서만 「파이프라인 편집기」가 되어
 *  더 흔한 자리에서 새 거짓말이 생긴다. 정말로 없애려면 `matchRoutes` 로 라우트 표를 하나로
 *  합쳐야 하고, 그건 이 표의 문제가 아니라 구조의 문제다.
 */
const TITLES: { match: RegExp; title: MsgKey; crumb: MsgKey }[] = [
  { match: /^\/canvas(\/[^/]+)?\/?$/, title: 'nav.title.canvas', crumb: 'nav.crumb.canvas' },
  { match: /^\/sql\/?$/, title: 'nav.title.sql', crumb: 'nav.crumb.sql' },
  { match: /^\/monitor\/?$/, title: 'nav.title.monitor', crumb: 'nav.crumb.monitor' },
  { match: /^\/connections\/?$/, title: 'nav.title.connections', crumb: 'nav.crumb.connections' },
  { match: /^\/$/, title: 'nav.title.home', crumb: 'nav.crumb.home' },
  { match: /^\//, title: 'nav.title.notFound', crumb: 'nav.crumb.notFound' },
]

/** 그 경로의 머리글. 마지막 항목이 catch-all 이라 `find` 는 언제나 무언가를 돌려준다 —
 *  그래도 폴백을 두는 것은 위 목록을 손대다 catch-all 을 잃었을 때 화면이 죽지 않게 하려는 것이다. */
export function headingFor(pathname: string): (typeof TITLES)[number] {
  return TITLES.find((entry) => entry.match.test(pathname)) ?? TITLES[TITLES.length - 1]
}

export function App() {
  const location = useLocation()
  const [showNew, setShowNew] = useState(false)
  const [authed, setAuthed] = useState(auth.isAuthenticated)
  const t = useT()
  const locale = useLocale()
  const heading = headingFor(location.pathname)

  // 토큰이 만료돼 client 가 로그아웃시키면 즉시 로그인 화면으로 되돌린다
  useEffect(() => auth.subscribe(() => setAuthed(auth.isAuthenticated)), [])

  if (!authed) return <Login />

  const user = auth.user
  const initials = (user?.display_name || user?.email || 'U').slice(0, 2).toUpperCase()
  const canEdit = auth.can('editor')

  return (
    <div className="app">
      <div className="rail">
        <NavLink to="/" className="logo" title="ditter">
          <img src="/logo-dark.png" alt="ditter" />
        </NavLink>
        <div className="nav">
          <NavLink to="/" end>
            <Icon.home />
            {t('nav.home')}
          </NavLink>
          <NavLink to="/canvas">
            <Icon.flow />
            {t('nav.pipelines')}
          </NavLink>
          <NavLink to="/sql">
            <Icon.code />
            {t('nav.sql')}
          </NavLink>
          <NavLink to="/monitor">
            <Icon.chart />
            {t('nav.monitor')}
          </NavLink>
          <NavLink to="/connections">
            <Icon.stack />
            {t('nav.connections')}
          </NavLink>
        </div>
        <div className="spacer" />
        <div className="rail-sep" />
        <button
          className="lang-toggle"
          title={t('common.langToggle')}
          onClick={() => switchLocale(locale === 'ko' ? 'en' : 'ko', queryClient)}
        >
          {locale === 'ko' ? 'EN' : '한'}
        </button>
        <button
          className="avatar"
          title={t('common.logoutTitle', {
            who: `${user?.email ?? ''} (${user?.roles.join(', ') ?? ''})`,
          })}
          onClick={() => {
            if (confirm(t('common.logoutConfirm'))) {
              auth.logout()
              window.location.href = '/'
            }
          }}
        >
          {initials}
          <span className="status-dot" title={t('common.statusDot')} />
        </button>
      </div>

      <div className="main">
        <div className="topbar">
          <h1>{t(heading.title)}</h1>
          <span className="crumb">{t(heading.crumb)}</span>
          <div className="top-actions">
            <button className="btn" onClick={() => window.location.reload()}>
              <Icon.refresh />
              {t('common.refresh')}
            </button>
            {canEdit && (
              <button className="btn primary" onClick={() => setShowNew(true)}>
                <Icon.plus />
                {t('common.newPipeline')}
              </button>
            )}
          </div>
        </div>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/canvas" element={<Canvas />} />
          <Route path="/canvas/:pipelineId" element={<Canvas />} />
          <Route path="/sql" element={<SqlEditorPage />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/connections" element={<Connections />} />
          {/* 없는 경로. 이게 없으면 React Router 가 아무것도 렌더링하지 않아 본문만 빈다. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      {showNew && <NewPipelineModal onClose={() => setShowNew(false)} />}
    </div>
  )
}

function NewPipelineModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreatePipeline()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const t = useT()

  const submit = async () => {
    setError(null)
    try {
      const pipeline = await create.mutateAsync({ name, description })
      onClose()
      navigate(`/canvas/${pipeline.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.createFailed'))
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{t('common.newPipeline')}</h3>
          <button className="x" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className="mb">
          {error && (
            <div style={{ padding: '0 18px' }}>
              <Banner kind="error">{error}</Banner>
            </div>
          )}
          <div className="field">
            <label>{t('common.name')}</label>
            <input
              autoFocus
              value={name}
              placeholder={t('common.pipelineNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name) submit()
              }}
            />
          </div>
          <div className="field">
            <label>{t('common.descriptionOptional')}</label>
            <input
              value={description}
              placeholder={t('common.pipelineDescPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="mf">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!name || create.isPending} onClick={submit}>
            {create.isPending ? <Spinner /> : <Icon.plus />}
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
