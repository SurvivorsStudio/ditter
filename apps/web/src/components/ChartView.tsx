import { useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter'
export type AggFn = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'
export type ChartConfig = { kind: ChartKind; x: string; ys: string[]; agg: AggFn }

type Row = Record<string, unknown>

const COLORS = [
  '#6d28d9', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444',
  '#14b8a6', '#ec4899', '#8b5cf6', '#84cc16', '#f97316',
]
const KIND_LABEL: Record<ChartKind, string> = {
  bar: '막대', line: '선', area: '영역', pie: '원', scatter: '산점도',
}
const AGG_LABEL: Record<AggFn, string> = {
  none: '원시값', sum: '합계', avg: '평균', count: '개수', min: '최소', max: '최대',
}
// 카테고리/포인트 상한 — 너무 많으면 차트가 읽히지 않으므로 앞에서 자르고 안내한다.
const MAX_POINTS = 200
const MAX_PIE = 30

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const xLabel = (v: unknown): string => (v === null || v === undefined ? 'NULL' : String(v))

/** 컬럼이 (표본상) 숫자형인지 — Y축·산점도 후보를 고를 때 쓴다. */
export function isNumericCol(rows: Row[], col: string): boolean {
  let seen = 0
  let num = 0
  for (const r of rows.slice(0, 60)) {
    const v = r[col]
    if (v === null || v === undefined || v === '') continue
    seen++
    if (toNum(v) !== null) num++
  }
  return seen > 0 && num / seen >= 0.8
}

/** 스마트 기본값 — X 는 첫 비숫자(없으면 첫) 컬럼, Y 는 첫 숫자 컬럼. */
export function defaultChartConfig(columns: string[], rows: Row[]): ChartConfig {
  const numeric = columns.filter((c) => isNumericCol(rows, c))
  const x = columns.find((c) => !numeric.includes(c)) ?? columns[0] ?? ''
  const y = numeric.find((c) => c !== x) ?? numeric[0] ?? ''
  return { kind: 'bar', x, ys: y ? [y] : [], agg: 'sum' }
}

function applyAgg(fn: Exclude<AggFn, 'none' | 'count'>, nums: number[]): number {
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (fn === 'min') return Math.min(...nums)
  return Math.max(...nums)
}

type Datum = Record<string, string | number>

function buildData(rows: Row[], cfg: ChartConfig): { data: Datum[]; truncated: boolean } {
  if (cfg.kind === 'scatter') {
    const y = cfg.ys[0]
    if (!cfg.x || !y) return { data: [], truncated: false }
    const pts = rows
      .map((r) => ({ x: toNum(r[cfg.x]), y: toNum(r[y]) }))
      .filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null)
    return { data: pts.slice(0, MAX_POINTS), truncated: pts.length > MAX_POINTS }
  }

  const cap = cfg.kind === 'pie' ? MAX_PIE : MAX_POINTS
  if (cfg.agg === 'none') {
    const data = rows.map((r) => {
      const o: Datum = { x: xLabel(r[cfg.x]) }
      for (const y of cfg.ys) o[y] = toNum(r[y]) ?? 0
      return o
    })
    return { data: data.slice(0, cap), truncated: data.length > cap }
  }

  // X 값으로 그룹핑 후 각 Y 컬럼을 집계
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const k = xLabel(r[cfg.x])
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }
  const data: Datum[] = []
  for (const [k, grp] of groups) {
    const o: Datum = { x: k }
    for (const y of cfg.ys) {
      if (cfg.agg === 'count') {
        o[y] = grp.length
        continue
      }
      const nums = grp.map((r) => toNum(r[y])).filter((n): n is number => n !== null)
      o[y] = nums.length ? applyAgg(cfg.agg, nums) : 0
    }
    data.push(o)
  }
  return { data: data.slice(0, cap), truncated: data.length > cap }
}

