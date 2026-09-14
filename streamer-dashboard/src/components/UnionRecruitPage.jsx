import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users, UserCheck, Building2, HelpCircle, ChevronDown, ChevronRight, Clock, AlertTriangle, Download, Calendar, BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const ADMIN_TOKEN_KEY = 'sync_admin_token'
const BUILTIN_ADMIN_TOKEN = 'fbc1985757d7849a22e64c672d3120a6'
const adminToken = () => {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || BUILTIN_ADMIN_TOKEN } catch { return BUILTIN_ADMIN_TOKEN }
}

const RANGE_OPTIONS = [
  { key: 'thisMonth', label: '本月' },
  { key: '7days', label: '近7日' },
  { key: '30days', label: '近30日' },
  { key: 'all', label: '全部' },
]

function formatTs(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ts
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return ts }
}

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

// 入会类型配色：线上=蓝，线下=橙，未知=灰
const TYPE_STYLE = {
  online: 'bg-brand-50 text-brand-700',
  offline: 'bg-orange-50 text-orange-600',
  unknown: 'bg-slate-100 text-slate-500',
}
const TYPE_LABEL = { online: '线上', offline: '线下', unknown: '未知' }

export function UnionRecruitPage() {
  const [data, setData] = useState(null) // 已解析的统计结果
  const [range, setRange] = useState('thisMonth')
  const [month, setMonth] = useState(null) // 指定历史月份（如 '2026-07'），优先于 range
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncMsg, setSyncMsg] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [query, setQuery] = useState('')

  async function fetchStats(currentRange = range, currentMonth = month) {
    setLoading(true)
    setError('')
    try {
      const qs = currentMonth ? `month=${encodeURIComponent(currentMonth)}` : `range=${currentRange}`
      const res = await fetch(`/api/union-recruit-stats?${qs}`)
      const j = await res.json()
      if (j && j.ok) setData(j)
      else setData(null) // 暂无数据
    } catch (e) {
      setError('读取统计接口失败：' + e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [range, month])

  async function syncNow(syncRange = '7days') {
    if (syncing) return
    setSyncing(true)
    setError('')
    const rangeLabel = RANGE_OPTIONS.find(r => r.key === syncRange)?.label || syncRange
    setSyncMsg(`同步中：正在打开 B站后台「入退会管理」抓取【${rangeLabel}】入会数据，约需 30~60 秒，请稍候…`)
    try {
      const res = await fetch('/api/union-recruit-stats', {
        method: 'POST',
        headers: {
          'x-admin-token': adminToken(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ range: syncRange }),
      })
      const j = await res.json()
      if (j && j.ok) {
        setData(j)
        setMonth(null)
        setRange(syncRange)
        setSyncMsg(`已更新【${j.rangeLabel}】：共 ${j.totalJoined} 人已入会（线上 ${j.onlineTotal} / 线下 ${j.offlineTotal} / 未知 ${j.unknownTotal}），归档 ${j.archiveTotal} 条`)
      } else {
        setSyncMsg('')
        setError(j?.error || '同步失败，未返回有效结果')
      }
    } catch (e) {
      setSyncMsg('')
      setError('同步请求失败：' + e.message + '（若超时，请在「数据自动同步」确认 B站 已登录后重试）')
    } finally {
      setSyncing(false)
    }
  }

  function toggle(name) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const operators = useMemo(() => {
    if (!data?.operators) return []
    const q = query.trim()
    if (!q) return data.operators
    return data.operators.filter(o => (o.operator || '').includes(q))
  }, [data, query])

  const hasData = !!data && Array.isArray(data.operators) && data.operators.length > 0
  const rangeLabel = useMemo(() => month || RANGE_OPTIONS.find(r => r.key === range)?.label || range, [range, month])

  // 月度趋势图数据（线上/线下堆叠）
  const trendData = useMemo(() => {
    if (!data?.monthlyTrend) return []
    return data.monthlyTrend.map(m => ({ month: m.month, 线上: m.online, 线下: m.offline, 未知: m.unknown, 总入会: m.total }))
  }, [data])

  const availableMonths = useMemo(() => (data?.availableMonths || []).slice().reverse(), [data])

  return (
    <div className="space-y-4 p-4">
      {/* 顶部操作栏 */}
      <div className="fx-panel fx-enter flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-text">入会招募统计</h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            数据来源：B站后台「主播管理 → 入退会管理 → 入会管理」导出表格，仅统计「已入会」记录；线上/线下以系统名册的房间号判定
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.generatedAt && (
            <span className="hidden items-center gap-1 text-[11px] text-text-muted sm:flex">
              <Clock size={12} /> 生成于 {formatTs(data.generatedAt)}
            </span>
          )}
          <button
            onClick={() => syncNow('thisMonth')}
            disabled={syncing}
            className={`fx-pop flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition-all ${
              syncing ? 'cursor-not-allowed bg-brand-400 text-white' : 'bg-white text-text hover:bg-bg/60 border border-border'
            }`}
          >
            <Calendar size={15} />
            {syncing ? '同步中…' : '补抓本月'}
          </button>
          <button
            onClick={() => syncNow('7days')}
            disabled={syncing}
            className={`fx-pop flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all ${
              syncing ? 'cursor-not-allowed bg-brand-400' : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '同步中…' : '立即同步（近7日）'}
          </button>
        </div>
      </div>

      {/* 状态提示 */}
      {syncMsg && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
          <Download size={14} className="mt-0.5 shrink-0" /> {syncMsg}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* 数据范围切换 + 历史月份选择 */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { setMonth(null); setRange(opt.key) }}
              disabled={loading}
              className={`fx-pop rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                !month && range === opt.key
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-bg/60 text-text-secondary hover:bg-bg hover:text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" />
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Calendar size={13} />
            历史月份
            <select
              value={month || ''}
              onChange={(e) => setMonth(e.target.value || null)}
              disabled={loading}
              className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-text outline-none focus:border-brand-500"
            >
              <option value="">按范围（本月/近7日…）</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="text-[11px] text-text-muted">
          当前范围：<span className="font-medium text-text">{rangeLabel}</span>
          {data?.archiveTotal != null && <span className="ml-3">历史归档共 {data.archiveTotal} 条</span>}
          {data?.newlyAdded != null && data.newlyAdded > 0 && <span className="ml-3 text-brand-700">本次新增 {data.newlyAdded} 条</span>}
        </div>
      </div>

      {/* 加载态 */}
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-text-secondary">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> 加载中…
        </div>
      )}

      {/* 空态 */}
      {!loading && !hasData && !error && (
        <div className="fx-panel fx-enter flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-white py-16 text-center">
          <Users size={36} className="text-text-muted" />
          <div className="text-sm text-text-secondary">暂无统计结果</div>
          <p className="max-w-md text-xs text-text-muted">
            尚未抓取过入退会数据。点击「补抓本月」可一次性补全本月数据；点击「立即同步（近7日）」只抓取最近 7 天并合并去重。
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => syncNow('thisMonth')}
              disabled={syncing}
              className="fx-pop flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-text hover:bg-bg/60 disabled:opacity-60"
            >
              <Calendar size={15} className={syncing ? 'animate-spin' : ''} /> 补抓本月
            </button>
            <button
              onClick={() => syncNow('7days')}
              disabled={syncing}
              className="fx-pop flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> 立即同步（近7日）
            </button>
          </div>
        </div>
      )}

      {/* 数据区 */}
      {!loading && hasData && (
        <>
          {/* 汇总卡片 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard icon={UserCheck} label="总入会数" value={data.totalJoined} accent="bg-brand-50 text-brand-700" sub={`已入会（${data.rangeLabel || rangeLabel}）`} />
            <SummaryCard icon={Users} label="线上入会数" value={data.onlineTotal} accent="bg-blue-50 text-blue-600" sub="房间号不在线下名册" />
            <SummaryCard icon={Building2} label="线下入会数" value={data.offlineTotal} accent="bg-orange-50 text-orange-600" sub="房间号命中线下名册" />
            <SummaryCard icon={HelpCircle} label="未知入会数" value={data.unknownTotal} accent="bg-slate-100 text-slate-500" sub="表格未解析到房间号" />
          </div>

          {/* 月度入会趋势（覆盖全部历史月份，含 7 月） */}
          {trendData.length > 0 && (
            <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 size={15} className="text-brand-600" />
                <h3 className="text-sm font-bold text-text">月度入会趋势</h3>
                <span className="text-[11px] text-text-muted">按自然月聚合「已入会」人数（线上 / 线下），覆盖 {trendData.length} 个月</span>
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v, name) => [v, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="线上" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="线下" stackId="a" fill="#f97316" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                {trendData.map(t => (
                  <span key={t.month}>{t.month}：<span className="font-medium text-text">{t.总入会}</span> 人（线上 {t.线上} / 线下 {t.线下}）</span>
                ))}
              </div>
            </div>
          )}

          {/* 搜索 */}
          <div className="flex items-center justify-between gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按运营人员筛选…"
              className="w-56 rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-text outline-none focus:border-brand-500"
            />
            <span className="text-xs text-text-muted">共 {operators.length} 位运营人员</span>
          </div>

          {/* 运营人员明细表 */}
          <div className="fx-panel fx-enter overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <div className="grid grid-cols-[1.4fr_repeat(4,1fr)_auto] min-w-[560px] items-center gap-2 border-b border-border bg-bg/40 px-4 py-2.5 text-[11px] font-semibold text-text-secondary">
              <div>运营人员</div>
              <div className="text-right">线上</div>
              <div className="text-right">线下</div>
              <div className="text-right">未知</div>
              <div className="text-right">总入会</div>
              <div className="text-center">明细</div>
            </div>

            <div className="divide-y divide-border">
              {operators.map((op) => {
                const isOpen = expanded.has(op.operator)
                const list = op.streamers || []
                return (
                  <div key={op.operator}>
                    <div className="grid grid-cols-[1.4fr_repeat(4,1fr)_auto] min-w-[560px] items-center gap-2 px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 font-semibold text-text">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700">
                          {(op.operator || '?').slice(0, 1)}
                        </span>
                        {op.operator}
                      </div>
                      <div className="text-right font-medium text-blue-600">{op.online}</div>
                      <div className="text-right font-medium text-orange-600">{op.offline}</div>
                      <div className="text-right font-medium text-slate-500">{op.unknown}</div>
                      <div className="text-right font-bold text-text">{op.total}</div>
                      <div className="text-center">
                        <button
                          onClick={() => toggle(op.operator)}
                          className="fx-pop flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {list.length}
                        </button>
                      </div>
                    </div>

                    {/* 展开明细 */}
                    {isOpen && (
                      <div className="bili-scrollbar max-h-64 overflow-y-auto border-t border-border bg-bg/30 px-4 py-2">
                        {list.length === 0 && <div className="py-2 text-xs text-text-muted">无明细</div>}
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-text-muted">
                              <th className="py-1 pr-2 font-medium">主播</th>
                              <th className="py-1 pr-2 font-medium">房间号</th>
                              <th className="py-1 pr-2 font-medium">类型</th>
                              <th className="py-1 pr-2 font-medium">状态</th>
                              <th className="py-1 font-medium">入会时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((s, i) => (
                              <tr key={i} className="border-t border-border/60">
                                <td className="py-1 pr-2 text-text">{s.name || '—'}</td>
                                <td className="py-1 pr-2 font-mono text-text-secondary">{s.room || '—'}</td>
                                <td className="py-1 pr-2">
                                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TYPE_STYLE[s.type] || TYPE_STYLE.unknown}`}>
                                    {TYPE_LABEL[s.type] || '未知'}
                                  </span>
                                </td>
                                <td className="py-1 pr-2 text-text-secondary">{s.status || '—'}</td>
                                <td className="py-1 text-text-muted">{s.time || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
