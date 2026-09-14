import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Lock, Info, ArrowUpDown,
} from 'lucide-react'
import { Money } from './Money'
// 涨跌统一口径：国内「红涨绿跌」——上升红、下降绿、持平灰
import { TrendBadge } from '../lib/trend'

const ADMIN_TOKEN_FALLBACK = 'fbc1985757d7849a22e64c672d3120a6'

function adminToken() {
  try { return localStorage.getItem('sync_admin_token') || ADMIN_TOKEN_FALLBACK } catch { return ADMIN_TOKEN_FALLBACK }
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function pctText(p) {
  return p === null || p === undefined ? '—' : `${Number(p).toFixed(1)}%`
}

/**
 * 完成率配色（与涨跌色板区分开）：
 *   达标（≥100%）→ 红色：国内习惯红=正向/达成
 *   接近达标（≥80%）→ 橙色：临门一脚
 *   差距较大（<80%）→ 蓝色：进行中
 *   未设目标        → 中性灰
 */
function progressTheme(p, passed) {
  if (p === null || p === undefined) {
    return { bar: 'bg-slate-200', text: 'text-text-muted', tag: 'bg-slate-100 text-text-secondary' }
  }
  if (passed || p >= 100) return { bar: 'bg-trend-up', text: 'text-trend-up', tag: 'bg-red-50 text-trend-up' }
  if (p >= 80) return { bar: 'bg-warning', text: 'text-amber-600', tag: 'bg-amber-50 text-amber-700' }
  return { bar: 'bg-brand-400', text: 'text-brand-700', tag: 'bg-brand-50 text-brand-700' }
}

function StatCard({ label, value, sub, accent = 'text-text', children }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`mt-1 text-xl font-bold lg:text-2xl ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-text-muted">{sub}</div>}
      {children}
    </div>
  )
}

/** 细进度条：宽度按完成率（超 100% 截断），颜色按档位 */
function MiniProgress({ pct, theme }) {
  const w = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${theme.bar}`} style={{ width: `${w}%` }} />
    </div>
  )
}

