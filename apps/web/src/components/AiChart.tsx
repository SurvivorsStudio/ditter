/** AI 답변 안의 ```chart JSON 을 차트로 그린다 (recharts 재사용).
 *
 *  Notebook 의 대화형 ChartView 와 달리, 여기 입력은 사용자가 아니라 **AI 가 낸 스펙**이다.
 *  스펙 형식은 백엔드 프롬프트(ai_service._prompt_chart)와 한 쌍이다 — 한쪽만 바꾸면 어긋난다.
 *  형식: {"type":"bar|line|pie","title":"..","labels":["A","B"],"series":[{"name":"..","data":[1,2]}]}
 */
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { useT } from '../i18n'

export type ChartSpec = {
  type: 'bar' | 'line' | 'pie'
  title?: string
  labels: string[]
  series: { name?: string; data: number[] }[]
}

const COLORS = [
  '#6d28d9', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444',
  '#14b8a6', '#ec4899', '#8b5cf6', '#84cc16', '#f97316',
]

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 답변 텍스트에서 첫 ```chart 블록을 파싱한다. 없거나 형식이 안 맞으면 null. */
export function parseChart(content: string): { spec: ChartSpec; raw: string } | null {
  const m = content.match(/```chart\s*\n([\s\S]*?)```/i)
  if (!m) return null
  try {
    const spec = normalizeSpec(JSON.parse(m[1].trim()))
    return spec ? { spec, raw: m[0] } : null
  } catch {
    return null
  }
}

function normalizeSpec(obj: unknown): ChartSpec | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const type = o.type === 'line' || o.type === 'pie' ? o.type : 'bar'
  const labels = Array.isArray(o.labels) ? o.labels.map((x) => String(x)) : []
  if (labels.length === 0) return null
  let series: { name?: string; data: number[] }[] = []
  if (Array.isArray(o.series)) {
    series = o.series
      .map((s) => {
        const ss = (s ?? {}) as Record<string, unknown>
        return {
          name: ss.name != null ? String(ss.name) : undefined,
          data: Array.isArray(ss.data) ? ss.data.map(toNum) : [],
        }
      })
      .filter((s) => s.data.length > 0)
  } else if (Array.isArray(o.values)) {
    series = [{ data: o.values.map(toNum) }]
  }
  if (series.length === 0) return null
  return { type, title: o.title != null ? String(o.title) : undefined, labels, series }
}

type Datum = Record<string, string | number>

export function AiChart({ spec }: { spec: ChartSpec }) {
  const t = useT()
  const names = spec.series.map((s, i) => s.name || t('ai.seriesN', { n: i + 1 }))
  // recharts 데이터 형식으로: 각 범주(label) 한 행 + 계열별 값.
  const data: Datum[] = spec.labels.map((lb, i) => {
    const row: Datum = { x: lb }
    spec.series.forEach((s, si) => {
      row[names[si]] = s.data[i] ?? 0
    })
    return row
  })
  const axis = { fontSize: 11 }

  return (
    <div className="ai-chart">
      {spec.title && <div className="ai-chart-title">{spec.title}</div>}
      <div className="ai-chart-canvas">
        <ResponsiveContainer width="100%" height={300}>
          {spec.type === 'pie' ? (
            <PieChart>
              <Tooltip />
              <Legend />
              <Pie data={data} dataKey={names[0]} nameKey="x" cx="50%" cy="50%" outerRadius={100} innerRadius={46} label>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : spec.type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="x" tick={axis} interval="preserveStartEnd" />
              <YAxis tick={axis} />
              <Tooltip />
              {names.length > 1 && <Legend />}
              {names.map((nm, i) => (
                <Line key={nm} type="monotone" dataKey={nm} stroke={COLORS[i % COLORS.length]} dot={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="x" tick={axis} interval="preserveStartEnd" />
              <YAxis tick={axis} />
              <Tooltip />
              {names.length > 1 && <Legend />}
              {names.map((nm, i) => (
                <Bar key={nm} dataKey={nm} fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
