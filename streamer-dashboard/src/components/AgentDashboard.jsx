import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  Users, TrendingUp, ChevronDown, ChevronUp, Crown, Target, PieChart as PieIcon,
  Save, Settings2, ArrowUp, ArrowDown, LayoutGrid, BarChart3, X, Filter, GripVertical, Check,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector, LabelList,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { QuickDateFilter } from './QuickDateFilter'
import { Money } from './Money'
import { KpiMonthlySection } from './KpiMonthlySection'

function formatNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

// §3.4 柔和高辨识 12 色调色板
const PIE_COLORS = [
  '#4F86F7', '#3DD9D6', '#22C58B', '#A78BFA', '#FBBF24',
  '#F472B6', '#60A5FA', '#2DD4BF', '#FB923C', '#A3E635',
  '#F87171', '#C084FC',
]

// 每位运营经纪人独立的双 KPI 配置（存量）
const KPI_MAP_KEY = 'agent_kpi_map_v2'
const DEFAULT_TOTAL_KPI = 20000
const DEFAULT_OFFLINE_KPI = 10000

// KPI 卡片布局（显隐/排序）持久化
const KPI_LAYOUT_KEY = 'agent_kpi_layout_v1'

function loadKpiMap() {
  try {
    const raw = localStorage.getItem(KPI_MAP_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function loadKpiLayout() {
  try {
    const raw = localStorage.getItem(KPI_LAYOUT_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return { order: Array.isArray(obj.order) ? obj.order : [], hidden: Array.isArray(obj.hidden) ? obj.hidden : [] }
  } catch {
    return { order: [], hidden: [] }
  }
}

function getAdminToken() {
  try { return localStorage.getItem('sync_admin_token') || '' } catch { return '' }
}

function parseStatDates(statTimeStr) {
  if (!statTimeStr) return null
  const match = String(statTimeStr).match(/(\d{4}-\d{2}-\d{2})/g)
  return match && match.length >= 2 ? { start: match[0], end: match[1] } : null
}

function DateRangeInfo({ range }) {
  if (!range) return <span className="text-xs text-text-muted">全部周期</span>
  const fmt = (d) => d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  return <span className="text-xs text-text-secondary">{fmt(range.start)} ~ {fmt(range.end)}（{range.label}）</span>
}

// 饼图扇区悬停：放大 + 外发光 + 双环装饰（更灵动的反馈）
function renderActiveShape(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      {/* 白色光晕衬底 */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius - 5}
        outerRadius={outerRadius + 16}
        startAngle={startAngle} endAngle={endAngle}
        fill="#fff" opacity={0.35}
      />
      {/* 主扇区：更大、带投影 */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 12}
        startAngle={startAngle} endAngle={endAngle}
        fill={fill}
        style={{
          filter: 'drop-shadow(0 8px 18px rgba(15,23,42,0.32))',
          transition: 'all 0.25s ease-out',
        }}
      />
      {/* 外圈装饰细环 */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={outerRadius + 14}
        outerRadius={outerRadius + 19}
        startAngle={startAngle} endAngle={endAngle}
        fill={fill} opacity={0.28}
      />
    </g>
  )
}

// 每位运营独立的迷你条形图：单一长条 + 图表正中金额标识
function AgentMiniBar({ agent, value, idx, max, total, onClick, highlighted }) {
  const pctOfTotal = total > 0 ? (value / total) * 100 : 0
  const color = PIE_COLORS[idx % PIE_COLORS.length]
  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col rounded-xl border bg-white p-3 shadow-sm transition-all ${
        highlighted
          ? 'border-brand-300 ring-1 ring-brand-200 shadow-md'
          : 'border-border hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
            style={{ background: color }}
          >
            {String(agent).slice(0, 1)}
          </span>
          <span className="min-w-0 truncate text-xs font-semibold text-text" title={agent}>{agent}</span>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-text-muted">{pctOfTotal.toFixed(1)}%</span>
      </div>

      <div className="relative h-14 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[{ agent, value }]} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, max]} hide />
            <YAxis type="category" dataKey="agent" hide />
            <Tooltip cursor={{ fill: 'rgba(37,99,235,0.05)' }} content={<BarTooltip total={total} />} />
            <Bar dataKey="value" barSize={22} radius={[0, 6, 6, 0]} animationDuration={700} background={{ fill: '#f3f6fb', radius: 6 }}>
              <Cell fill={color} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* 正中间醒目的总流水标识 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-extrabold text-text shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
            <Money value={value} />
          </div>
        </div>
      </div>
    </div>
  )
}

// 环形图/条形图共用的可点击图例
function ChartLegend({ chartData, totalOfflineRevenue, activeAgent, activeIndex, setActiveIndex, onLegendClick, compact }) {
  return (
    <div className={`overflow-y-auto bili-scrollbar pr-1 ${compact ? 'max-h-48 space-y-1 rounded-lg border border-border bg-bg/50 p-2' : 'max-h-80 space-y-1.5'}`}>
      {chartData.map((a, idx) => {
        const pct = totalOfflineRevenue > 0 ? (a.offlineRevenue / totalOfflineRevenue) * 100 : 0
        const color = PIE_COLORS[idx % PIE_COLORS.length]
        const highlighted = !a.isOther && activeAgent === a.agent
        return (
          <div
            key={a.agent}
            onClick={() => onLegendClick(a)}
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseLeave={() => setActiveIndex(null)}
            className={`fx-lift flex cursor-pointer items-center gap-2 rounded-lg text-xs transition-all ${
              highlighted
                ? 'bg-brand-50 ring-1 ring-brand-200 shadow-sm'
                : activeIndex === idx
                  ? 'bg-slate-50 shadow-sm'
                  : 'hover:bg-bg'
            } ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="min-w-0 flex-1 break-words font-medium text-text" title={a.agent}>{a.agent}</span>
            <span className="text-text-muted">{a.offlineCount ?? ''}</span>
            <span className="w-16 text-right text-text-secondary">{fmtShort(a.offlineRevenue)}</span>
            <span className="w-12 text-right text-text-muted">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

// 环形图切片【内侧】百分比标签：深字 + 白色描边光环，清晰且永不越界
const RADIAN = Math.PI / 180
function PieInnerLabel({ cx, cy, innerRadius, outerRadius, midAngle, value, total }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  if (pct < 4) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.58
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x} y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={800}
      fill="#0f172a"
      stroke="#ffffff"
      strokeWidth={3.2}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {pct.toFixed(0)}%
    </text>
  )
}

// 短金额：¥12.3万
function fmtShort(n) {
  const v = Number(n || 0)
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`
  return `¥${formatNum(Math.round(v))}`
}

// 数字滚动动画（count-up）
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const start = performance.now()
    cancelAnimationFrame(raf.current)
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(target * eased)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])
  return val
}

function CountUp({ value, decimals = 0, prefix = '', suffix = '' }) {
  const v = useCountUp(value)
  return <>{prefix}{v.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>
}

// 环形进度（SVG stroke-dashoffset 动画 + 数字 count-up）
function ProgressRing({ value, label, actual, target, color }) {
  const R = 52
  const C = 2 * Math.PI * R
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 150)
    return () => clearTimeout(t)
  }, [value])
  const offset = C * (1 - Math.min(100, Math.max(0, shown)) / 100)
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={R} fill="none" stroke="#eef2f8" strokeWidth="11" />
          <circle
            cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset} className="fx-ring-progress"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-text"><CountUp value={shown} suffix="%" /></span>
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold text-text">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
        <Money value={actual} className="font-bold text-text" />
        <span className="text-text-muted">/ <Money value={target} /></span>
      </div>
    </div>
  )
}

// 当月自然月范围
function currentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end), label: `${now.getFullYear()}年${now.getMonth() + 1}月` }
}

