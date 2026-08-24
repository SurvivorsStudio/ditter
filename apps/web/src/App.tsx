import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { auth } from './api/auth'
import { useCreatePipeline } from './api/hooks'
import { Banner, Spinner } from './components/common'
import { Icon } from './components/icons'
import { Canvas } from './pages/Canvas'
import { Connections } from './pages/Connections'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Monitor } from './pages/Monitor'
import { SqlEditorPage } from './pages/SqlEditor'

const TITLES: { match: RegExp; title: string; crumb: string }[] = [
  { match: /^\/canvas/, title: '파이프라인 편집기', crumb: '파이프라인' },
  { match: /^\/sql/, title: 'SQL 편집기', crumb: 'SQL' },
  { match: /^\/monitor/, title: '모니터링', crumb: '실행 이력' },
  { match: /^\/connections/, title: '연결 관리', crumb: '연결' },
  { match: /^\//, title: '대시보드', crumb: '홈' },
]

export function App() {
  const location = useLocation()
  const [showNew, setShowNew] = useState(false)
  const [authed, setAuthed] = useState(auth.isAuthenticated)
  const heading = TITLES.find((t) => t.match.test(location.pathname)) ?? TITLES[TITLES.length - 1]

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
            홈
          </NavLink>
          <NavLink to="/canvas">
            <Icon.flow />
            파이프라인
          </NavLink>
          <NavLink to="/sql">
            <Icon.code />
            SQL
          </NavLink>
          <NavLink to="/monitor">
            <Icon.chart />
            모니터링
          </NavLink>
          <NavLink to="/connections">
            <Icon.stack />
            연결
          </NavLink>
        </div>
        <div className="spacer" />
        <div className="rail-sep" />
        <button
          className="avatar"
          title={`${user?.email ?? ''} (${user?.roles.join(', ') ?? ''}) — 클릭하면 로그아웃`}
          onClick={() => {
            if (confirm('로그아웃할까요?')) {
              auth.logout()
              window.location.href = '/'
            }
          }}
        >
          {initials}
          <span className="status-dot" title="로컬 환경 · 연결됨" />
        </button>
      </div>

      <div className="main">
        <div className="topbar">
          <h1>{heading.title}</h1>
          <span className="crumb">{heading.crumb}</span>
          <div className="top-actions">
            <button className="btn" onClick={() => window.location.reload()}>
              <Icon.refresh />
              새로고침
            </button>
            {canEdit && (
              <button className="btn primary" onClick={() => setShowNew(true)}>
                <Icon.plus />새 파이프라인
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

  const submit = async () => {
    setError(null)
    try {
      const pipeline = await create.mutateAsync({ name, description })
      onClose()
      navigate(`/canvas/${pipeline.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '생성에 실패했습니다')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>새 파이프라인</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
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
            <label>이름</label>
            <input
              autoFocus
              value={name}
              placeholder="고객 마스터 → S3 (일배치)"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name) submit()
              }}
            />
          </div>
          <div className="field">
            <label>설명 (선택)</label>
            <input
              value={description}
              placeholder="MySQL.customers · 증분(updated_at)"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="mf">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!name || create.isPending} onClick={submit}>
            {create.isPending ? <Spinner /> : <Icon.plus />}
            만들기
          </button>
        </div>
      </div>
    </div>
  )
}
