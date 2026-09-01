import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { auth } from './api/auth'
import { useCreatePipeline } from './api/hooks'
import { Banner, Spinner } from './components/common'
import { Icon } from './components/icons'
import { setLocale, useLocale, useT, type MsgKey } from './i18n'
import { queryClient } from './main'
import { Canvas } from './pages/Canvas'
import { Connections } from './pages/Connections'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Monitor } from './pages/Monitor'
import { SqlEditorPage } from './pages/SqlEditor'

const TITLES: { match: RegExp; title: MsgKey; crumb: MsgKey }[] = [
  { match: /^\/canvas/, title: 'nav.title.canvas', crumb: 'nav.crumb.canvas' },
  { match: /^\/sql/, title: 'nav.title.sql', crumb: 'nav.crumb.sql' },
  { match: /^\/monitor/, title: 'nav.title.monitor', crumb: 'nav.crumb.monitor' },
  { match: /^\/connections/, title: 'nav.title.connections', crumb: 'nav.crumb.connections' },
  { match: /^\//, title: 'nav.title.home', crumb: 'nav.crumb.home' },
]

/** 언어를 바꾸면 **서버가 만든 문구도 새 언어로 다시 받아야 한다.**
 *  검증 이슈(ValidationIssue.message)·착수 점검(PreflightCheck.label/detail)·오류 detail 은
 *  요청의 Accept-Language 로 정해져 캐시에 그 언어로 굳어 있다 — 화면만 바꾸면
 *  한국어 껍데기에 영어 속이 남는다. 그래서 전환 직후 캐시를 통째로 무효화한다. */
function switchLocale(next: 'ko' | 'en'): void {
  setLocale(next)
  void queryClient.invalidateQueries()
}

export function App() {
  const location = useLocation()
  const [showNew, setShowNew] = useState(false)
  const [authed, setAuthed] = useState(auth.isAuthenticated)
  const t = useT()
  const locale = useLocale()
  const heading =
    TITLES.find((entry) => entry.match.test(location.pathname)) ?? TITLES[TITLES.length - 1]

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
          onClick={() => switchLocale(locale === 'ko' ? 'en' : 'ko')}
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
