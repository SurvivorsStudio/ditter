import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { Tag } from './common'
import { RunHistory } from './RunHistory'
import { specFor } from '../api/connectorFields'
import {
  flattenFolders,
  placedPipelineIds,
  uniqueName,
  type SavedFolder,
  type SavedQuery,
} from '../api/savedStore'
import type { Connection, PipelineSummary } from '../api/types'
import { useT, type MsgKey } from '../i18n'
import { rich } from '../i18n/rich'

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

/** 트리에서 id 로 폴더를 찾는다 (재귀). 형제 이름을 모아 기본 이름을 지을 때 쓴다. */
function findFolder(folders: SavedFolder[], id: string): SavedFolder | null {
  for (const f of folders) {
    if (f.id === id) return f
    const sub = findFolder(f.folders, id)
    if (sub) return sub
  }
  return null
}

/** 새로 만들 때 입력줄에 **미리 채워 두는** 이름 — 생성 시점에 t() 로 풀어 데이터가 된다. */
const ADD_DEFAULT_NAME = {
  folder: 'saved.newFolderName',
  query: 'saved.newQueryName',
  pipeline: 'common.newPipeline',
} as const satisfies Record<string, MsgKey>
type AddKind = keyof typeof ADD_DEFAULT_NAME

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
  openTitles = [],
  ...h
}: {
  folders: SavedFolder[]
  connections: Connection[]
  pipelines: PipelineSummary[]
  /** 지금 떠 있는 탭 이름들. 기본 이름이 그것들과 겹치지 않게 하려고 받는다 —
   *  쿼리·파이프라인은 만들자마자 탭으로 열리는데, 같은 이름의 탭이 둘이면
   *  방금 무엇이 생겼는지 알 수 없다. */
  openTitles?: string[]
} & PanelHandlers) {
  const tr = useT()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ folderId?: string; queryId?: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  // 새 폴더 추가: parentId 가 null 이면 최상위, 문자열이면 그 폴더의 하위
  const [addParent, setAddParent] = useState<string | null | undefined>(undefined)
  // 입력줄은 **기본 이름이 채워진 채로** 열린다 (빈 칸이 아니다 — 아래 openAdd 주석).
  const [addName, setAddName] = useState('')
  // 사용자가 직접 고친 이름인지. 안 고쳤으면 누르는 버튼의 종류를 따라간다.
  const [addTouched, setAddTouched] = useState(false)
  const addInput = useRef<HTMLInputElement | null>(null)
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
  /** 이름을 안 적었을 때 붙일 이름.
   *
   *  겹침을 피하는 대상이 둘이다: 같은 자리의 **형제**(트리에서 구별해야 한다)와
   *  지금 떠 있는 **탭 이름**(쿼리·파이프라인은 만들자마자 탭으로 열린다).
   *  폴더는 탭이 되지 않으므로 형제 폴더 이름만 본다. */
  const defaultAddName = (kind: AddKind, parentId: string | null) => {
    const parent = parentId ? findFolder(folders, parentId) : null
    const taken =
      kind === 'folder'
        ? (parent?.folders ?? folders).map((f) => f.name)
        : kind === 'query'
          ? [...(parent?.queries ?? []).map((q) => q.name), ...openTitles]
          : [...pipelines.map((p) => p.name), ...openTitles]
    return uniqueName(tr(ADD_DEFAULT_NAME[kind]), taken)
  }

  /** 입력줄을 연다 — **기본 이름을 채운 채로.**
   *
   *  전에는 빈 칸으로 열렸고, 이름 없이 만들면 아무것도 생기지 않고 줄만 닫혔다.
   *  이름을 지어 주기만 해도 만들어지기는 하지만, 그러면 **무엇이 생겼는지 누르기
   *  전에는 알 수 없다** — 만들자마자 탭이 열리는데 그 탭 이름을 방금 처음 본다.
   *  그래서 만들어질 이름을 미리 보여주고, 그대로 두면 그 이름이 된다.
   *
   *  기본은 [폴더] 다 — 그것이 주 버튼이고 Enter 가 하는 일이다. 다른 종류를
   *  가리키면(hover·포커스) 그 종류의 이름으로 바뀐다. */
  const openAdd = (parentId: string | null) => {
    setAddParent(parentId)
    setAddName(defaultAddName('folder', parentId))
    setAddTouched(false)
  }
  /** 손대지 않은 이름은 가리키는 버튼의 종류를 따라간다 — 보이는 이름과 만들어질
   *  이름이 갈리면 미리 보여 주는 의미가 없다. */
  const previewAdd = (kind: AddKind) => {
    if (!addTouched && addParent !== undefined) setAddName(defaultAddName(kind, addParent))
  }
  const closeAdd = () => {
    setAddParent(undefined)
    setAddName('')
    setAddTouched(false)
  }
  const submitAdd = (kind: AddKind) => {
    // 쿼리·파이프라인은 반드시 폴더 안에 있어야 한다 — 최상위(addParent=null)에선 폴더만 만든다.
    const real: AddKind = kind !== 'folder' && !addParent ? 'folder' : kind
    // 비워 두고 눌러도 만들어진다. 이름을 손대지 않았으면 **누른 종류**의 기본 이름이다
    // (hover 없이 곧장 누르는 길 — 터치·키보드 — 에서도 화면과 결과가 같아야 한다).
    const typed = addTouched ? addName.trim() : ''
    const name = typed || defaultAddName(real, addParent ?? null)
    if (real === 'query' && addParent) h.onNewQuery(addParent, name)
    else if (real === 'pipeline' && addParent) h.onNewPipeline(addParent, name)
    else h.onNewFolder(addParent ?? null, name)
    closeAdd()
  }
  const cancelAdd = closeAdd
  // 열릴 때 채워 둔 이름을 통째로 선택해 둔다 — 그대로 두면 그 이름이고,
  // 바로 타이핑하면 덮인다. (지울 것이 없어야 고치기 쉽다.)
  useEffect(() => {
    if (addParent !== undefined) addInput.current?.select()
  }, [addParent])
  /** 종류 버튼 — 가리키기만 해도 입력줄의 이름이 그 종류로 바뀐다.
   *
   *  **벗어나면 되돌린다.** 되돌리지 않으면 입력줄은 「새 파이프라인」인데 그 자리에서
   *  Enter 를 누르면 폴더가 생긴다 — 이름은 `submitAdd` 가 다시 계산해 맞지만 **종류가
   *  갈린다.** 미리보기의 기본은 Enter 가 하는 일(=[폴더])이어야 화면과 결과가 어긋나지
   *  않는다. 버튼 사이를 지나갈 때는 leave 다음에 enter 가 와서 새 종류가 이긴다. */
  const addKindButton = (kind: AddKind, label: string, icon: React.ReactNode, title: string) => (
    <button
      className={`btn sm ${kind === 'folder' ? 'primary' : ''}`}
      onClick={() => submitAdd(kind)}
      onPointerEnter={() => previewAdd(kind)}
      onPointerLeave={() => previewAdd('folder')}
      onFocus={() => previewAdd(kind)}
      onBlur={() => previewAdd('folder')}
      title={title}
    >
      {icon}
      {label}
    </button>
  )
  const addBox = (parentId: string | null) =>
    addParent === parentId ? (
      <div className="sq-addfolder">
        <input
          ref={addInput}
          autoFocus
          value={addName}
          placeholder={parentId === null ? tr('saved.folderNamePh') : tr('saved.namePh')}
          onChange={(e) => {
            setAddName(e.target.value)
            setAddTouched(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd('folder')
            if (e.key === 'Escape') cancelAdd()
          }}
        />
        {addKindButton('folder', tr('saved.kindFolder'), <Icon.stack />, tr('saved.makeFolderTip'))}
        {parentId !== null && (
          <>
            {addKindButton('query', tr('saved.kindQuery'), <Icon.code />, tr('saved.makeQueryTip'))}
            {addKindButton(
              'pipeline',
              tr('saved.kindPipeline'),
              <Icon.flow />,
              tr('saved.makePipelineTip'),
            )}
          </>
        )}
        <button
          className="sq-add-x"
          onClick={cancelAdd}
          title={tr('saved.cancelEsc')}
          aria-label={tr('common.cancel')}
        >
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
            title={tr('saved.showRunHistory')}
            aria-label={tr('saved.showRunHistory')}
            onPointerDown={stopDrag}
            onClick={(e) => {
              e.stopPropagation()
              setHistOpen((x) => ({ ...x, [p.id]: !histShown }))
            }}
          >
            <Icon.chevron />
          </button>
          <span className="sq-mode pipeline" title={tr('saved.kindPipeline')}>
            <Icon.flow />
          </span>
          <span className="sq-query-name">{p.name}</span>
          {p.schedule_enabled && p.schedule && (
            <span className="pl-sched" title={tr('saved.scheduleTip', { schedule: p.schedule })}>
              <Icon.clock />
            </span>
          )}
          {p.last_run_status && <Tag status={p.last_run_status} />}
          {itemId && (
            <button
              className="sq-del"
              title={tr('saved.removeFromTree')}
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
              title={tr('saved.dragToMove')}
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
            title={tr('saved.addChildTip')}
            onPointerDown={stopDrag}
            onClick={() => {
              setOpen((o) => ({ ...o, [f.id]: true }))
              openAdd(f.id)
            }}
          >
            <Icon.plus />
          </button>
          <button
            className="sq-edit"
            title={tr('saved.renameFolderTip')}
            onPointerDown={stopDrag}
            onClick={() => startEdit({ folderId: f.id }, f.name)}
          >
            <Icon.edit />
          </button>
          <button
            className="sq-del"
            title={tr('saved.deleteFolderTip')}
            onPointerDown={stopDrag}
            onClick={() => {
              if (confirm(tr('saved.deleteFolderConfirm', { name: f.name }))) h.onDeleteFolder(f.id)
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
              addParent !== f.id && <div className="sq-folder-empty">{tr('saved.emptyFolder')}</div>}
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
                    title={tr('saved.renameTip')}
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
                    title={tr('saved.delete')}
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
        <span className="sq-title">{tr('saved.panelTitle')}</span>
        <button
          className="sq-newfolder"
          onClick={() => (addParent === null ? closeAdd() : openAdd(null))}
          title={tr('saved.newFolderName')}
        >
          <Icon.plus />
          {tr('saved.kindFolder')}
        </button>
      </div>
      <div className="tree-search sq-search">
        <Icon.search />
        <input
          value={search}
          placeholder={tr('saved.searchPh')}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="tree-search-x" onClick={() => setSearch('')} aria-label={tr('saved.clear')}>
            ×
          </button>
        )}
      </div>
      <div className={`sq-body ${dropTo === 'root' ? 'drop-root' : ''}`} data-drop-root>
        {addBox(null)}
        {folders.length === 0 && loose.length === 0 && addParent === undefined ? (
          <div className="sq-empty">
            {tr('saved.emptyTitle')}
            <br />
            {rich(tr('saved.emptyBody'))}
          </div>
        ) : term && shownFolders.length === 0 && shownLoose.length === 0 ? (
          <div className="sq-empty">{tr('saved.noSearchResults', { term: search.trim() })}</div>
        ) : (
          <>
            {shownFolders.map((f) => renderFolder(f))}
            {shownLoose.length > 0 && (
              <div className="sq-folder pl-loose">
                <div className="sq-folder-row">
                  <span className="pl-loose-label">
                    <Icon.flow />
                    {tr('saved.loosePipelines')}
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
  const tr = useT()
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
          <h3>{tr('saved.saveDialogTitle')}</h3>
          <button className="x" onClick={onCancel} aria-label={tr('common.close')}>
            ×
          </button>
        </div>
        <div className="mb sq-dialog-body">
          <div className="sq-field">
            <div className="sq-field-head">
              <span>{tr('saved.saveFolderLabel')}</span>
              <button
                className={`sq-newfolder ${creating ? 'on' : ''}`}
                onClick={() => {
                  setCreating((c) => !c)
                  setNewName('')
                }}
              >
                <Icon.plus />
                {tr('saved.newFolderName')}
              </button>
            </div>
            <div className="sq-tree">
              <div
                className={`sq-tree-row root ${selected === null ? 'sel' : ''}`}
                onClick={() => setSelected(null)}
              >
                <span className="sq-tree-caret ph" />
                <Icon.home />
                <span className="sq-tree-name">{tr('saved.topLevel')}</span>
              </div>
              {renderTree(folders, 0)}
            </div>
          </div>

          {creating && (
            <label className="sq-field">
              <span>{selInfo ? tr('saved.newFolderIn', { name: selInfo.label }) : tr('saved.newFolderTop')}</span>
              <input
                autoFocus
                value={newName}
                placeholder={tr('saved.folderNamePh')}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
          )}

          <label className="sq-field">
            <span>{tr('saved.queryNameLabel')}</span>
            <input
              value={name}
              placeholder={tr('saved.queryNamePh')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>

          <label className="sq-field">
            <span>{tr('saved.noteLabel')}</span>
            <textarea
              className="sq-note"
              value={note}
              placeholder={tr('saved.notePh')}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {conflict && (
            <div className="sq-conflict">
              <Icon.alert />
              {rich(tr('saved.conflictWarn'))}
            </div>
          )}
          {!creating && selected === null && (
            <div className="sq-pickhint">{tr('saved.pickHint')}</div>
          )}
        </div>
        <div className="mf">
          <button className="btn" onClick={onCancel}>
            {tr('common.cancel')}
          </button>
          <button className={`btn ${conflict ? 'danger' : 'primary'}`} onClick={save} disabled={!canSave}>
            <Icon.save />
            {conflict ? tr('saved.overwrite') : tr('saved.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