// 当月进度：总天数 / 已过天数 / 剩余天数（含今天）
function monthProgress() {
  const now = new Date()
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const elapsedDays = now.getDate()
  const remainingDays = Math.max(1, totalDays - elapsedDays + 1)
  return { totalDays, elapsedDays, remainingDays }
}

export function AgentDashboard({ records }) {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [activeIndex, setActiveIndex] = useState(null) // §3.1 默认不高亮首扇区
  const [chartType, setChartType] = useState('donut') // 'donut' | 'bar'
  const [activeAgent, setActiveAgent] = useState(null) // 图例 ↔ 表格联动
  const [kpiMap, setKpiMap] = useState(loadKpiMap)
  const [kpiLayout, setKpiLayout] = useState(loadKpiLayout)

  // KPI 服务端同步：服务端为权威源，本地 state / localStorage 仅作离线兜底
  const kpiMapRef = useRef(kpiMap)
  const kpiLayoutRef = useRef(kpiLayout)
  useEffect(() => { kpiMapRef.current = kpiMap }, [kpiMap])
  useEffect(() => { kpiLayoutRef.current = kpiLayout }, [kpiLayout])

  const persistTimer = useRef(null)
  const persistKpi = useCallback((map, layout) => {
    // 本地兜底：保证离线 / 未登录也能即时显示
    try { localStorage.setItem(KPI_MAP_KEY, JSON.stringify(map)) } catch {}
    try { localStorage.setItem(KPI_LAYOUT_KEY, JSON.stringify(layout)) } catch {}
    // 防抖上传服务端（需管理员口令；无口令则仅本地落盘）
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      const token = getAdminToken()
      if (!token) return
      fetch('./api/kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ map: kpiMapRef.current, layout: kpiLayoutRef.current }),
      }).catch(() => {})
    }, 600)
  }, [])

  // 首屏从服务端拉取 KPI（权威源）；服务端为空但本地有则迁移上传，避免重复录入
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('./api/kpi', { headers: { 'x-admin-token': getAdminToken() } })
        if (!res.ok) return
        const j = await res.json()
        if (cancelled || !j.ok) return
        if (j.map && Object.keys(j.map).length) {
          setKpiMap(j.map)
          try { localStorage.setItem(KPI_MAP_KEY, JSON.stringify(j.map)) } catch {}
        } else {
          const local = loadKpiMap()
          if (Object.keys(local).length) {
            setKpiMap(local)
            persistKpi(local, kpiLayoutRef.current)
          }
        }
        if (j.layout) {
          const layout = {
            order: Array.isArray(j.layout.order) ? j.layout.order : [],
            hidden: Array.isArray(j.layout.hidden) ? j.layout.hidden : [],
          }
          setKpiLayout(layout)
          try { localStorage.setItem(KPI_LAYOUT_KEY, JSON.stringify(layout)) } catch {}
        }
      } catch { /* 网络失败则用本地兜底 */ }
    })()
    return () => { cancelled = true }
  }, [])
  const [showManage, setShowManage] = useState(false)
  const [sortField, setSortField] = useState('progress') // total|offline|pass|progress
  const [sortDesc, setSortDesc] = useState(true)
  const [ready, setReady] = useState(false)

  const handleApply = useCallback((r) => setRange(r), [])

  // 首屏加载微光骨架（约 280ms，营造数据载入过渡）
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 280)
    return () => clearTimeout(t)
  }, [])

  // 日期范围过滤
  const inRange = useCallback((r) => {
    if (!range) return true
    const d = parseStatDates(r['统计时间'])
    if (!d) return true
    const rs = range.start.toISOString().slice(0, 10)
    const re = range.end.toISOString().slice(0, 10)
    return (!d.start || d.start <= re) && (!d.end || d.end >= rs)
  }, [range])

  // 【核心口径】饼图 + 数据表：仅统计线下主播
  const offlineRecords = useMemo(
    () => records.filter(r => r['是否线下主播'] && inRange(r)),
    [records, inRange]
  )

  // 聚合到「主播维度」再汇总：同一房间号在周期内有多条日记录时，先按房间号聚合
  const data = useMemo(() => {
    const agentMap = {}
    offlineRecords.forEach(r => {
      const agent = r['运营经纪人'] || '未分配'
      if (!agentMap[agent]) {
        agentMap[agent] = {
          agent,
          roomSet: new Set(),
          roomRevenue: {},
          roomName: {},
          offlineRevenue: 0,
          offlineIncome: 0,
          totalDays: 0,
          totalHours: 0,
        }
      }
      const node = agentMap[agent]
      const room = String(r['房间号'])
      node.roomSet.add(room)
      node.roomName[room] = r['主播昵称'] || node.roomName[room] || room
      node.roomRevenue[room] = (node.roomRevenue[room] || 0) + Number(r['总流水（元）'] || 0)
      node.offlineRevenue += Number(r['总流水（元）'] || 0)
      node.offlineIncome += Number(r['总收益（元）'] || 0)
      node.totalDays += Number(r['开播天数'] || 0)
      node.totalHours += Number(r['开播时长（小时）'] || 0)
    })

    return Object.values(agentMap)
      .map(a => ({
        agent: a.agent,
        offlineCount: a.roomSet.size,
        offlineRevenue: Number(a.offlineRevenue.toFixed(2)),
        offlineIncome: Number(a.offlineIncome.toFixed(2)),
        totalDays: Number(a.totalDays.toFixed(2)),
        totalHours: Number(a.totalHours.toFixed(2)),
        top3: Object.entries(a.roomRevenue)
          .map(([room, rev]) => ({ room, name: a.roomName[room] || room, revenue: rev }))
          .sort((x, y) => y.revenue - x.revenue)
          .slice(0, 3),
      }))
      .sort((a, b) => b.offlineRevenue - a.offlineRevenue)
  }, [offlineRecords])

  const totalOfflineRevenue = useMemo(() => data.reduce((s, a) => s + a.offlineRevenue, 0), [data])
  const totalOfflineCount = useMemo(() => data.reduce((s, a) => s + a.offlineCount, 0), [data])

  // 长尾合并：TOP8 之后合并为「其他」(§3.1)
  const chartData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.offlineRevenue - a.offlineRevenue)
    const TOP = 8
    const top = sorted.slice(0, TOP).map((a, i) => ({ ...a, rank: i + 1, idx: i }))
    const rest = sorted.slice(TOP)
    if (rest.length === 0) return top
    const othersRev = rest.reduce((s, r) => s + r.offlineRevenue, 0)
    return [...top, { agent: '其他', offlineRevenue: Number(othersRev.toFixed(2)), isOther: true, rank: null, idx: TOP }]
  }, [data])

  // 迷你条形图统一 X 轴上限，便于横向对比
  const maxOfflineRevenue = useMemo(() => Math.max(1, ...chartData.map(d => d.offlineRevenue)), [chartData])

  // 【本月KPI完成进度】：线上线下总流水取全量数据，线下总流水取线下子集，均限定当月
  const monthRange = useMemo(currentMonthRange, [])

  const kpiList = useMemo(() => {
    const inMonth = (r) => {
      const d = parseStatDates(r['统计时间'])
      if (!d) return true
      return (!d.start || d.start <= monthRange.end) && (!d.end || d.end >= monthRange.start)
    }
    const monthRecords = records.filter(inMonth)
    const map = {}
    monthRecords.forEach(r => {
      const agent = r['运营经纪人'] || '未分配'
      if (!map[agent]) map[agent] = { agent, allRevenue: 0, offlineRevenue: 0, allRooms: new Set(), offlineRooms: new Set() }
      const rev = Number(r['总流水（元）'] || 0)
      map[agent].allRevenue += rev
      map[agent].allRooms.add(String(r['房间号']))
      if (r['是否线下主播']) {
        map[agent].offlineRevenue += rev
        map[agent].offlineRooms.add(String(r['房间号']))
      }
    })

    const { totalDays, elapsedDays, remainingDays } = monthProgress()

    return Object.values(map)
      .map(a => {
        const cfg = kpiMap[a.agent] || {}
        const totalKpi = Number(cfg.totalKpi ?? DEFAULT_TOTAL_KPI) || 0
        const offlineKpi = Number(cfg.offlineKpi ?? DEFAULT_OFFLINE_KPI) || 0
        const totalPass = totalKpi > 0 && a.allRevenue >= totalKpi
        const offlinePass = offlineKpi > 0 && a.offlineRevenue >= offlineKpi
        const safeDiv = (n, d) => (d > 0 ? n / d : 0)
        return {
          agent: a.agent,
          allRevenue: Number(a.allRevenue.toFixed(2)),
          offlineRevenue: Number(a.offlineRevenue.toFixed(2)),
          allCount: a.allRooms.size,
          offlineCount: a.offlineRooms.size,
          totalKpi,
          offlineKpi,
          totalProgress: totalKpi > 0 ? Math.min(100, (a.allRevenue / totalKpi) * 100) : 0,
          offlineProgress: offlineKpi > 0 ? Math.min(100, (a.offlineRevenue / offlineKpi) * 100) : 0,
          totalPass,
          offlinePass,
          passed: totalPass || offlinePass,
          // 日均指标
          totalPlannedDaily: Number(safeDiv(totalKpi, totalDays).toFixed(2)),
          offlinePlannedDaily: Number(safeDiv(offlineKpi, totalDays).toFixed(2)),
          totalActualDaily: Number(safeDiv(a.allRevenue, elapsedDays).toFixed(2)),
          offlineActualDaily: Number(safeDiv(a.offlineRevenue, elapsedDays).toFixed(2)),
          totalRequiredDaily: Number(Math.max(0, safeDiv(totalKpi - a.allRevenue, remainingDays)).toFixed(2)),
          offlineRequiredDaily: Number(Math.max(0, safeDiv(offlineKpi - a.offlineRevenue, remainingDays)).toFixed(2)),
        }
      })
  }, [records, kpiMap, monthRange])

  const passedCount = useMemo(() => kpiList.filter(a => a.passed).length, [kpiList])

  // 本月线下总流水（ZONE1）
  const monthOfflineRevenue = useMemo(() => {
    const inMonth = (r) => {
      const d = parseStatDates(r['统计时间'])
      if (!d) return true
      return (!d.start || d.start <= monthRange.end) && (!d.end || d.end >= monthRange.start)
    }
    return records.filter(r => r['是否线下主播'] && inMonth(r))
      .reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)
  }, [records, monthRange])

  // 本月线上线下总流水（ZONE1 首卡）
  const monthAllRevenue = useMemo(() => {
    const inMonth = (r) => {
      const d = parseStatDates(r['统计时间'])
      if (!d) return true
      return (!d.start || d.start <= monthRange.end) && (!d.end || d.end >= monthRange.start)
    }
    return records.filter(inMonth).reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)
  }, [records, monthRange])

  // 团队KPI完成率：基于【卡片管理中显示（未隐藏）】的全部运营，汇总其 KPI 目标与实际
  const teamKpiVisible = useMemo(() => {
    const hidden = new Set(kpiLayout.hidden || [])
    const visible = kpiList.filter(a => !hidden.has(a.agent))
    const totalKpi = visible.reduce((s, a) => s + a.totalKpi, 0)
    const totalActual = visible.reduce((s, a) => s + a.allRevenue, 0)
    const offlineKpi = visible.reduce((s, a) => s + a.offlineKpi, 0)
    const offlineActual = visible.reduce((s, a) => s + a.offlineRevenue, 0)
    const safe = (a, k) => (k > 0 ? Math.min(100, (a / k) * 100) : 0)
    return {
      count: visible.length,
      totalKpi, totalActual, totalProgress: safe(totalActual, totalKpi),
      offlineKpi, offlineActual, offlineProgress: safe(offlineActual, offlineKpi),
    }
  }, [kpiList, kpiLayout.hidden])

  // KPI 排序 + 显隐 + 自定义顺序（§4）
  const visibleKpi = useMemo(() => {
    const arr = [...kpiList]
    if (sortField === 'total') arr.sort((a, b) => sortDesc ? b.allRevenue - a.allRevenue : a.allRevenue - b.allRevenue)
    else if (sortField === 'offline') arr.sort((a, b) => sortDesc ? b.offlineRevenue - a.offlineRevenue : a.offlineRevenue - b.offlineRevenue)
    else if (sortField === 'pass') arr.sort((a, b) => sortDesc ? (b.passed ? 1 : 0) - (a.passed ? 1 : 0) : (a.passed ? 1 : 0) - (b.passed ? 1 : 0))
    else arr.sort((a, b) => sortDesc
      ? Math.max(b.totalProgress, b.offlineProgress) - Math.max(a.totalProgress, a.offlineProgress)
      : Math.max(a.totalProgress, a.offlineProgress) - Math.max(b.totalProgress, b.offlineProgress))

    const hidden = new Set(kpiLayout.hidden || [])
    const base = arr.filter(a => !hidden.has(a.agent))
    const order = kpiLayout.order || []
    if (!order.length) return base
    const rank = new Map(order.map((ag, i) => [ag, i]))
    return base.slice().sort((a, b) => {
      const ra = rank.has(a.agent) ? rank.get(a.agent) : 9999
      const rb = rank.has(b.agent) ? rank.get(b.agent) : 9999
      return ra - rb
    })
  }, [kpiList, sortField, sortDesc, kpiLayout])

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const kw = search.toLowerCase()
    return data.filter(a => a.agent.toLowerCase().includes(kw))
  }, [data, search])

  function toggle(agent) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(agent)) next.delete(agent)
      else next.add(agent)
      return next
    })
  }

  const updateKpi = useCallback((agent, field, value) => {
    setKpiMap(prev => {
      const next = { ...prev, [agent]: { ...(prev[agent] || {}), [field]: value === '' ? '' : Number(value) } }
      persistKpi(next, kpiLayoutRef.current)
      return next
    })
  }, [persistKpi])

  const updateLayout = useCallback((next) => {
    setKpiLayout(next)
    persistKpi(kpiMapRef.current, next)
  }, [persistKpi])

  // 拖拽排序：以自定义顺序（order）为基准，缺失者追加在末尾；拖拽生成「自定义顺序」后刷新保留
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const orderedAgents = useMemo(() => {
    const order = kpiLayout.order || []
    if (!order.length) return kpiList.map(a => a.agent)
    const set = new Set(kpiList.map(a => a.agent))
    const kept = order.filter(ag => set.has(ag))
    const rest = kpiList.map(a => a.agent).filter(ag => !kept.includes(ag))
    return [...kept, ...rest]
  }, [kpiList, kpiLayout.order])

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedAgents.indexOf(active.id)
    const newIndex = orderedAgents.indexOf(over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(orderedAgents, oldIndex, newIndex)
    updateLayout({ ...kpiLayout, order: next })
  }

  function toggleHidden(agent) {
    const hidden = new Set(kpiLayout.hidden || [])
    if (hidden.has(agent)) hidden.delete(agent)
    else hidden.add(agent)
    updateLayout({ ...kpiLayout, hidden: [...hidden] })
  }

  // 图例点击 → 表格联动高亮
  function onLegendClick(entry) {
    if (entry.isOther) { setActiveAgent(null); return }
    setActiveAgent(prev => (prev === entry.agent ? null : entry.agent))
  }

  if (!ready) {
    return (
      <div className="space-y-4 p-4">
        <DashboardSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {/* ===== ZONE 1 概览条（关键计数，移动端 sticky） ===== */}
      <div className="sticky top-0 z-20 -mx-4 bg-bg px-4 pb-1 pt-0.5 fx-enter">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            label="本月线上线下总流水"
            value={<Money value={monthAllRevenue} />}
            sub="当月 · 线上+线下口径"
            accent="text-brand-700"
          />
          <SummaryCard
            label="本月线下总流水"
            value={<Money value={monthOfflineRevenue} />}
            sub="当月 · 仅线下口径"
            accent="text-brand-700"
          />
          <SummaryCard
            label={`线下主播数（${range?.label || '全部'}）`}
            value={formatNum(totalOfflineCount)}
            sub={`${data.length} 位运营经纪人`}
            accent="text-text"
          />
          <SummaryCard
            label="运营经纪人（线下）"
            value={data.length}
            sub="当前有数据"
            accent="text-text"
          />
        </div>
      </div>

      {/* ===== ZONE 1.5 团队KPI完成率（基于卡片管理已选运营，拆分两项指标） ===== */}
      <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm" style={{ animationDelay: '80ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Target size={18} className="text-brand-600" />
            团队KPI完成率
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">已选 {teamKpiVisible.count} 位运营</span>
          </div>
          <span className="text-[10px] text-text-muted">基于卡片管理中显示的全部运营 KPI 汇总 · 实时刷新</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-center rounded-lg bg-bg py-4">
            <ProgressRing
              value={teamKpiVisible.totalProgress}
              label="线上线下总流水完成率"
              actual={teamKpiVisible.totalActual}
              target={teamKpiVisible.totalKpi}
              color="#2563eb"
            />
          </div>
          <div className="flex items-center justify-center rounded-lg bg-bg py-4">
            <ProgressRing
              value={teamKpiVisible.offlineProgress}
              label="线下总流水完成率"
              actual={teamKpiVisible.offlineActual}
              target={teamKpiVisible.offlineKpi}
              color="#f59e0b"
            />
          </div>
        </div>
      </div>

      {/* ===== ZONE 2 结构分析（占比环形图 + 横向条形切换 + 排序图例） ===== */}
      <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm" style={{ animationDelay: '160ms' }}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <PieIcon size={18} className="text-brand-600" />
            各运营经纪人总流水占比
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">仅统计线下主播</span>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <ChartTypeBtn active={chartType === 'donut'} onClick={() => setChartType('donut')} icon={<PieIcon size={13} />} label="环形" />
            <ChartTypeBtn active={chartType === 'bar'} onClick={() => setChartType('bar')} icon={<BarChart3 size={13} />} label="条形" />
          </div>
        </div>

        {data.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-secondary">暂无线下主播数据，请先在「线下主播管理」录入线下主播房间号</div>
        ) : (
          chartType === 'donut' ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* 环形图 + 外围指标 */}
              <div className="flex flex-col">
                <div className="relative h-80 w-full lg:h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 14, right: 14, bottom: 14, left: 14 }}>
                      <Pie
                        data={chartData}
                        dataKey="offlineRevenue"
                        nameKey="agent"
                        cx="50%" cy="50%"
                        outerRadius={78}
                        innerRadius={48}
                        paddingAngle={2.5}
                        activeIndex={activeIndex ?? undefined}
                        activeShape={renderActiveShape}
                        onMouseEnter={(_, idx) => setActiveIndex(idx)}
                        onMouseLeave={() => setActiveIndex(null)}
                        isAnimationActive
                        animationBegin={80}
                        animationDuration={800}
                        animationEasing="ease-out"
                      >
                        {chartData.map((entry, idx) => {
                          const dimmed = activeIndex !== null && activeIndex !== idx
                          return (
                            <Cell
                              key={entry.agent}
                              fill={PIE_COLORS[idx % PIE_COLORS.length]}
                              stroke="#fff"
                              strokeWidth={2}
                              opacity={dimmed ? 0.42 : 1}
                              style={{ transition: 'opacity 0.25s ease-out' }}
                            />
                          )
                        })}
                        <LabelList
                          dataKey="offlineRevenue"
                          labelLine={false}
                          content={<PieInnerLabel total={totalOfflineRevenue} />}
                        />
                      </Pie>
                      <Tooltip content={<PieTooltip total={totalOfflineRevenue} getColor={d => PIE_COLORS[chartData.findIndex(x => x.agent === d.agent) % PIE_COLORS.length]} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* 外围指标：移出环心，避免中心拥挤 */}
                <div key={activeIndex ?? 'cap'} className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center transition-all duration-300 ease-out">
                  {activeIndex !== null && chartData[activeIndex] ? (
                    <>
                      <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[activeIndex % PIE_COLORS.length] }} />
                      <span className="text-xs font-medium text-text-secondary">{chartData[activeIndex].agent}</span>
                      <span className="text-sm font-bold text-text"><Money value={chartData[activeIndex].offlineRevenue} /></span>
                      <span className="text-xs font-medium text-text-muted">
                        {totalOfflineRevenue > 0 ? ((chartData[activeIndex].offlineRevenue / totalOfflineRevenue) * 100).toFixed(1) : '0.0'}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-text-muted">线下总流水</span>
                      <span className="text-base font-bold text-text"><Money value={totalOfflineRevenue} /></span>
                      <span className="text-[11px] text-text-secondary">{data.length} 位经纪人</span>
                    </>
                  )}
                </div>
              </div>

              <ChartLegend
                chartData={chartData}
                totalOfflineRevenue={totalOfflineRevenue}
                activeAgent={activeAgent}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                onLegendClick={onLegendClick}
                compact={false}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* 每个运营独立的迷你条形图 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {chartData.map((a, idx) => (
                  <AgentMiniBar
                    key={a.agent}
                    agent={a.agent}
                    value={a.offlineRevenue}
                    idx={idx}
                    max={maxOfflineRevenue}
                    total={totalOfflineRevenue}
                    highlighted={!a.isOther && activeAgent === a.agent}
                    onClick={() => onLegendClick(a)}
                  />
                ))}
              </div>

              <ChartLegend
                chartData={chartData}
                totalOfflineRevenue={totalOfflineRevenue}
                activeAgent={activeAgent}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                onLegendClick={onLegendClick}
                compact={true}
              />
            </div>
          )
        )}
      </div>

      {/* ===== ZONE 3 明细数据（经纪人聚合表，可排序/搜索/展开 TOP3，联动高亮） ===== */}
      <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm" style={{ animationDelay: '240ms' }}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Users size={18} className="text-brand-600" />
              线下主播数据情况
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">仅统计线下主播</span>
            </div>
            <DateRangeInfo range={range} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <QuickDateFilter onApply={handleApply} />
            <input
              type="text"
              placeholder="搜索运营经纪人"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-md border border-border px-3 py-1.5 text-xs outline-none focus:border-brand-500 sm:w-48"
            />
            {activeAgent && (
              <button
                onClick={() => setActiveAgent(null)}
                className="flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-1.5 text-xs text-brand-700 hover:bg-brand-100"
              >
                <X size={12} /> 清除高亮（{activeAgent}）
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto bili-scrollbar">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border bg-bg text-text-secondary">
                <th className="px-3 py-2.5 text-left font-medium">排名</th>
                <th className="sticky left-0 z-10 bg-bg px-3 py-2.5 text-left font-medium">运营经纪人</th>
                <th className="px-3 py-2.5 text-right font-medium">线下主播数</th>
                <th className="sticky right-0 z-10 bg-bg px-3 py-2.5 text-right font-medium">线下主播总流水</th>
                <th className="px-3 py-2.5 text-right font-medium">开播天数</th>
                <th className="px-3 py-2.5 text-right font-medium">开播时长(h)</th>
                <th className="px-3 py-2.5 text-center font-medium">TOP3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((a, idx) => (
                <FragmentRow
                  key={a.agent}
                  a={a}
                  idx={idx}
                  isOpen={expanded.has(a.agent)}
                  highlighted={activeAgent === a.agent}
                  onToggle={() => toggle(a.agent)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-text-secondary">
            暂无线下主播数据，请先在「线下主播管理」录入线下主播房间号
          </div>
        )}
      </div>

      {/* ===== ZONE 4 目标进度（个人 KPI 卡 + 排序/显隐/拖序） ===== */}
      <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm" style={{ animationDelay: '320ms' }}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Target size={18} className="text-brand-600" />
            本月KPI完成进度
            <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-text-secondary">{monthRange.label}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span>已完成 <b className="text-success">{passedCount}</b> / {kpiList.length} 人</span>
            <span className="text-[10px] text-text-muted">两项 KPI 达标其一即算完成 · 修改即自动保存</span>
          </div>
        </div>

        {/* 排序工具栏 + 卡片管理 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
            <Filter size={12} className="text-text-secondary" />
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value)}
              className="border-none bg-transparent text-xs outline-none"
            >
              <option value="progress">按完成率</option>
              <option value="total">按总流水</option>
              <option value="offline">按线下流水</option>
              <option value="pass">按达标状态</option>
            </select>
          </div>
          <button
            onClick={() => setSortDesc(d => !d)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary hover:bg-bg"
          >
            {sortDesc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
            {sortDesc ? '降序' : '升序'}
          </button>
          <button
            onClick={() => setShowManage(v => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${
              showManage ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-border text-text-secondary hover:bg-bg'
            }`}
          >
            <Settings2 size={12} /> 卡片管理
          </button>
          <span className="text-[10px] text-text-muted">
            显隐 {kpiLayout.hidden?.length || 0} · 已达标 {passedCount}/{kpiList.length}
          </span>
        </div>

        {/* 卡片管理面板：显隐 + 拖拽排序 */}
        {showManage && (
          <div className="mb-3 rounded-lg border border-border bg-bg p-3">
            <div className="mb-2 text-xs font-medium text-text-secondary">卡片显隐与拖拽排序（拖拽后生成「自定义顺序」，刷新后保留；点按手柄拖拽，复选框控制显隐；重置后恢复按完成率排序）</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedAgents} strategy={verticalListSortingStrategy}>
                <div className="max-h-60 space-y-1 overflow-y-auto bili-scrollbar">
                  {orderedAgents.map(agent => {
                    const a = kpiList.find(k => k.agent === agent)
                    if (!a) return null
                    const hidden = (kpiLayout.hidden || []).includes(agent)
                    return (
                      <SortableAgentRow key={agent} a={a} hidden={hidden} onToggle={() => toggleHidden(agent)} />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
            <button
              onClick={() => updateLayout({ order: [], hidden: [] })}
              className="mt-2 text-[10px] text-text-muted underline hover:text-brand-700"
            >
              重置为默认顺序与全显
            </button>
          </div>
        )}

        {visibleKpi.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-secondary">全部卡片已隐藏，请在「卡片管理」中勾选显示</div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleKpi.map((a, idx) => {
              const agentColor = PIE_COLORS[idx % PIE_COLORS.length]
              return (
              <div
                key={a.agent}
                className={`fx-enter rounded-xl border border-border bg-white p-4 transition-colors ${
                  a.passed ? 'bg-green-50/40' : ''
                }`}
                style={{ borderLeftColor: agentColor, borderLeftWidth: 4, animationDelay: `${80 + idx * 70}ms` }}
              >
                {/* 经纪人信息头部 */}
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-2 ring-white"
                      style={{ background: agentColor }}
                    >
                      {String(a.agent).slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text">{a.agent}</div>
                      <div className="text-[10px] text-text-muted">名下主播 {a.allCount} 人 · 线下 {a.offlineCount} 人</div>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                    a.passed ? 'bg-success text-white' : 'bg-gray-100 text-text-secondary'
                  }`}>
                    {a.passed ? '已完成' : '未完成'}
                  </span>
                </div>


                {/* 双 KPI 进度区：垂直排列，信息完整 */}
                <div className="flex flex-col gap-1">
                  <KpiBar
                    label="线上线下总流水"
                    actual={a.allRevenue}
                    kpi={a.totalKpi}
                    progress={a.totalProgress}
                    passed={a.totalPass}
                    color="bg-violet-500"
                    onChange={v => updateKpi(a.agent, 'totalKpi', v)}
                    delay={idx * 70}
                    plannedDaily={a.totalPlannedDaily}
                    actualDaily={a.totalActualDaily}
                    requiredDaily={a.totalRequiredDaily}
                  />
                  <div className="my-1 h-px bg-border/50" />
                  <KpiBar
                    label="线下总流水"
                    actual={a.offlineRevenue}
                    kpi={a.offlineKpi}
                    progress={a.offlineProgress}
                    passed={a.offlinePass}
                    color="bg-amber-500"
                    onChange={v => updateKpi(a.agent, 'offlineKpi', v)}
                    delay={idx * 70 + 90}
                    plannedDaily={a.offlinePlannedDaily}
                    actualDaily={a.offlineActualDaily}
                    requiredDaily={a.offlineRequiredDaily}
                  />
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* ===== ZONE 5 月度 KPI 完成汇总（每个自然月过完后自动结算） ===== */}
      <KpiMonthlySection />
    </div>
  )
}

function SortableAgentRow({ a, hidden, onToggle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.agent })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs ${isDragging ? 'opacity-70 ring-1 ring-brand-300 shadow-sm' : ''}`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-text-muted hover:text-brand-700 active:cursor-grabbing"
        title="按住拖拽排序"
      >
        <GripVertical size={14} />
      </span>
      <input type="checkbox" checked={!hidden} onChange={onToggle} className="accent-brand-600" />
      <span className={`flex-1 truncate ${hidden ? 'text-text-muted line-through' : 'text-text'}`}>{a.agent}</span>
      <span className="text-[10px] text-text-muted">{hidden ? '已隐藏' : ''}</span>
    </div>
  )
}

function SummaryCard({ label, value, sub, accent }) {
  return (
    <div className="fx-card rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`mt-1 text-xl font-bold lg:text-2xl ${accent}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-text-muted">{sub}</div>
    </div>
  )
}

// 首屏加载骨架（微光）
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="fx-skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="fx-skeleton h-72 rounded-xl" />
      <div className="fx-skeleton h-64 rounded-xl" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="fx-skeleton h-32 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function ChartTypeBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-brand-600 text-white' : 'text-text-secondary hover:text-brand-700'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function PieTooltip({ active, payload, total, getColor }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  const pct = total > 0 ? (d.offlineRevenue / total) * 100 : 0
  const color = getColor ? getColor(d) : '#3B82F6'
  return (
    <div className="rounded-xl bg-slate-800 px-3.5 py-2.5 text-xs text-white shadow-2xl ring-1 ring-white/10">
      <div className="mb-2 flex items-center gap-1.5 font-semibold">
        <span className="h-2 w-2 rounded-full shadow-sm" style={{ background: color }} />
        <span className="max-w-[140px] truncate">{d.agent}</span>
        {d.rank ? <span className="ml-1 shrink-0 text-[10px] text-white/50">第 {d.rank} 名</span> : null}
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-6">
          <span className="text-white/65">线下流水</span>
          <span className="font-bold"><Money value={d.offlineRevenue} /></span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-white/65">占比</span>
          <span className="font-medium">{pct.toFixed(1)}%</span>
        </div>
        {d.offlineCount ? (
          <div className="flex items-center justify-between gap-6">
            <span className="text-white/65">主播数</span>
            <span className="font-medium">{d.offlineCount} 人</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BarTooltip({ active, payload, total }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  const pct = total > 0 ? (d.offlineRevenue / total) * 100 : 0
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-text">{d.agent}</div>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="text-text-secondary">金额</span>
        <span className="font-bold text-brand-700"><Money value={d.offlineRevenue} /></span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">占比</span>
        <span className="text-text">{pct.toFixed(1)}%</span>
      </div>
    </div>
  )
}

function KpiBar({ label, actual, kpi, progress, passed, color, onChange, delay = 0, plannedDaily = 0, actualDaily = 0, requiredDaily = 0 }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setW(progress), 140 + delay)
    return () => clearTimeout(t)
  }, [progress, delay])

  const theme = passed
    ? {
        gradient: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
        glow: '0 0 16px rgba(16,185,129,0.45)',
        text: 'text-success',
        pillBg: 'bg-green-50',
        pillBorder: 'border-green-200',
        icon: '#10b981',
      }
    : color === 'bg-amber-500'
      ? {
          gradient: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
          glow: '0 0 16px rgba(245,158,11,0.45)',
          text: 'text-amber-600',
          pillBg: 'bg-amber-50',
          pillBorder: 'border-amber-200',
          icon: '#f59e0b',
        }
      : {
          gradient: 'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',
          glow: '0 0 16px rgba(139,92,246,0.45)',
          text: 'text-violet-600',
          pillBg: 'bg-violet-50',
          pillBorder: 'border-violet-200',
          icon: '#8b5cf6',
        }

  const isDone = kpi > 0 && requiredDaily <= 0

  return (
    <div className="py-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 rounded-md border px-2 py-1 ${theme.pillBg} ${theme.pillBorder}`}>
            <Target size={11} style={{ color: theme.icon }} />
            <input
              type="number"
              min="0"
              value={kpi}
              onChange={e => onChange(e.target.value)}
              className="w-[104px] border-none bg-transparent p-0 text-right text-[11px] font-bold outline-none"
              style={{ color: theme.icon }}
            />
          </div>
          <span className={`text-xs font-semibold ${theme.text}`}>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {passed && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-success">
              <Check size={10} /> 已达标
            </span>
          )}
          <div className="w-14 text-right text-sm font-extrabold text-text">{progress.toFixed(1)}%</div>
        </div>
      </div>

      <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
        <div
          className="fx-progress-shine h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${w}%`, background: theme.gradient, boxShadow: theme.glow }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={12} className="text-text-muted" />
          <span className="text-text-muted">当前</span>
          <Money value={actual} className={`font-bold ${passed ? 'text-success' : 'text-text'}`} />
          <span className="text-text-muted">/ 目标 <Money value={kpi} /></span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-secondary">
          <span>目标日均 <b className="text-text"><Money value={plannedDaily} /></b></span>
          <span>当前日均 <b className={actualDaily >= plannedDaily ? 'text-success' : 'text-text'}><Money value={actualDaily} /></b></span>
          <span className={isDone ? 'font-medium text-success' : 'font-medium text-amber-600'}>
            {isDone ? '✓ 已达标' : <>还需日均 <Money value={requiredDaily} /></>}
          </span>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ a, idx, isOpen, highlighted, onToggle }) {
  return (
    <>
      <tr className={highlighted ? 'bg-brand-50' : 'hover:bg-bg'}>
        <td className="px-3 py-2.5">
          {idx < 3 ? (
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
              idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-gray-400' : 'bg-orange-400'
            }`}>
              {idx + 1}
            </span>
          ) : (
            <span className="text-text-secondary">{idx + 1}</span>
          )}
        </td>
        <td className="sticky left-0 z-10 bg-white px-3 py-2.5 font-medium text-text">
          {a.agent}
        </td>
        <td className="px-3 py-2.5 text-right">{formatNum(a.offlineCount)}</td>
        <td className="sticky right-0 z-10 bg-white px-3 py-2.5 text-right font-medium text-brand-700"><Money value={a.offlineRevenue} className="font-bold" /></td>
        <td className="px-3 py-2.5 text-right">{formatNum(a.totalDays)}</td>
        <td className="px-3 py-2.5 text-right">{formatNum(a.totalHours)}</td>
        <td className="px-3 py-2.5 text-center">
          <button
            onClick={onToggle}
            className="fx-pop flex items-center gap-0.5 rounded-md px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
          >
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {isOpen ? '收起' : '查看'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-bg">
          <td colSpan={7} className="px-3 py-3">
            <div className="rounded-lg border border-border bg-white p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-text-secondary">
                <Crown size={12} className="text-warning" />
                该运营 TOP3 线下主播（按总流水）
              </div>
              <div className="space-y-1.5">
                {a.top3.map((s, i) => (
                  <div key={s.room || i} className="flex items-center justify-between rounded-md bg-bg px-3 py-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                        i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                      }`}>{i + 1}</span>
                      <span className="font-medium text-text">{s.name}</span>
                      <span className="text-[10px] text-text-muted">房间号:{s.room}</span>
                    </div>
                    <span className="font-medium text-brand-700"><Money value={s.revenue} className="font-bold" /></span>
                  </div>
                ))}
                {a.top3.length === 0 && (
                  <div className="text-xs text-text-muted">暂无主播数据</div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
