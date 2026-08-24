import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { Tag } from './common'
import { RunHistory } from './RunHistory'
import { specFor } from '../api/connectorFields'
import {
  flattenFolders,
  placedPipelineIds,
  type SavedFolder,
  type SavedQuery,
} from '../api/savedStore'
import type { Connection, PipelineSummary } from '../api/types'

/** 트리에서 같은 이름의 쿼리를 찾아 메모를 돌려준다 (재저장 시 메모 프리필용). */
function findQueryNote(folders: SavedFolder[], name: string): string {
  for (const f of folders) {
    const q = f.queries.find((x) => x.name === name)
    if (q?.note) return q.note
    const sub = findQueryNote(f.folders, name)
    if (sub) return sub
  }
  return ''
}

/** 끌 수 있는 것 네 가지. `pipeline` 은 폴더에 담긴 항목(트리 항목 id),
 *  `loose` 는 아직 어느 폴더에도 없는 「미분류」 파이프라인(파이프라인 id)이다 —
 *  빼는 것과 담는 것은 하는 일이 반대라 같은 종류로 묶을 수 없다. */
type DragKind = 'query' | 'folder' | 'pipeline' | 'loose'

type PanelHandlers = {
  onOpen: (q: SavedQuery) => void
  onDeleteQuery: (queryId: string) => void
  onRenameQuery: (queryId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onNewFolder: (parentId: string | null, name: string) => void
  onNewQuery: (folderId: string, name: string) => void
  onMoveQuery: (queryId: string, targetFolderId: string) => void
  onMoveFolder: (folderId: string, targetParentId: string | null) => void
  /** 파이프라인을 서버에 새로 만들고 이 폴더에 놓는다 (그리고 탭으로 연다). */
  onNewPipeline: (folderId: string, name: string) => void
  onOpenPipeline: (p: PipelineSummary) => void
  onOpenRun: (p: PipelineSummary, runId: string) => void
  /** 트리에서만 뺀다 — 서버의 파이프라인은 남는다. */
  onRemovePipeline: (itemId: string) => void
  onMovePipeline: (itemId: string, targetFolderId: string) => void
  /** 아직 어느 폴더에도 없는 파이프라인을 폴더에 담는다. */
  onPlacePipeline: (pipelineId: string, targetFolderId: string) => void
}

/** 저장됨 탭 본문 — 폴더 트리(폴더 안에 폴더) 하나로 **쿼리와 파이프라인을 함께** 보여준다.
 *
 *  같은 업무를 쿼리로도 파이프라인으로도 다루는 일이 흔해서 트리를 나누지 않았다.
 *  담기는 것은 다르다 — 쿼리는 본문이 여기 있고, 파이프라인은 **서버에 있는 것을 가리킨다.**
 *  그래서 어느 폴더에도 없는 파이프라인은 「미분류」로 항상 보인다. 캔버스에서 만든 것이
 *  트리에서 조용히 사라지면 "왜 안 보이지"부터 시작해야 한다. */
export function SavedQueriesPanel({
  folders,
  connections,
  pipelines,
  ...h
}: {
  folders: SavedFolder[]
  connections: Connection[]
  pipelines: PipelineSummary[]
} & PanelHandlers) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ folderId?: string; queryId?: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  // 새 폴더 추가: parentId 가 null 이면 최상위, 문자열이면 그 폴더의 하위
  const [addParent, setAddParent] = useState<string | null | undefined>(undefined)
  const [addName, setAddName] = useState('')
  // 드래그앤드롭 이동
  const [drag, setDrag] = useState<{
    kind: DragKind
    label: string
    x: number
    y: number
  } | null>(null)
  const [dropTo, setDropTo] = useState<string | null>(null) // 'root' | folderId | null
  const dropRef = useRef<string | null>(null)
  const suppressClick = useRef(false)
  // 메모 즉시 툴팁 (native title 은 느려서 직접 띄운다)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  // 저장 항목 검색 — 쿼리 이름·메모·본문, 파이프라인 이름, 폴더 이름으로 필터
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  // 실행 이력 펼침 (파이프라인 행)
  const [histOpen, setHistOpen] = useState<Record<string, boolean>>({})

  const pipelineById = new Map(pipelines.map((p) => [p.id, p]))
  const placed = placedPipelineIds(folders)
  const loose = pipelines.filter((p) => !placed.has(p.id))
  const pipelineHit = (p: PipelineSummary) =>
    !term || p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term)

  // 포인터 아래의 드롭 대상 폴더(또는 'root'). 폴더만 root 로 갈 수 있다 —
  // 쿼리는 본문이 폴더에 담기고, 파이프라인은 폴더에서 빼면 「미분류」가 제자리다.
  const dropAt = (x: number, y: number, kind: DragKind, dragId: string): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const fid = el.getAttribute('data-drop-folder')
      if (fid) {
        if (kind === 'folder' && fid === dragId) continue // 자기 자신 위는 무시
        return fid
      }
      // root 로 갈 수 있는 것은 폴더(최상위로)와 폴더에 담긴 파이프라인(=미분류로 빼기)뿐이다.
      if (el.hasAttribute('data-drop-root'))
        return kind === 'folder' || kind === 'pipeline' ? 'root' : null
    }
    return null
  }

  const startDrag = (e: React.PointerEvent, kind: DragKind, id: string, label: string) => {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return
        started = true
        document.body.style.userSelect = 'none'
      }
      const t = dropAt(ev.clientX, ev.clientY, kind, id)
      dropRef.current = t
      setDropTo(t)
      setDrag({ kind, label, x: ev.clientX, y: ev.clientY })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      if (started) {
        suppressClick.current = true // 드래그였으면 뒤따르는 클릭(열기/토글)을 막는다
        const t = dropRef.current
        if (t) {
          if (kind === 'query') h.onMoveQuery(id, t)
          else if (kind === 'pipeline') {
            if (t === 'root') h.onRemovePipeline(id) // 폴더 밖 = 미분류
            else h.onMovePipeline(id, t)
          } else if (kind === 'loose') h.onPlacePipeline(id, t)
          else h.onMoveFolder(id, t === 'root' ? null : t)
        }
      }
      setDrag(null)
      setDropTo(null)
      dropRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const guardClick = (fn: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    fn()
  }
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation() // 액션 버튼은 드래그 시작 안 함

  const startEdit = (target: { folderId?: string; queryId?: string }, current: string) => {
    setEditing(target)
    setEditValue(current)
  }
  const commitEdit = () => {
    if (!editing) return
    const name = editValue.trim()
    if (name) {
      if (editing.queryId) h.onRenameQuery(editing.queryId, name)
      else if (editing.folderId) h.onRenameFolder(editing.folderId, name)
    }
    setEditing(null)
  }
  const editKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(null)
  }
  const submitAdd = (kind: 'folder' | 'query' | 'pipeline') => {
    const name = addName.trim()
    if (name) {
      // 쿼리·파이프라인은 반드시 폴더 안에 있어야 한다 — 최상위(addParent=null)에선 폴더만 만든다.
      if (kind === 'query' && addParent) h.onNewQuery(addParent, name)
      else if (kind === 'pipeline' && addParent) h.onNewPipeline(addParent, name)
      else h.onNewFolder(addParent ?? null, name)
    }
    setAddParent(undefined)
    setAddName('')
  }
  const cancelAdd = () => {
    setAddParent(undefined)
    setAddName('')
  }
  const addBox = (parentId: string | null) =>
    addParent === parentId ? (
      <div className="sq-addfolder">
        <input
          autoFocus
          value={addName}
          placeholder={parentId === null ? '폴더 이름…' : '이름…'}
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd('folder')
            if (e.key === 'Escape') cancelAdd()
          }}
        />
        <button className="btn sm primary" onClick={() => submitAdd('folder')} title="폴더 만들기">
          <Icon.stack />
          폴더
        </button>
        {parentId !== null && (
          <>
            <button className="btn sm" onClick={() => submitAdd('query')} title="쿼리 파일 만들기">
              <Icon.code />
              쿼리
            </button>
            <button
              className="btn sm"
              onClick={() => submitAdd('pipeline')}
              title="파이프라인을 새로 만들고 이 폴더에 놓습니다 (탭으로 열립니다)"
            >
              <Icon.flow />
              파이프라인
            </button>
          </>
        )}
        <button className="sq-add-x" onClick={cancelAdd} title="취소 (Esc)" aria-label="취소">
          ×
        </button>
      </div>
    ) : null

  // 검색어로 트리를 걸러낸다. 폴더 이름이 맞으면 그 폴더 내용을 통째로 남기고,
  // 아니면 이름·메모가 맞는 쿼리와 매칭되는 하위 폴더만 남긴다. 빈 가지는 잘라낸다.
  const filterFolder = (f: SavedFolder): SavedFolder | null => {
    const nameHit = f.name.toLowerCase().includes(term)
    const subs = f.folders.map(filterFolder).filter((x): x is SavedFolder => x !== null)
    const queries = nameHit
      ? f.queries
      : f.queries.filter(
          (q) =>
            q.name.toLowerCase().includes(term) ||
            (q.note ?? '').toLowerCase().includes(term) ||
            // 본문(SQL·명령문)도 검색 — 테이블명 등 쿼리 안에 든 내용으로 찾을 수 있게
            q.text.toLowerCase().includes(term),
        )
    const pipes = nameHit
      ? f.pipelines
      : f.pipelines.filter((r) => {
          const p = pipelineById.get(r.pipelineId)
          return p ? pipelineHit(p) : false
        })
    if (!nameHit && queries.length === 0 && pipes.length === 0 && subs.length === 0) return null
    return { ...f, folders: subs, queries, pipelines: pipes }
  }
  const shownFolders = term
    ? folders.map(filterFolder).filter((x): x is SavedFolder => x !== null)
    : folders
  const shownLoose = term ? loose.filter(pipelineHit) : loose

  /** 트리에 놓인 파이프라인 한 줄. `itemId` 가 있으면 폴더 안(빼기·옮기기 가능),
   *  없으면 「미분류」 줄이다(담기만 가능). */
  const renderPipeline = (p: PipelineSummary, itemId: string | null, folderId: string | null) => {
    const histShown = histOpen[p.id] ?? false
    return (
      <div key={itemId ?? p.id} className="pl-item-wrap">
        <div
          className="sq-query pl-item"
          data-drop-folder={folderId ?? undefined}
          onPointerDown={(e) =>
            startDrag(e, itemId ? 'pipeline' : 'loose', itemId ?? p.id, p.name)
          }
          onClick={guardClick(() => h.onOpenPipeline(p))}
          title={p.description || p.name}
        >
          <button
            className={`pl-hist-caret ${histShown ? 'open' : ''}`}
            title="실행 이력 보기"
            aria-label="실행 이력 보기"
            onPointerDown={stopDrag}
            onClick={(e) => {
              e.stopPropagation()
              setHistOpen((x) => ({ ...x, [p.id]: !histShown }))
            }}
          >
            <Icon.chevron />
          </button>
          <span className="sq-mode pipeline" title="파이프라인">
            <Icon.flow />
          </span>
          <span className="sq-query-name">{p.name}</span>
          {p.schedule_enabled && p.schedule && (
            <span className="pl-sched" title={`스케줄: ${p.schedule}`}>
              <Icon.clock />
            </span>
          )}
          {p.last_run_status && <Tag status={p.last_run_status} />}
          {itemId && (
            <button
              className="sq-del"
              title="트리에서 빼기 (파이프라인 자체는 지워지지 않습니다)"
              onPointerDown={stopDrag}
              onClick={(e) => {
                e.stopPropagation()
                h.onRemovePipeline(itemId)
              }}
            >
              ×
            </button>
          )}
        </div>
        {histShown && <RunHistory pipeline={p} onOpenRun={h.onOpenRun} />}
      </div>
    )
  }

  const renderFolder = (f: SavedFolder) => {
    // 검색 중에는 매칭 경로를 보여주려고 항상 펼친다.
    const isOpen = term ? true : (open[f.id] ?? true)
    const editingFolder = editing?.folderId === f.id && !editing?.queryId
    return (
      <div key={f.id} className="sq-folder">
        <div className={`sq-folder-row ${dropTo === f.id ? 'drop-over' : ''}`} data-drop-folder={f.id}>
          {editingFolder ? (
            <input
              className="sq-rename"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={editKeys}
              onBlur={commitEdit}
            />
          ) : (
            <button
              className="sq-folder-toggle"
              onPointerDown={(e) => startDrag(e, 'folder', f.id, f.name)}
              onClick={guardClick(() => setOpen((o) => ({ ...o, [f.id]: !isOpen })))}
              onDoubleClick={() => startEdit({ folderId: f.id }, f.name)}
              title="드래그해서 다른 폴더로 이동"
            >
              <span className={`sq-caret ${isOpen ? 'open' : ''}`}>
                <Icon.chevron />
              </span>
              <Icon.stack />
              <span className="sq-folder-name">{f.name}</span>
              <span className="sq-count">
                {f.folders.length + f.queries.length + f.pipelines.length}
              </span>
            </button>
          )}
          <button
            className="sq-edit"
            title="폴더 / 쿼리 추가"
            onPointerDown={stopDrag}
            onClick={() => {
              setOpen((o) => ({ ...o, [f.id]: true }))
              setAddParent(f.id)
              setAddName('')
            }}
          >
            <Icon.plus />
          </button>
          <button
            className="sq-edit"
            title="폴더 이름 변경"
            onPointerDown={stopDrag}
            onClick={() => startEdit({ folderId: f.id }, f.name)}
          >
            <Icon.edit />
          </button>
          <button
            className="sq-del"
            title="폴더 삭제"
            onPointerDown={stopDrag}
            onClick={() => {
              if (confirm(`폴더 "${f.name}" 와 안의 내용을 모두 삭제할까요?`)) h.onDeleteFolder(f.id)
            }}
          >
            <Icon.trash />
          </button>
        </div>
        {isOpen && (
          <div className="sq-children">
            {addBox(f.id)}
            {f.folders.map((sub) => renderFolder(sub))}
            {f.queries.length === 0 &&
              f.pipelines.length === 0 &&
              f.folders.length === 0 &&
              addParent !== f.id && <div className="sq-folder-empty">비어 있음</div>}
            {f.pipelines.map((r) => {
              const p = pipelineById.get(r.pipelineId)
              // 서버에서 지워진 파이프라인의 흔적은 감추기만 한다 — 목록을 아직 못 받은
              // 순간에 트리를 고쳐 쓰면 남은 배치까지 날아간다.
              return p ? renderPipeline(p, r.id, f.id) : null
            })}
            {f.queries.map((q) => {
              const isEditing = editing?.queryId === q.id
              // 쿼리가 저장한 연결의 DB 타입 배지(PG/MG…). 연결을 못 찾으면 S/M 모드 배지로 폴백.
              const qConn = q.connId ? connections.find((c) => c.id === q.connId) : null
              const qSpec = qConn ? specFor(qConn.type) : null
              return (
                <div
                  key={q.id}
                  className="sq-query"
                  data-drop-folder={f.id}
                  onPointerDown={(e) => !isEditing && startDrag(e, 'query', q.id, q.name)}
                  onClick={guardClick(() => !isEditing && h.onOpen(q))}
                  title={isEditing ? undefined : q.text}
                >
                  {qSpec ? (
                    <span className="conn-abbr sq-conn-abbr" style={{ background: qSpec.color }}>
                      {qSpec.abbr}
                    </span>
                  ) : (
                    <span className={`sq-mode ${q.mode}`}>{q.mode === 'mongo' ? 'M' : 'S'}</span>
                  )}
                  {isEditing ? (
                    <input
                      className="sq-rename"
                      autoFocus
                      value={editValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={editKeys}
                      onBlur={commitEdit}
                    />
                  ) : (
                    <span
                      className="sq-query-name"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        startEdit({ queryId: q.id }, q.name)
                      }}
                    >
                      {q.name}
                    </span>
                  )}
                  {q.note && !isEditing && (
                    <span
                      className="sq-note-mark"
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setTip({ text: q.note ?? '', x: r.right + 8, y: r.top })
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      <Icon.note />
                    </span>
                  )}
                  <button
                    className="sq-edit"
                    title="이름 변경"
                    onPointerDown={stopDrag}
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit({ queryId: q.id }, q.name)
                    }}
                  >
                    <Icon.edit />
                  </button>
                  <button
                    className="sq-del"
                    title="삭제"
                    onPointerDown={stopDrag}
                    onClick={(e) => {
                      e.stopPropagation()
                      h.onDeleteQuery(q.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="sq-panel">
      <div className="sq-head">
        <span className="sq-title">쿼리 · 파이프라인</span>
        <button
          className="sq-newfolder"
          onClick={() => {
            setAddParent((p) => (p === null ? undefined : null))
            setAddName('')
          }}
          title="새 폴더"
        >
          <Icon.plus />
          폴더
        </button>
      </div>
      <div className="tree-search sq-search">
        <Icon.search />
        <input
          value={search}
          placeholder="쿼리 · 파이프라인 검색…"
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="tree-search-x" onClick={() => setSearch('')} aria-label="지우기">
            ×
          </button>
        )}
      </div>
      <div className={`sq-body ${dropTo === 'root' ? 'drop-root' : ''}`} data-drop-root>
        {addBox(null)}
        {folders.length === 0 && loose.length === 0 && addParent === undefined ? (
          <div className="sq-empty">
            저장된 항목이 없습니다.
            <br />
            <b>폴더</b> 를 만들고 그 안에서 <b>쿼리</b> · <b>파이프라인</b> 을 추가하세요.
          </div>
        ) : term && shownFolders.length === 0 && shownLoose.length === 0 ? (
          <div className="sq-empty">“{search.trim()}” 검색 결과가 없습니다.</div>
        ) : (
          <>
            {shownFolders.map((f) => renderFolder(f))}
            {shownLoose.length > 0 && (
              <div className="sq-folder pl-loose">
                <div className="sq-folder-row">
                  <span className="pl-loose-label">
                    <Icon.flow />
                    미분류 파이프라인
                    <span className="sq-count">{shownLoose.length}</span>
                  </span>
                </div>
                <div className="sq-children">
                  {shownLoose.map((p) => renderPipeline(p, null, null))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {tip &&
        createPortal(
          <div className="sq-tip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>,
          document.body,
        )}
      {drag &&
        createPortal(
          <div className="sq-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.kind === 'folder' ? (
              <Icon.stack />
            ) : drag.kind === 'query' ? (
              <Icon.code />
            ) : (
              <Icon.flow />
            )}
            {drag.label}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** 저장 대화상자 — 폴더 트리에서 저장 위치를 클릭해 고르고, 필요하면 새 폴더를 만든다. */
export function SaveQueryDialog({
  folders,
  defaultName,
  onCancel,
  onSave,
}: {
  folders: SavedFolder[]
  defaultName: string
  onCancel: () => void
  onSave: (
    target: { folderId: string } | { newFolder: string; parentId: string | null },
    name: string,
    note: string,
  ) => void
}) {
  const flat = flattenFolders(folders)
  const initial = flat.find((f) => f.queryNames.includes(defaultName))?.id ?? flat[0]?.id ?? null
  const [selected, setSelected] = useState<string | null>(initial) // 폴더 id, null = 최상위
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(folders.length === 0)
  const [newName, setNewName] = useState('')
  const [name, setName] = useState(defaultName)
  // 같은 이름의 기존 항목이 있으면 그 메모를 미리 채워 재저장 시 잃지 않게 한다.
  const [note, setNote] = useState(() => findQueryNote(folders, defaultName))

  const selInfo = flat.find((f) => f.id === selected)
  const canSave = name.trim() !== '' && (creating ? newName.trim() !== '' : selected != null)
  const conflict = !creating && name.trim() !== '' && !!selInfo?.queryNames.includes(name.trim())

  const save = () => {
    if (!canSave) return
    onSave(
      creating ? { newFolder: newName.trim(), parentId: selected } : { folderId: selected as string },
      name.trim(),
      note.trim(),
    )
  }

  const renderTree = (list: SavedFolder[], depth: number): React.ReactNode =>
    list.map((f) => {
      const isOpen = openMap[f.id] ?? true
      const hasKids = f.folders.length > 0
      return (
        <div key={f.id}>
          <div
            className={`sq-tree-row ${selected === f.id ? 'sel' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => setSelected(f.id)}
          >
            {hasKids ? (
              <button
                className={`sq-tree-caret ${isOpen ? 'open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenMap((o) => ({ ...o, [f.id]: !isOpen }))
                }}
              >
                <Icon.chevron />
              </button>
            ) : (
              <span className="sq-tree-caret ph" />
            )}
            <Icon.stack />
            <span className="sq-tree-name">{f.name}</span>
            {f.queries.length > 0 && <span className="sq-tree-count">{f.queries.length}</span>}
          </div>
          {hasKids && isOpen && renderTree(f.folders, depth + 1)}
        </div>
      )
    })

  return createPortal(
    <div className="overlay" onClick={onCancel}>
      <div className="modal sq-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>쿼리 저장</h3>
          <button className="x" onClick={onCancel} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="mb sq-dialog-body">
          <div className="sq-field">
            <div className="sq-field-head">
              <span>저장할 폴더</span>
              <button
                className={`sq-newfolder ${creating ? 'on' : ''}`}
                onClick={() => {
                  setCreating((c) => !c)
                  setNewName('')
                }}
              >
                <Icon.plus />
                새 폴더
              </button>
            </div>
            <div className="sq-tree">
              <div
                className={`sq-tree-row root ${selected === null ? 'sel' : ''}`}
                onClick={() => setSelected(null)}
              >
                <span className="sq-tree-caret ph" />
                <Icon.home />
                <span className="sq-tree-name">최상위</span>
              </div>
              {renderTree(folders, 0)}
            </div>
          </div>

          {creating && (
            <label className="sq-field">
              <span>{selInfo ? `"${selInfo.label}" 안에 새 폴더` : '최상위에 새 폴더'}</span>
              <input
                autoFocus
                value={newName}
                placeholder="폴더 이름…"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
          )}

          <label className="sq-field">
            <span>쿼리 이름</span>
            <input
              value={name}
              placeholder="예: 최근 알람 조회"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>

          <label className="sq-field">
            <span>메모 (선택)</span>
            <textarea
              className="sq-note"
              value={note}
              placeholder="이 쿼리에 대한 설명·주의사항 등"
              rows={2}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {conflict && (
            <div className="sq-conflict">
              <Icon.alert />
              같은 이름의 쿼리가 이미 있습니다 — 저장하면 <b>덮어씁니다</b>. 다른 이름으로 저장하려면 이름을
              바꾸세요.
            </div>
          )}
          {!creating && selected === null && (
            <div className="sq-pickhint">폴더를 고르거나 “새 폴더” 로 만들어 저장하세요.</div>
          )}
        </div>
        <div className="mf">
          <button className="btn" onClick={onCancel}>
            취소
          </button>
          <button className={`btn ${conflict ? 'danger' : 'primary'}`} onClick={save} disabled={!canSave}>
            <Icon.save />
            {conflict ? '덮어쓰기' : '저장'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
