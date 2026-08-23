import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

/** `accent` 는 목록에서 성격이 다른 항목을 구분한다 — 연결 하나가 아니라 '여러 연결'처럼. */
export type SelectOption = { value: string; label: string; hint?: string; accent?: boolean }

/** 검색 가능한 커스텀 드롭다운(콤보박스).
 *
 * 네이티브 <select> 는 옵션이 수백 개면 스크롤만 길고 검색이 안 된다. 이 컴포넌트는
 * 타이핑으로 필터하고, 목록을 body 로 포탈해 설정 패널의 overflow 에 잘리지 않게 띄운다.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '— 선택 —',
  disabled = false,
  loading = false,
  emptyText = '결과 없음',
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
    const below = window.innerHeight - r.bottom
    const above = below < 280 && r.top > below
    setPos({ left: r.left, top: above ? r.top : r.bottom, width: r.width, above })
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
          {loading ? '불러오는 중…' : (selected?.label ?? placeholder)}
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
                  placeholder="검색…"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKey}
                />
              </div>
              <div className="ss-list" ref={listRef}>
                {filtered.length === 0 && <div className="ss-empty">{emptyText}</div>}
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
                {query.trim() ? `${filtered.length} / ${options.length}` : `${options.length}개`}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