export function ChartView({
  columns,
  rows,
  config,
  onConfigChange,
}: {
  columns: string[]
  rows: Row[]
  config: ChartConfig
  onConfigChange: (c: ChartConfig) => void
}) {
  const numericCols = useMemo(() => columns.filter((c) => isNumericCol(rows, c)), [columns, rows])
  const singleY = config.kind === 'pie' || config.kind === 'scatter'
  const { data, truncated } = useMemo(() => buildData(rows, config), [rows, config])

  const set = (patch: Partial<ChartConfig>) => onConfigChange({ ...config, ...patch })
  const setKind = (kind: ChartKind) => {
    // 원/산점도로 바꾸면 Y 는 하나만 유지. 산점도는 집계 없음.
    const ys = kind === 'pie' || kind === 'scatter' ? config.ys.slice(0, 1) : config.ys
    // 산점도는 집계 없음. 그 외로 돌아오면 집계가 '원시값'이었을 때 '합계'로 되돌린다.
    const agg: AggFn = kind === 'scatter' ? 'none' : config.agg === 'none' ? 'sum' : config.agg
    // 산점도는 X 도 숫자여야 한다 — 현재 X 가 숫자가 아니면 숫자 컬럼으로 바꿔 준다.
    let x = config.x
    if (kind === 'scatter' && !numericCols.includes(x)) {
      x = numericCols.find((c) => c !== ys[0]) ?? numericCols[0] ?? x
    }
    set({ kind, x, ys, agg })
  }
  const toggleY = (c: string) => {
    if (singleY) {
      set({ ys: [c] })
      return
    }
    set({ ys: config.ys.includes(c) ? config.ys.filter((y) => y !== c) : [...config.ys, c] })
  }

  const noNumeric = numericCols.length === 0
  const needY = config.ys.length === 0

  return (
    <div className="nb-chart">
      <div className="nb-chart-cfg">
        <div className="nb-chart-kinds">
          {(['bar', 'line', 'area', 'pie', 'scatter'] as ChartKind[]).map((k) => (
            <button
              key={k}
              className={`nb-chart-kind ${config.kind === k ? 'on' : ''}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="nb-chart-field">
          <span>X</span>
          <select value={config.x} onChange={(e) => set({ x: e.target.value })}>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        {config.kind !== 'scatter' && (
          <label className="nb-chart-field">
            <span>집계</span>
            <select value={config.agg} onChange={(e) => set({ agg: e.target.value as AggFn })}>
              {(['none', 'sum', 'avg', 'count', 'min', 'max'] as AggFn[]).map((a) => (
                <option key={a} value={a}>{AGG_LABEL[a]}</option>
              ))}
            </select>
          </label>
        )}
        <div className="nb-chart-ys">
          <span>{singleY ? 'Y(값)' : 'Y(값, 복수 선택)'}</span>
          <div className="nb-chart-ychips">
            {(config.agg === 'count' && !singleY ? columns : numericCols).map((c) => (
              <button
                key={c}
                className={`nb-chart-ychip ${config.ys.includes(c) ? 'on' : ''}`}
                onClick={() => toggleY(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {noNumeric && config.agg !== 'count' ? (
        <div className="nb-chart-empty">숫자 컬럼이 없어 차트를 그릴 수 없습니다. (집계=개수 는 가능)</div>
      ) : needY ? (
        <div className="nb-chart-empty">그릴 Y(값) 컬럼을 하나 이상 선택하세요.</div>
      ) : data.length === 0 ? (
        <div className="nb-chart-empty">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="nb-chart-canvas">
          <ResponsiveContainer width="100%" height={320}>
            {renderChart(config, data)}
          </ResponsiveContainer>
        </div>
      )}
      {truncated && (
        <div className="nb-chart-note">
          많은 값이라 앞 {config.kind === 'pie' ? MAX_PIE : MAX_POINTS}개만 표시합니다 — 집계하거나 필터로 줄여 보세요.
        </div>
      )}
    </div>
  )
}

function renderChart(cfg: ChartConfig, data: Datum[]) {
  const axis = { fontSize: 11 }
  if (cfg.kind === 'bar') {
    return (
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
        <XAxis dataKey="x" tick={axis} interval="preserveStartEnd" />
        <YAxis tick={axis} />
        <Tooltip />
        <Legend />
        {cfg.ys.map((y, i) => (
          <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} />
        ))}
      </BarChart>
    )
  }
  if (cfg.kind === 'line') {
    return (
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
        <XAxis dataKey="x" tick={axis} interval="preserveStartEnd" />
        <YAxis tick={axis} />
        <Tooltip />
        <Legend />
        {cfg.ys.map((y, i) => (
          <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} dot={false} />
        ))}
      </LineChart>
    )
  }
  if (cfg.kind === 'area') {
    return (
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
        <XAxis dataKey="x" tick={axis} interval="preserveStartEnd" />
        <YAxis tick={axis} />
        <Tooltip />
        <Legend />
        {cfg.ys.map((y, i) => (
          <Area key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} />
        ))}
      </AreaChart>
    )
  }
  if (cfg.kind === 'pie') {
    const y = cfg.ys[0]
    return (
      <PieChart>
        <Tooltip />
        <Legend />
        <Pie data={data} dataKey={y} nameKey="x" cx="50%" cy="50%" outerRadius={110} innerRadius={50} label>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    )
  }
  // scatter
  const y = cfg.ys[0]
  return (
    <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
      <XAxis type="number" dataKey="x" name={cfg.x} tick={axis} />
      <YAxis type="number" dataKey="y" name={y} tick={axis} />
      <ZAxis range={[50, 50]} />
      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
      <Scatter data={data} fill={COLORS[0]} />
    </ScatterChart>
  )
}