function SortTh({ label, sortKey, activeKey, dir, onSort, align = 'right' }) {
  const active = activeKey === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} hover:text-brand-600`}
    >
      <span className={`inline-flex items-center gap-1 ${active ? 'text-brand-700' : ''}`}>
        {label}
        <ArrowUpDown size={10} className={active ? 'opacity-100' : 'opacity-30'} />
        {active && <span className="text-[9px]">{dir === 'desc' ? '▼' : '▲'}</span>}
      </span>
    </th>
  )
}

/**
 * 运营 KPI 月度完成汇总
 * 每个自然月过完后，按「运营数据看板 → 卡片管理」里设置的 KPI 值自动汇总每位运营的完成情况。
 */
export function KpiMonthlySection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [month, setMonth] = useState('')          // '' = 当月实时
  const [sortKey, setSortKey] = useState('totalFlow')
  const [sortDir, setSortDir] = useState('desc')
  const [settling, setSettling] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('./api/kpi-monthly', { cache: 'no-store' })
      const j = await res.json()
      if (j?.ok) setData(j)
      else { setData(null); setError(j?.error || '暂无 KPI 月度汇总数据') }
    } catch (e) {
      setError('读取 KPI 月度汇总失败：' + e.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const options = useMemo(() => {
    if (!data) return []
    const settled = (data.settled || []).map(s => ({
      value: s.month,
      label: `${s.month}${s.frozen ? ' · 已冻结' : ' · 结算中'}`,
    }))
    return [{ value: '', label: `${data.currentMonth} · 当月实时` }, ...settled]
  }, [data])

  const current = useMemo(() => {
    if (!data) return null
    if (!month) return data.live
    return data.archive?.[month] || null
  }, [data, month])

  const rows = useMemo(() => {
    const list = [...(current?.rows || [])]
    const dir = sortDir === 'desc' ? -1 : 1
    const val = (x) => {
      if (sortKey === 'totalProgress') return x.totalProgress === null ? -1 : x.totalProgress
      if (sortKey === 'offlineProgress') return x.offlineProgress === null ? -1 : x.offlineProgress
      if (sortKey === 'totalFlow') return x.totalFlow
      if (sortKey === 'offlineFlow') return x.offlineFlow
      if (sortKey === 'passed') return (x.totalPass ? 1 : 0) + (x.offlinePass ? 1 : 0)
      return x.totalFlow
    }
    list.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va !== vb) return (va - vb) * dir
      return String(a.operator).localeCompare(String(b.operator), 'zh-CN')
    })
    return list
  }, [current, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  async function resettle() {
    if (!month) return
    setSettling(true)
    setToast('')
    try {
      const res = await fetch('./api/kpi-monthly/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken() },
        body: JSON.stringify({ month, force: true }),
      })
      const j = await res.json()
      if (!j?.ok) throw new Error(j?.error || '结算失败')
      setToast(`已重新结算 ${month}`)
      await load()
    } catch (e) {
      setToast('结算失败：' + e.message)
    } finally {
      setSettling(false)
      setTimeout(() => setToast(''), 3000)
    }
  }

  const summary = current?.summary || null
  const isLive = !month
  const frozenAt = current?.settledAt ? new Date(current.settledAt).toLocaleString('zh-CN') : ''

  return (
    <div className="fx-panel fx-enter rounded-xl border border-border bg-white p-4 shadow-sm" style={{ animationDelay: '400ms' }}>
      {/* 头部 */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <CalendarCheck size={18} className="text-brand-600" />
          月度 KPI 完成汇总
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
            自然月结束后自动结算
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-text outline-none focus:border-brand-500"
          >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!isLive && (
            <button
              onClick={resettle}
              disabled={settling}
              className="flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
              title="按当前 KPI 设置重算该月（会覆盖已冻结快照）"
            >
              {settling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 重新结算
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新
          </button>
        </div>
      </div>

      {/* 口径说明 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-bg/60 px-3 py-2 text-[10px] text-text-muted">
        <span className="inline-flex items-center gap-1"><Info size={11} />
          {isLive
            ? '当月为实时预览，随抓取数据变动；自然月结束后自动归档结算。'
            : <>结算时间 {frozenAt}{current?.frozen ? ' · 已冻结（历史不再自动改写）' : ` · 结算中（次月 ${data?.settleDelayDays ?? 3} 天内持续刷新，兼容 T+N 延迟结算）`}</>}
        </span>
        {current?.frozen && <span className="inline-flex items-center gap-1"><Lock size={11} />快照已冻结</span>}
        <span className="ml-auto inline-flex items-center gap-2">
          <span>环比</span>
          <span className="font-semibold text-trend-up">↑ 上升</span>
          <span className="font-semibold text-trend-down">↓ 下降</span>
          <span className="font-semibold text-trend-flat">— 持平</span>
        </span>
      </div>

      {error && !loading && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-secondary">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> 加载中…
        </div>
      )}

      {data && current && summary && (
        <>
          {/* 汇总卡 */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="达标运营"
              value={<>{summary.passedCount}<span className="text-sm font-medium text-text-muted"> / {summary.evaluatedCount}</span></>}
              sub={`参与汇总 ${summary.operatorCount} 人（未设 KPI 不计入考核）`}
              accent="text-trend-up"
            />
            <StatCard
              label="团队总流水完成率"
              value={pctText(summary.totalProgress)}
              sub={<><Money value={summary.totalFlow} /> / <Money value={summary.totalKpi} /></>}
              accent={progressTheme(summary.totalProgress, (summary.totalProgress ?? 0) >= 100).text}
            >
              <MiniProgress pct={summary.totalProgress} theme={progressTheme(summary.totalProgress, (summary.totalProgress ?? 0) >= 100)} />
            </StatCard>
            <StatCard
              label="团队线下完成率"
              value={pctText(summary.offlineProgress)}
              sub={<><Money value={summary.offlineFlow} /> / <Money value={summary.offlineKpi} /></>}
              accent={progressTheme(summary.offlineProgress, (summary.offlineProgress ?? 0) >= 100).text}
            >
              <MiniProgress pct={summary.offlineProgress} theme={progressTheme(summary.offlineProgress, (summary.offlineProgress ?? 0) >= 100)} />
            </StatCard>
            <StatCard
              label="单项达标人数"
              value={<>{summary.totalPassCount}<span className="text-sm font-medium text-text-muted"> / {summary.offlinePassCount}</span></>}
              sub="总流水达标 / 线下达标"
              accent="text-text"
            />
          </div>

          {/* 明细表 */}
          <div className="overflow-x-auto bili-scrollbar">
            <table className="w-full min-w-[1000px] text-xs">
              <thead>
                <tr className="border-b border-border bg-bg/40 text-[11px] font-semibold text-text-secondary">
                  <th className="sticky left-0 z-10 bg-bg/40 px-3 py-2.5 text-left">运营经纪人</th>
                  <SortTh label="线上线下总流水" sortKey="totalFlow" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="总完成率" sortKey="totalProgress" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-3 py-2.5 text-right">总流水环比</th>
                  <SortTh label="线下总流水" sortKey="offlineFlow" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="线下完成率" sortKey="offlineProgress" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-3 py-2.5 text-right">线下环比</th>
                  <th className="px-3 py-2.5 text-right">主播数</th>
                  <th className="px-3 py-2.5 text-right">入会数</th>
                  <SortTh label="综合评定" sortKey="passed" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => {
                  const tTheme = progressTheme(r.totalProgress, r.totalPass)
                  const oTheme = progressTheme(r.offlineProgress, r.offlinePass)
                  return (
                    <tr key={r.operator} className="hover:bg-bg/30">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2.5 font-semibold text-text">
                        {r.operator}
                        {r.hidden && <span className="ml-1 text-[10px] font-normal text-text-muted">（卡片已隐藏）</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-text">
                        <Money value={r.totalFlow} />
                        <span className="ml-1 text-[10px] text-text-muted">/ <Money value={r.totalKpi} /></span>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-bold ${tTheme.text}`}>{pctText(r.totalProgress)}</td>
                      <td className="px-3 py-2.5 text-right"><TrendBadge pct={r.momTotalFlow} /></td>
                      <td className="px-3 py-2.5 text-right font-medium text-text">
                        <Money value={r.offlineFlow} />
                        <span className="ml-1 text-[10px] text-text-muted">/ <Money value={r.offlineKpi} /></span>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-bold ${oTheme.text}`}>{pctText(r.offlineProgress)}</td>
                      <td className="px-3 py-2.5 text-right"><TrendBadge pct={r.momOfflineFlow} /></td>
                      <td className="px-3 py-2.5 text-right text-text-secondary">{fmtNum(r.roomCount)}</td>
                      <td className="px-3 py-2.5 text-right text-text-secondary">{fmtNum(r.joined)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {!r.hasKpi ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-text-secondary">未设目标</span>
                        ) : r.totalPass && r.offlinePass ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-trend-up">
                            <CheckCircle2 size={10} />双项达标
                          </span>
                        ) : r.passed ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-trend-up">
                            <CheckCircle2 size={10} />{r.totalPass ? '总流水达标' : '线下达标'}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">未达标</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-text-muted">该月份暂无 KPI 汇总数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.pendingMonths?.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              以下历史月份尚未归档，将在下次自动结算（每日 00:10）时补上：{data.pendingMonths.join('、')}
            </div>
          )}

          {toast && (
            <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2 text-[11px] text-text-secondary">{toast}</div>
          )}
        </>
      )}
    </div>
  )
}
