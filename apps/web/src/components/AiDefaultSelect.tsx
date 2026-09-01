/** 쿼리 편집기 툴바의 **AI 기본 연결** 드롭다운 (「실행 계획」 옆).
 *
 *  이 탭의 AI 가 무엇으로 답할지를 여기서 정한다 — 어시스턴트·AI 수정·AI 튜닝·노트북 셀이
 *  모두 이 값에서 시작한다(`api/aiDefault`). 각 자리의 선택은 그 자리에서만 쓰는
 *  덮어쓰기이고 이 기본값을 바꾸지 않는다.
 *
 *  AI 연결이 하나도 없으면 **아무것도 그리지 않는다** — 고를 것이 없는 드롭다운은
 *  툴바 자리만 먹는다. 등록 안내는 AI 를 실제로 쓰려는 자리(패널·챗)가 이미 한다.
 */
import { useMemo } from 'react'
import { Icon } from './icons'
import { MiniSelect } from '../canvas/AiChatPane'
import { useConnections } from '../api/hooks'
import { setAiDefault, useAiConn } from '../api/aiDefault'
import { specFor } from '../api/connectorFields'
import { useT } from '../i18n'
import type { SelectOption } from './SearchSelect'

export function AiDefaultSelect() {
  const t = useT()
  const { data: conns = [] } = useConnections()
  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  const current = useAiConn(aiConns)

  if (aiConns.length === 0) return null

  const options: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))

  return (
    <div
      className="sql-ai-default"
      title={t('ai.defaultSelectTitle')}
    >
      <Icon.bolt />
      <MiniSelect
        value={current}
        options={options}
        onChange={setAiDefault}
        placeholder={t('ai.connPlaceholder')}
        up={false}
      />
    </div>
  )
}
