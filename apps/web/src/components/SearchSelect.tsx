import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { useT } from '../i18n'

/** `accent` 는 목록에서 성격이 다른 항목을 구분한다 — 연결 하나가 아니라 '여러 연결'처럼. */
export type SelectOption = { value: string; label: string; hint?: string; accent?: boolean }

/** 검색 가능한 커스텀 드롭다운(콤보박스).
 *
 * 네이티브 <select> 는 옵션이 수백 개면 스크롤만 길고 검색이 안 된다. 이 컴포넌트는
 * 타이핑으로 필터하고, 목록을 body 로 포탈해 설정 패널의 overflow 에 잘리지 않게 띄운다.
 */
/** 패널이 트리거보다 좁아지지 않는 하한. 트리거 너비를 그대로 쓰면, 좁은 트리거
 *  (노트북 셀의 연결 알약처럼)에서 항목 이름이 전부 잘려 무엇을 고르는지 알 수 없다. */
const MIN_PANEL_WIDTH = 240
/** 화면 가장자리에서 띄울 여백. */
const EDGE_GAP = 8

/** 드롭다운 패널을 놓을 자리. 트리거의 사각형과 뷰포트만 보는 순수 함수다.
 *
 *  - 너비는 **트리거와 하한 중 큰 쪽** — 좁은 트리거에서 항목이 잘리지 않게.
 *  - 그래서 패널이 트리거보다 넓어질 수 있으므로 **오른쪽으로 넘치지 않게 가둔다.**
 *  - 아래 공간이 모자라고 위가 더 넓으면 위로 띄운다. */
export function panelPlacement(
  rect: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; above: boolean } {
  const width = Math.max(rect.width, MIN_PANEL_WIDTH)
  const below = viewport.height - rect.bottom
  const above = below < 280 && rect.top > below
  const maxLeft = viewport.width - width - EDGE_GAP
  const left = Math.max(EDGE_GAP, Math.min(rect.left, maxLeft))
  return { left, top: above ? rect.top : rect.bottom, width, above }
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  loading = false,
  emptyText,
  leading,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyText?: string
  /** 트리거의 라벨 앞에 놓을 요소 (연결 타입 배지 등). */
  leading?: React.ReactNode
}) {
  const tr = useT() // 지역 setTimeout 핸들 t 와의 충돌을 피한다
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(panelPlacement(r, { width: window.innerWidth, height: window.innerHeight }))
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScroll = () => place()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[active]
      if (opt) choose(opt.value)
    }
  }

  // 활성 항목이 보이도록 스크롤
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('.ss-opt.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ss-trigger ${open ? 'open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {leading && selected && <span className="ss-lead">{leading}</span>}
        <span className={selected ? 'ss-val' : 'ss-ph'}>
          {loading ? tr('runs.loading') : (selected?.label ?? placeholder ?? tr('navi.selectPlaceholder'))}
        </span>
        <Icon.chevron />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="ss-overlay" onClick={() => setOpen(false)} />
            <div
              className={`ss-panel ${pos.above ? 'above' : ''}`}
              style={{
                left: pos.left,
                width: pos.width,
                ...(pos.above ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              }}
            >
              <div className="ss-search">
                <Icon.search />
                <input
                  ref={inputRef}
                  value={query}
                  placeholder={tr('navi.search')}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKey}
                />
              </div>
              <div className="ss-list" ref={listRef}>
                {filtered.length === 0 && (
                  <div className="ss-empty">{emptyText ?? tr('navi.noResults')}</div>
                )}
                {filtered.map((o, i) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`ss-opt ${o.value === value ? 'sel' : ''} ${i === active ? 'active' : ''} ${o.accent ? 'accent' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                  >
                    <span className="ss-opt-label">{o.label}</span>
                    {o.hint && <span className="ss-opt-hint">{o.hint}</span>}
                    {o.value === value && <Icon.check />}
                  </button>
                ))}
              </div>
              <div className="ss-foot">
                {query.trim()
                  ? `${filtered.length} / ${options.length}`
                  : tr('navi.optionCount', { n: options.length })}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
