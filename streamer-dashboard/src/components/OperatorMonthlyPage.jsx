import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TrendingUp, Calendar, BarChart3, ArrowRight, Filter, GitCompareArrows, AlertTriangle, Zap } from 'lucide-react'
// 涨跌展示统一口径：国内「红涨绿跌」——上升红、下降绿、持平灰，带正负号与方向箭头
import { TrendBadge, DeltaText, fmtPct } from '../lib/trend'

const adminToken = () => {
  try { return localStorage.getItem('sync_admin_token') || 'fbc1985757d7849a22e64c672d3120a6' } catch { return 'fbc1985757d7849a22e64c672d3120a6' }
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return '¥' + Math.round(v).toLocaleString('zh-CN')
}
function fmtNum(n) {
  const v = Number(n) || 0
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

// 明细表列定义
const COLUMNS = [
  { key: 'totalFlow', label: '线上线下总流水', fmt: fmtMoney, mom: 'totalFlow', align: 'right', strong: true },
  { key: 'offlineFlow', label: '线下总流水', fmt: fmtMoney, mom: 'offlineFlow', align: 'right' },
  { key: 'onlineFlow', label: '线上总流水', fmt: fmtMoney, mom: 'onlineFlow', align: 'right' },
  { key: 'joined', label: '入会数', fmt: fmtNum, mom: 'joined', align: 'right' },
  { key: 'joinedOnline', label: '线上入会', fmt: fmtNum, mom: 'joinedOnline', align: 'right' },
  { key: 'joinedOffline', label: '线下入会', fmt: fmtNum, mom: 'joinedOffline', align: 'right' },
  { key: 'roomCount', label: '主播数', fmt: fmtNum, align: 'right' },
  { key: 'openDays', label: '开播天数', fmt: fmtNum, align: 'right' },
  { key: 'broadcastHours', label: '开播时长(h)', fmt: fmtNum, align: 'right' },
  { key: 'seaCount', label: '大航海', fmt: fmtNum, align: 'right' },
  { key: 'payCount', label: '付费人数', fmt: fmtNum, align: 'right' },
  { key: 'dailyAvg', label: '日均流水', fmt: fmtMoney, align: 'right' },
]
// 波动主播清单中的列格式化映射
const colFmt = Object.fromEntries(COLUMNS.map(c => [c.key, c.fmt]))

function SummaryCard({ icon: Icon, label, value, accent, sub }) {
  return (
    <div className="fx-panel fx-enter flex items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-secondary">{label}</div>
        <div className="mt-0.5 text-2xl font-bold leading-none text-text">{value}</div>
        {sub && <div className="mt-1 text-[11px] text-text-muted">{sub}</div>}
      </div>
    </div>
  )
}

export function OperatorMonthlyPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opFilter, setOpFilter] = useState('__all__')
  const [monthFilter, setMonthFilter] = useState('__all__')
  const [view, setView] = useState('detail') // detail | compare
  const [sortKey, setSortKey] = useState('totalFlow')
  const [sortDir, setSortDir] = useState('desc')
  // 对比视图用
  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')
  // 单运营+两月对比时，主播级环比拆解（波动主播清单）
  const CMP_THRESHOLD = 20 // 波动主播清单阈值（环比变化超过该百分比才列出）
  const [streamerCmp, setStreamerCmp] = useState(null)
  const [streamerCmpLoading, setStreamerCmpLoading] = useState(false)
  const [streamerCmpError, setStreamerCmpError] = useState('')

  async function fetchStats() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/operator-monthly-stats?force=0')
      const j = await res.json()
      if (j && j.ok) {
        setData(j)
        // 默认对比选最新两个月
        if (j.months && j.months.length >= 2) {
          setCmpA(j.months[j.months.length - 1])
          setCmpB(j.months[j.months.length - 2])
        } else if (j.months && j.months.length === 1) {
          setCmpA(j.months[0])
          setCmpB('')
        }
      } else {
        setData(null)
        setError(j?.error || '暂无统计数据')
      }
    } catch (e) {
      setError('读取统计接口失败：' + e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

  // 单运营 + 两月对比时，拉取主播级环比拆解（波动主播清单）
  useEffect(() => {
    if (view !== 'compare' || opFilter === '__all__' || !cmpA || !cmpB) {
      setStreamerCmp(null)
      setStreamerCmpError('')
      return
    }
    let cancelled = false
    setStreamerCmpLoading(true)
    setStreamerCmpError('')
    fetch(`/api/operator-monthly-streamers?operator=${encodeURIComponent(opFilter)}&monthA=${encodeURIComponent(cmpA)}&monthB=${encodeURIComponent(cmpB)}&threshold=${CMP_THRESHOLD}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('接口返回 ' + r.status)
        const j = await r.json()
        if (cancelled) return
        if (j && j.ok) setStreamerCmp(j)
        else { setStreamerCmp(null); setStreamerCmpError(j?.error || '接口未返回有效数据') }
      })
      .catch((e) => {
        if (cancelled) return
        setStreamerCmp(null)
        setStreamerCmpError('数据接口调用失败：' + (e?.message || e) + '（请确认服务已重启并加载最新后端）')
      })
      .finally(() => { if (!cancelled) setStreamerCmpLoading(false) })
    return () => { cancelled = true }
  }, [view, opFilter, cmpA, cmpB])

  const operators = useMemo(() => (data?.operators || []), [data])
  const months = useMemo(() => (data?.months || []), [data])
  // 大航海「无数据」月份：B站按日导出不含该字段，显示为「无数据」而非 0，且不参与环比
  const seaMissingMonths = useMemo(() => data?.seaMissingMonths || [], [data])
  // 月份数据来源：daily=按日明细、snapshot=整月区间导入的快照、mixed=明细为主+快照补房间
  const monthSource = useMemo(() => (data?.monthSource || {}), [data])
  const monthLabel = (m) => {
    const s = monthSource[m]
    if (s === 'snapshot') return `${m} · 整月快照`
    if (s === 'mixed') return `${m} · 明细+快照`
    return m
  }

  // 过滤后按运营分组：同一运营的多个月份合并为一个区块，运营名只显示一次
  const groupedRows = useMemo(() => {
    if (!data?.rows) return []
    let rows = data.rows
    if (opFilter !== '__all__') rows = rows.filter(r => r.operator === opFilter)
    if (monthFilter !== '__all__') rows = rows.filter(r => r.month === monthFilter)
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.operator)) map.set(r.operator, [])
      map.get(r.operator).push(r)
    }
    let groups = [...map.entries()].map(([op, rs]) => ({
      op,
      rows: rs.slice().sort((a, b) => a.month.localeCompare(b.month)), // 组内月份自然升序
    }))
    const dir = sortDir === 'desc' ? -1 : 1
    if (sortKey === 'operator') {
      groups.sort((a, b) => a.op.localeCompare(b.op) * dir)
    } else if (sortKey === 'month') {
      groups.sort((a, b) => a.op.localeCompare(b.op)) // 按月份排序时运营名保持归并
    } else {
      // 按某指标对各运营聚合值排序（取该运营在过滤范围内的合计）
      const agg = (g) => g.rows.reduce((s, r) => s + (Number(r[sortKey]) || 0), 0)
      groups.sort((a, b) => (agg(a) - agg(b)) * dir)
    }
    return groups
  }, [data, opFilter, monthFilter, sortKey, sortDir])

  // 扁平化（供汇总/计数使用）
  const flatRows = useMemo(() => groupedRows.flatMap(g => g.rows), [groupedRows])

  // 汇总（按过滤范围聚合）
  const summary = useMemo(() => {
    const rows = flatRows
    const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    return {
      totalFlow: sum('totalFlow'),
      offlineFlow: sum('offlineFlow'),
      onlineFlow: sum('onlineFlow'),
      joined: sum('joined'),
      joinedOnline: sum('joinedOnline'),
      joinedOffline: sum('joinedOffline'),
      rooms: new Set(rows.map(r => r.operator)).size,
      months: new Set(rows.map(r => r.month)).size,
    }
  }, [flatRows])

  const changes = useMemo(() => (data?.changes || []), [data])
  // 按运营归并「主要变化」：每个运营一张卡片，运营名只出现一次，避免重复干扰对比
  const groupedChanges = useMemo(() => {
    if (!changes.length) return []
    const map = new Map()
    for (const c of changes) {
      if (!map.has(c.operator)) map.set(c.operator, [])
      map.get(c.operator).push(c)
    }
    // 运营排序：按该运营所有变化项的绝对波动合计降序（影响最大优先）
    const impact = (list) => list.reduce((s, c) => s + Math.abs(Number(c.to) - Number(c.from)), 0)
    return [...map.entries()]
      .map(([op, items]) => ({ op, items }))
      .sort((a, b) => impact(b.items) - impact(a.items))
  }, [changes])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  // 对比视图数据
  const compareData = useMemo(() => {
    if (!data || !cmpA) return null
    const ops = opFilter !== '__all__' ? [opFilter] : operators
    const rows = ops.map(op => {
      const a = data.byOperator?.[op]?.[cmpA]
      const b = cmpB ? data.byOperator?.[op]?.[cmpB] : null
      return { op, a, b }
    }).filter(r => r.a)
    return rows
  }, [data, cmpA, cmpB, opFilter, operators])

  return (
    <div className="space-y-4 p-4">
      {/* 顶部操作栏 */}
      <div className="fx-panel fx-enter flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-text">运营月度数据统计与分析</h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            按运营 × 自然月聚合：线上线下总流水 / 线下总流水 / 入会数（线上·线下），并补充开播、大航海、付费人数、日均流水与环比。实时同步移除已移出主播。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-bg/40 p-0.5">
            <button
              onClick={() => setView('detail')}
              className={`fx-pop rounded-md px-3 py-1.5 text-xs font-medium transition-all ${view === 'detail' ? 'bg-brand-600 text-white shadow-sm' : 'text-text-secondary hover:text-text'}`}
            >
              <BarChart3 size={13} className="mr-1 inline" />明细
            </button>
            <button
              onClick={() => setView('compare')}
              className={`fx-pop rounded-md px-3 py-1.5 text-xs font-medium transition-all ${view === 'compare' ? 'bg-brand-600 text-white shadow-sm' : 'text-text-secondary hover:text-text'}`}
            >
              <GitCompareArrows size={13} className="mr-1 inline" />对比
            </button>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="fx-pop flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-text hover:bg-bg/60 disabled:opacity-60"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
          </button>
        </div>
      </div>

      {error && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-text-secondary">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> 加载中…
        </div>
      )}

      {!loading && data && (
        <>
          {/* 筛选栏 */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-text-muted" />
              <span className="text-xs text-text-secondary">运营</span>
              <select
                value={opFilter}
                onChange={(e) => setOpFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-text outline-none focus:border-brand-500"
              >
                <option value="__all__">全部运营</option>
                {operators.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-text-muted" />
              <span className="text-xs text-text-secondary">月份</span>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-text outline-none focus:border-brand-500"
              >
                <option value="__all__">全部月份</option>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <span className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                环比
                <span className="font-semibold text-trend-up">↑ 上升</span>
                <span className="font-semibold text-trend-down">↓ 下降</span>
                <span className="font-semibold text-trend-flat">— 持平</span>
              </span>
              <span>共 {flatRows.length} 行 · {summary.rooms} 位运营 · {summary.months} 个月份</span>
            </span>
          </div>

          {/* 汇总卡片 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard icon={TrendingUp} label="线上线下总流水" value={fmtMoney(summary.totalFlow)} accent="bg-brand-50 text-brand-700" sub={`覆盖 ${summary.months} 个月`} />
            <SummaryCard icon={BarChart3} label="线下总流水" value={fmtMoney(summary.offlineFlow)} accent="bg-orange-50 text-orange-600" sub="房间号命中线下名册" />
            <SummaryCard icon={TrendingUp} label="线上总流水" value={fmtMoney(summary.onlineFlow)} accent="bg-blue-50 text-blue-600" sub="房间号不在线下名册" />
            <SummaryCard icon={ArrowRight} label="总入会数" value={fmtNum(summary.joined)} accent="bg-emerald-50 text-emerald-600" sub={`线上 ${summary.joinedOnline} / 线下 ${summary.joinedOffline}`} />
          </div>

          {/* 主要变化标注（最新月 vs 上一月），按运营归并 */}
          {changes.length > 0 && (
            <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" />
                <h3 className="text-sm font-bold text-text">主要数据变化（{data.latestMonth} 对比 {data.prevMonth}）</h3>
                <span className="text-[11px] text-text-muted">按绝对波动排序，取 Top {Math.min(changes.length, 12)}</span>
                <span className="ml-auto flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 font-semibold text-trend-up"><span className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-50">↑</span> {changes.filter(c => (c.pct || 0) > 0).length} 上升</span>
                  <span className="flex items-center gap-1 font-semibold text-trend-down"><span className="inline-flex h-5 w-5 items-center justify-center rounded bg-green-50">↓</span> {changes.filter(c => (c.pct || 0) < 0).length} 下降</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupedChanges.map(({ op, items }) => (
                  <div key={op} className="rounded-xl border border-border bg-bg/40 p-3">
                    <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                      <span className="text-[13px] font-bold text-text">{op}</span>
                      <span className="text-[11px] text-text-muted">{items.length} 项变化</span>
                    </div>
                    <div className="space-y-1.5">
                      {items.map((c, i) => {
                        const up = (c.pct || 0) > 0
                        const down = (c.pct || 0) < 0
                        const color = up ? 'text-trend-up' : down ? 'text-trend-down' : 'text-trend-flat'
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="truncate text-text-secondary">{c.label}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className={`font-semibold ${color}`}>{up ? '↑' : down ? '↓' : '—'}{fmtPct(c.pct)}</span>
                              <span className="text-text-muted">{fmtNum(c.from)} → {fmtNum(c.to)}</span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 明细表视图 */}
          {view === 'detail' && (
            <div className="fx-panel fx-enter overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
              <table className="w-full min-w-[1100px] text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-bg/40 text-[11px] font-semibold text-text-secondary">
                    <th className="sticky left-0 z-10 bg-bg/40 px-3 py-2.5 text-left">运营</th>
                    <th className="px-3 py-2.5 text-left">月份</th>
                    {COLUMNS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`cursor-pointer select-none px-3 py-2.5 ${col.align === 'right' ? 'text-right' : 'text-left'} hover:text-brand-600`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && <span className="text-[10px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groupedRows.map(({ op, rows }) => (
                    rows.map((r, ri) => (
                      <tr key={`${op}-${r.month}`} className="hover:bg-bg/30">
                        {ri === 0
                          ? <td rowSpan={rows.length} className="sticky left-0 z-10 bg-white px-3 py-2.5 font-semibold text-text align-top">{op}</td>
                          : null}
                        <td className="px-3 py-2.5 text-text-secondary">{r.month}</td>
                        {COLUMNS.map(col => {
                          const noData = col.key === 'seaCount' && seaMissingMonths.includes(r.month)
                          const mom = col.mom ? r.mom?.[col.mom] : undefined
                          return (
                            <td key={col.key} className={`px-3 py-2.5 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.strong ? 'font-bold text-text' : 'text-text'} ${col.mom ? 'whitespace-nowrap' : ''}`}>
                              {noData
                                ? <span className="text-text-muted" title="该月导出数据不含大航海字段">无数据</span>
                                : <span>{col.fmt(r[col.key])}</span>}
                              {col.mom && !noData && mom !== null && mom !== undefined && <span className="ml-1.5"><TrendBadge pct={mom} /></span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  ))}
                  {flatRows.length === 0 && (
                    <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-10 text-center text-text-muted">无符合条件的数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 对比视图 */}
          {view === 'compare' && (
            <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-text-secondary">对比月份</span>
                <select value={cmpA} onChange={(e) => setCmpA(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-text outline-none focus:border-brand-500">
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <ArrowRight size={14} className="text-text-muted" />
                <select value={cmpB} onChange={(e) => setCmpB(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-text outline-none focus:border-brand-500">
                  <option value="">（无）</option>
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <span className="text-[11px] text-text-muted">按当前运营筛选：{opFilter !== '__all__' ? opFilter : '全部运营'}</span>
              </div>

              {!compareData || compareData.length === 0 ? (
                <div className="py-10 text-center text-text-muted">请选择有效的对比月份</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-bg/40 text-[11px] font-semibold text-text-secondary">
                        <th className="px-3 py-2.5 text-left">运营</th>
                        <th className="px-3 py-2.5 text-left">指标</th>
                        <th className="px-3 py-2.5 text-right">{cmpA}</th>
                        <th className="px-3 py-2.5 text-right">{cmpB || '—'}</th>
                        <th className="px-3 py-2.5 text-right">变化</th>
                        <th className="px-3 py-2.5 text-right">环比</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {compareData.map(({ op, a, b }) => (
                        <CompareRow
                          key={op}
                          op={op}
                          a={a}
                          b={b}
                          hasB={!!cmpB}
                          seaMissingA={seaMissingMonths.includes(cmpA)}
                          seaMissingB={!!cmpB && seaMissingMonths.includes(cmpB)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 波动主播清单：单运营对比两月时，自动列出环比变化 > 阈值 的具体主播 */}
          {view === 'compare' && opFilter !== '__all__' && cmpA && cmpB && (
            <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Zap size={15} className="text-amber-500" />
                <h3 className="text-sm font-bold text-text">波动主播清单（单个主播环比 &gt; {CMP_THRESHOLD}%）</h3>
                <span className="text-[11px] text-text-muted">{cmpA} 对比 {cmpB} · 运营 {opFilter}</span>
                {streamerCmp?.seaMissingA && <span className="rounded bg-bg/60 px-1.5 py-0.5 text-[11px] text-text-muted">{cmpA} 大航海无数据</span>}
                {streamerCmp?.seaMissingB && <span className="rounded bg-bg/60 px-1.5 py-0.5 text-[11px] text-text-muted">{cmpB} 大航海无数据</span>}
                <span className="ml-auto flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 font-semibold text-trend-up"><span className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-50">↑</span> 上升</span>
                  <span className="flex items-center gap-1 font-semibold text-trend-down"><span className="inline-flex h-5 w-5 items-center justify-center rounded bg-green-50">↓</span> 下降</span>
                </span>
              </div>
              <div className="mb-3 -mt-1 text-[11px] text-text-muted">下列为单个主播（按房间号）的指标环比波动，非运营整体合计；仅统计并展示【总流水】【开播时长】【开播天数】三项，且剔除三项中任一不达标（总流水≤¥1000、开播时长≤15h、开播天数≤3天）的主播，仅保留三项均超门槛者。</div>

              {streamerCmpLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> 计算中…
                </div>
              ) : streamerCmpError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-[12px] text-amber-700">
                  {streamerCmpError}
                </div>
              ) : !streamerCmp || streamerCmp.changedRoomCount === 0 ? (
                <div className="py-6 text-center text-[12px] text-text-muted">
                  两个月份间无环比波动超过 {CMP_THRESHOLD}% 的单个主播
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="mb-1 text-[11px] text-text-muted">共 {streamerCmp.changedRoomCount} 位主播的 {streamerCmp.changes.length} 项指标波动超过阈值（主播列表按【总流水】浮动幅度从大到小降序，总流水为首要权重）</div>
                  {(streamerCmp.roomOrder && streamerCmp.roomOrder.length ? streamerCmp.roomOrder : Object.keys(streamerCmp.byRoom)).map((room) => {
                    const items = streamerCmp.byRoom[room] || []
                    return (
                    <div key={room} className="rounded-xl border border-border bg-bg/40 p-3">
                      <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                        <span className="text-[13px] font-bold text-text">房间号 {room}{streamerCmp?.nickMap?.[room] ? <span className="ml-1 font-medium text-text-secondary">（{streamerCmp.nickMap[room]}）</span> : null}{streamerCmp?.empStatusMap?.[room] ? <EmpStatusBadge status={streamerCmp.empStatusMap[room]} /> : null}</span>
                        <span className="text-[11px] text-text-muted">{items.length} 项变化</span>
                      </div>
                      <div className="space-y-1.5">
                        {items.map((c, i) => {
                          const up = c.direction === 'up'
                          const color = up ? 'text-trend-up' : 'text-trend-down'
                          const fmt = colFmt[c.metricKey] || fmtNum
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="truncate text-text-secondary">{c.metricLabel}</span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className={`font-semibold ${color}`}>{up ? '↑' : '↓'}{fmtPct(c.pct)}</span>
                                <span className="text-text-muted">{fmt(c.from)} → {fmt(c.to)}</span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EmpStatusBadge({ status }) {
  const cls =
    status === '线上' ? 'bg-blue-50 text-blue-600' :
    status === '线下在职' ? 'bg-emerald-50 text-emerald-600' :
    status === '线下离职' ? 'bg-red-50 text-red-600' :
    'bg-slate-100 text-slate-600'
  return (
    <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{status}</span>
  )
}

function CompareRow({ op, a, b, hasB, seaMissingA = false, seaMissingB = false }) {
  const metrics = [
    { key: 'totalFlow', label: '线上线下总流水', fmt: fmtMoney },
    { key: 'offlineFlow', label: '线下总流水', fmt: fmtMoney },
    { key: 'onlineFlow', label: '线上总流水', fmt: fmtMoney },
    { key: 'joined', label: '入会数', fmt: fmtNum },
    { key: 'joinedOnline', label: '线上入会', fmt: fmtNum },
    { key: 'joinedOffline', label: '线下入会', fmt: fmtNum },
    { key: 'roomCount', label: '主播数', fmt: fmtNum },
    { key: 'openDays', label: '开播天数', fmt: fmtNum },
    { key: 'broadcastHours', label: '开播时长(h)', fmt: fmtNum },
    { key: 'seaCount', label: '大航海', fmt: fmtNum },
    { key: 'payCount', label: '付费人数', fmt: fmtNum },
    { key: 'dailyAvg', label: '日均流水', fmt: fmtMoney },
  ]
  return (
    <>
      {metrics.map((m, idx) => {
        // 大航海缺数据的月份：两侧都不显示数值与环比（任一侧缺失即整行不可用）
        const noData = m.key === 'seaCount' && (seaMissingA || seaMissingB)
        const va = Number(a[m.key]) || 0
        const vb = b ? (Number(b[m.key]) || 0) : null
        const delta = hasB && vb !== null && !noData ? va - vb : null
        const pct = hasB && vb !== null ? (vb === 0 ? (va > 0 ? 100 : 0) : ((va - vb) / vb) * 100) : null
        return (
          <tr key={m.key} className="hover:bg-bg/30">
            {idx === 0
              ? <td rowSpan={metrics.length} className="border-r border-border px-3 py-2 align-top font-semibold text-text">{op}</td>
              : null}
            <td className="px-3 py-1.5 text-text-secondary">{m.label}</td>
            <td className="px-3 py-1.5 text-right font-medium text-text">
              {noData ? <span className="text-text-muted" title="该月导出数据不含大航海字段">无数据</span> : m.fmt(va)}
            </td>
            <td className="px-3 py-1.5 text-right text-text-secondary">
              {noData ? <span className="text-text-muted">无数据</span> : hasB ? m.fmt(vb) : '—'}
            </td>
            <td className="px-3 py-1.5 text-right font-medium">
              {delta === null ? <span className="text-text-muted">—</span> : <DeltaText delta={delta} fmt={m.fmt} />}
            </td>
            <td className="px-3 py-1.5 text-right">
              {pct === null ? <span className="text-text-muted">—</span> : <TrendBadge pct={pct} />}
            </td>
          </tr>
        )
      })}
    </>
  )
}
