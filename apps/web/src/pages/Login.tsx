import { useState } from 'react'
import { api } from '../api/client'
import { auth, tokenResponseSchema } from '../api/auth'
import { Banner, Spinner } from '../components/common'
import { setLocale, useLocale, useT } from '../i18n'
import { queryClient } from '../main'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const locale = useLocale()

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
      setError(e instanceof Error ? e.message : t('login.failed'))
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      {/* 레일(언어 버튼이 사는 자리)이 로그인 전에는 없다 — 여기서도 바꿀 수 있어야 한다 */}
      <button
        type="button"
        className="login-lang"
        title={t('common.langToggle')}
        onClick={() => {
          setLocale(locale === 'ko' ? 'en' : 'ko')
          // 서버가 만든 문구(오류 detail 등)도 새 언어로 다시 받는다 — App 의 언어 버튼과 같다
          void queryClient.invalidateQueries()
        }}
      >
        {locale === 'ko' ? 'EN' : '한'}
      </button>
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <img src="/logo.png" alt="ditter" />
        </div>
        <h1>ditter</h1>
        <p className="login-sub">{t('login.sub')}</p>

        {error && <Banner kind="error">{error}</Banner>}

        <div className="field">
          <label htmlFor="login-email">{t('login.email')}</label>
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
          <label htmlFor="login-password">{t('login.password')}</label>
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
            {t('login.submit')}
          </button>
        </div>

        <p className="login-hint">
          {t('login.hintNoAccount')}
          <br />
          {t('login.hintAdminBefore')}
          <code>python -m eai_api.cli create-admin</code>
          {t('login.hintAdminAfter')}
        </p>
      </form>
    </div>
  )
}
