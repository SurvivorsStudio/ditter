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
 *  마지막 두 줄의 순서가 중요하다. 예전에는 홈이 `/^\//` 였는데 그것이 **모든 경로에**
 *  맞아서, 없는 주소로 가도 머리글이 「대시보드」로 남았다. 본문은 비어 있는데 화면은
 *  "홈에 있다"고 말하니, 경로가 틀린 것이 아니라 홈이 깨진 것으로 보였다.
 *  홈은 `/^\/$/` 로 **정확히 `/` 일 때만** 잡고, 나머지는 아래 catch-all 이 받는다.
 *
 *  나머지도 `(\/|$)` 로 경계를 둔다. 없으면 `/canvasx` 같은 오타가 `/^\/canvas/` 에 걸려
 *  **본문은 404 인데 머리글만 「파이프라인 편집기」** 가 된다 — 위와 똑같은 종류의 거짓말이다.
 */
const TITLES: { match: RegExp; title: MsgKey; crumb: MsgKey }[] = [
  { match: /^\/canvas(\/|$)/, title: 'nav.title.canvas', crumb: 'nav.crumb.canvas' },
  { match: /^\/sql(\/|$)/, title: 'nav.title.sql', crumb: 'nav.crumb.sql' },
  { match: /^\/monitor(\/|$)/, title: 'nav.title.monitor', crumb: 'nav.crumb.monitor' },
  { match: /^\/connections(\/|$)/, title: 'nav.title.connections', crumb: 'nav.crumb.connections' },
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
