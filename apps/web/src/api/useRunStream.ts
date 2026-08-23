import { useEffect, useRef, useState } from 'react'
import { runStreamUrl } from './client'
import { nodeStateSchema, runEventSchema, type NodeState } from './types'

export type StreamLog = { id: string; level: string; message: string; nodeId: string | null; ts: string }

export type RunStream = {
  status: string
  progress: number
  records: number
  error: string | null
  nodeStates: Record<string, NodeState>
  logs: StreamLog[]
  connected: boolean
}

const TERMINAL = new Set(['success', 'failed', 'cancelled'])
const MAX_LOGS = 300

const EMPTY: RunStream = {
  status: 'pending',
  progress: 0,
  records: 0,
  error: null,
  nodeStates: {},
  logs: [],
  connected: false,
}

/**
 * 실행 상태를 WebSocket 으로 구독한다 (설계 문서 §8).
 * 서버가 주기적으로 보내는 snapshot 이 진실이고, 개별 이벤트는 그 사이를 메운다.
 */
export function useRunStream(runId: string | null): RunStream {
  const [state, setState] = useState<RunStream>(EMPTY)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!runId) {
      setState(EMPTY)
      return
    }
    setState({ ...EMPTY, logs: [] })

    let closed = false
    const socket = new WebSocket(runStreamUrl(runId))
    socketRef.current = socket

    socket.onopen = () => setState((s) => ({ ...s, connected: true }))
    socket.onclose = () => setState((s) => ({ ...s, connected: false }))
    socket.onerror = () => setState((s) => ({ ...s, connected: false }))

    socket.onmessage = (event) => {
      if (closed) return
      let raw: unknown
      try {
        raw = JSON.parse(event.data as string)
      } catch {
        return
      }
      const parsedEvent = runEventSchema.safeParse(raw)
      if (!parsedEvent.success) return
      const { type, payload, ts } = parsedEvent.data

      setState((prev) => {
        switch (type) {
          case 'snapshot':
            return {
              ...prev,
              status: String(payload.status ?? prev.status),
              progress: Number(payload.progress ?? prev.progress),
              records: Number(payload.records ?? prev.records),
              error: (payload.error as string | null) ?? null,
              nodeStates: parseNodeStates(payload.node_states) ?? prev.nodeStates,
            }
          case 'status':
            return {
              ...prev,
              status: String(payload.status ?? prev.status),
              records: Number(payload.records ?? prev.records),
              progress: Number(payload.progress ?? prev.progress),
              error: (payload.error as string | undefined) ?? prev.error,
            }
          case 'node': {
            const nodeId = String(payload.node_id ?? '')
            if (!nodeId) return prev
            const parsedNode = nodeStateSchema.safeParse(payload)
            if (!parsedNode.success) return prev
            return { ...prev, nodeStates: { ...prev.nodeStates, [nodeId]: parsedNode.data } }
          }
          case 'progress': {
            const nodeId = String(payload.node_id ?? '')
            if (!nodeId) return prev
            const existing = prev.nodeStates[nodeId]
            if (!existing) return prev
            return {
              ...prev,
              nodeStates: {
                ...prev.nodeStates,
                [nodeId]: { ...existing, records: Number(payload.records ?? existing.records) },
              },
            }
          }
          case 'log': {
            const entry: StreamLog = {
              id: `${ts ?? ''}-${prev.logs.length}`,
              level: String(payload.level ?? 'info'),
              message: String(payload.message ?? ''),
              nodeId: (payload.node_id as string | null) ?? null,
              ts: ts ?? new Date().toISOString(),
            }
            // 오래된 로그부터 버려 메모리를 상수로 유지한다
            const logs = [...prev.logs, entry].slice(-MAX_LOGS)
            return { ...prev, logs }
          }
          default:
            return prev
        }
      })
    }

    return () => {
      closed = true
      socketRef.current = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [runId])

  return state
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status)
}

function parseNodeStates(raw: unknown): Record<string, NodeState> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const out: Record<string, NodeState> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = nodeStateSchema.safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }
  return out
}
