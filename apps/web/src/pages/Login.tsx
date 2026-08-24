import { useState } from 'react'
import { api } from '../api/client'
import { auth, tokenResponseSchema } from '../api/auth'
import { Banner, Spinner } from '../components/common'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await api.parsed(tokenResponseSchema, '/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      auth.login(result.access_token, result.user)
      // 전체 상태를 초기화하려면 라우터 이동보다 재적재가 확실하다
      window.location.href = '/'
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인에 실패했습니다')
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <img src="/logo.png" alt="ditter" />
        </div>
        <h1>ditter</h1>
        <p className="login-sub">계속하려면 로그인하세요</p>

        {error && <Banner kind="error">{error}</Banner>}

        <div className="field">
          <label htmlFor="login-email">이메일</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">비밀번호</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="cfoot">
          <button className="btn primary" type="submit" disabled={busy || !email || !password}>
            {busy ? <Spinner /> : null}
            로그인
          </button>
        </div>

        <p className="login-hint">
          계정이 없다면 관리자에게 요청하세요.
          <br />
          초기 관리자는 서버에서 <code>python -m eai_api.cli create-admin</code> 로 만듭니다.
        </p>
      </form>
    </div>
  )
}
