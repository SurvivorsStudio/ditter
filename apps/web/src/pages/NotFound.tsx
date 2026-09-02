import { useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/common'
import { useT } from '../i18n'

/** 없는 경로 — `<Route path="*">` 가 잡는다.
 *
 *  이 화면이 없으면 React Router 는 **아무것도 렌더링하지 않는다**(오류도 던지지 않는다).
 *  껍데기(레일·상단바)만 남고 본문이 비어, 사용자에게는 경로가 틀린 것이 아니라
 *  **화면이 깨진 것**으로 보인다. 그래서 여기서 "무엇이 없는지"를 말한다.
 *
 *  주소를 그대로 보여주는 이유는 오타를 눈으로 찾게 하려는 것이다 — 대개 한 글자다.
 */
export function NotFound() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="view">
      <div className="pad">
        <EmptyState title={t('nav.notFound.title')}>
          <p>
            <code>{pathname}</code>
          </p>
          <p>{t('nav.notFound.body')}</p>
          {/* 링크가 아니라 버튼이다 — `.btn` 은 밑줄을 지우지 않아 앵커에 걸면 그것만 밑줄이
              그어진다. 같은 상황의 기존 화면(`Canvas.tsx` 의 「파이프라인을 찾을 수 없습니다」)과
              같은 모양으로 맞춘다. */}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
            {t('nav.notFound.goHome')}
          </button>
        </EmptyState>
      </div>
    </div>
  )
}
