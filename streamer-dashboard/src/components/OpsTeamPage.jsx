import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Users, UserPlus, UserMinus, RefreshCw, Activity, GitCompareArrows, AlertTriangle,
  CheckCircle2, Clock, Radio, Wallet, TrendingUp, ShieldCheck,
} from 'lucide-react'

const ADMIN_TOKEN_KEY = 'sync_admin_token'
const adminToken = () => {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || 'fbc1985757d7849a22e64c672d3120a6' } catch { return 'fbc1985757d7849a22e64c672d3120a6' }
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return '¥' + Math.round(v).toLocaleString('zh-CN')
}
function fmtNum(n) {
  const v = Number(n) || 0
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}
function fmtTime(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d)) return '—'
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function StatCard({ icon: Icon, label, value, accent, sub }) {
  return (
    <div className="fx-panel flex items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
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

function StatusBadge({ status }) {
  if (status === 'active') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600"><CheckCircle2 size={12} />在职</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"><XCircle size={12} />已离</span>
}

function ChangeBadge({ type }) {
  const map = {
    add: { cls: 'bg-emerald-50 text-emerald-600', label: '新增', icon: UserPlus },
    reactivate: { cls: 'bg-sky-50 text-sky-600', label: '重新激活', icon: RefreshCw },
    remove: { cls: 'bg-red-50 text-red-600', label: '减少', icon: UserMinus },
    'batch-add': { cls: 'bg-violet-50 text-violet-600', label: '批量新增', icon: UserPlus },
    'batch-remove': { cls: 'bg-rose-50 text-rose-600', label: '批量移除', icon: UserMinus },
  }
  const m = map[type] || { cls: 'bg-slate-100 text-slate-500', label: type, icon: Activity }
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      <Icon size={12} />{m.label}
    </span>
  )
}

export function OpsTeamPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [lastSync, setLastSync] = useState('')
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { return '' } })
  const [addText, setAddText] = useState('')
  const [removeText, setRemoveText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const esRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('./api/ops-team')
      const j = await res.json()
      if (j.ok) {
        setData(j)
        setLastSync(j.generatedAt)
        setError('')
      } else {
        setError(j.error || '加载失败')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // 实时：订阅 SSE（ops-team 精准推送，data-updated 兜底），并 60s 轮询 + 可见性刷新
  useEffect(() => {
    load()
    let es
    try {
      es = new EventSource('./api/events')
      esRef.current = es
      const onMsg = () => { setLive(true); load() }
      es.addEventListener('ops-team', onMsg)
      es.addEventListener('data-updated', onMsg)
      es.onopen = () => setLive(true)
      es.onerror = () => { setLive(false) /* EventSource 自动重连 */ }
    } catch { /* ignore */ }
    const timer = setInterval(load, 60000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (es) es.close()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  const doBatch = async () => {
    if (!adminToken) { setMsg('⚠️ 请先填写管理员口令'); return }
    if (!addText.trim() && !removeText.trim()) { setMsg('请填写要新增或移除的运营人员（每行一个）'); return }
    setBusy(true); setMsg('')
    try {
      const res = await fetch('./api/ops-team/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ add: addText, remove: removeText }),
      })
      const j = await res.json()
      if (j.ok) {
        setMsg(`✓ 已应用：新增 ${j.added} 人 / 移除 ${j.removed} 人${j.changes.length ? `（实际变动 ${j.changes.length} 项）` : ''}`)
        setAddText(''); setRemoveText('')
        load()
      } else {
        setMsg('✗ ' + (j.error || '批量调整失败'))
      }
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const doSyncNow = async () => {
    if (!adminToken) { setMsg('⚠️ 请先填写管理员口令'); return }
    setBusy(true); setMsg('')
    try {
      const res = await fetch('./api/ops-team/sync', { method: 'POST', headers: { 'x-admin-token': adminToken } })
      const j = await res.json()
      if (j.ok) {
        setMsg(`✓ 已触发一次同步检测：当前在册 ${j.current} 人，本次变动 ${j.changes} 项`)
        load()
      } else setMsg('✗ ' + (j.error || '同步失败'))
    } catch (e) { setMsg('✗ ' + e.message) } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="p-6 text-sm text-text-muted">加载运营团队数据中…</div>
  }
  if (error) {
    return <div className="m-4 rounded-md bg-red-50 px-4 py-2 text-xs text-danger">数据加载失败：{error}</div>
  }
  if (!data) return null

  const { headcount, operators, performanceSummary, changes, changelog, pending, graceMinutes, currentMonth } = data
  const ps = performanceSummary || {}

  return (
    <div className="space-y-5 p-4 pb-10">
      {/* 头部实时状态 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text">运营团队变动看板</h2>
          <p className="text-[12px] text-text-muted">
            实时同步运营人员新增 / 减少 · 当前统计月 <span className="font-semibold text-text">{currentMonth}</span>
            {' · '}最近同步 {fmtTime(lastSync)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            <Radio size={12} className={live ? 'animate-pulse' : ''} />{live ? '实时连接' : '连接中…'}
          </span>
          <button onClick={load} className="fx-pop inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-slate-50">
            <RefreshCw size={13} />刷新
          </button>
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Users} label="在职人数" value={fmtNum(headcount.active)} accent="bg-brand-50 text-brand-600" sub={`团队共 ${headcount.total} 人`} />
        <StatCard icon={UserPlus} label="本月新增" value={fmtNum(changes.addedThisMonth)} accent="bg-emerald-50 text-emerald-600" sub="自动检测" />
        <StatCard icon={UserMinus} label="本月减少" value={fmtNum(changes.removedThisMonth)} accent="bg-red-50 text-red-600" sub="宽限期达标后" />
        <StatCard icon={Wallet} label="在职总流水" value={fmtMoney(ps.totalFlow)} accent="bg-amber-50 text-amber-600" sub={`线下 ${fmtMoney(ps.offlineFlow)}`} />
        <StatCard icon={TrendingUp} label="人均流水" value={fmtMoney(ps.avgFlowPerOperator)} accent="bg-violet-50 text-violet-600" sub={`管理主播 ${fmtNum(ps.roomCount)} 名`} />
      </div>

      {/* 团队结构 */}
      <div className="fx-panel overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <GitCompareArrows size={16} className="text-brand-600" />
          <h3 className="text-[14px] font-semibold text-text">团队结构（按运营）</h3>
          <span className="ml-auto text-[11px] text-text-muted">{operators.length} 名运营 · 含已离 {headcount.left} 人</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-[11px] text-text-secondary">
                <th className="px-3 py-2 font-medium">运营</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 text-right font-medium">主播数</th>
                <th className="px-3 py-2 text-right font-medium">线下/线上</th>
                <th className="px-3 py-2 text-right font-medium">总流水</th>
                <th className="px-3 py-2 text-right font-medium">线下流水</th>
                <th className="px-3 py-2 text-right font-medium">入会数</th>
                <th className="px-3 py-2 font-medium">加入</th>
                <th className="px-3 py-2 font-medium">离开</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.name} className="border-b border-border/60 last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-text">{o.name}</td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-text">{fmtNum(o.metrics.roomCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtNum(o.metrics.offlineRoomCount)}/{fmtNum(o.metrics.onlineRoomCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-text">{fmtMoney(o.metrics.totalFlow)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text">{fmtMoney(o.metrics.offlineFlow)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text">{fmtNum(o.metrics.joined.total)}</td>
                  <td className="px-3 py-2 text-[11px] text-text-muted">{fmtTime(o.joinedAt)}</td>
                  <td className="px-3 py-2 text-[11px] text-text-muted">{o.leftAt ? fmtTime(o.leftAt) : '—'}</td>
                </tr>
              ))}
              {!operators.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-text-muted">暂无运营人员数据，下次抓取后将自动同步</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 宽限期候选 */}
      {pending && pending.length > 0 && (
        <div className="fx-panel rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-amber-700">
            <Clock size={15} />宽限期候选（{pending.length} 人 · {graceMinutes} 分钟内未出现将标记离职）
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <span key={p.name} className="rounded-lg bg-white px-2.5 py-1 text-[12px] text-text shadow-sm ring-1 ring-amber-200">
                {p.name} <span className="text-text-muted">· 已等待 {p.elapsedMin} 分</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 变动记录 */}
      <div className="fx-panel overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Activity size={16} className="text-brand-600" />
          <h3 className="text-[14px] font-semibold text-text">变动记录</h3>
          <span className="ml-auto text-[11px] text-text-muted">实时更新 · 最近 {changelog.length} 条</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {changelog.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-text-muted">暂无变动记录</div>}
          <ul className="divide-y divide-border/60">
            {changelog.map((c, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                <ChangeBadge type={c.type} />
                <span className="font-medium text-text">{c.name}</span>
                <span className="text-[12px] text-text-muted">{c.note || ''}</span>
                <span className="ml-auto text-[11px] text-text-muted">{fmtTime(c.ts)} · {c.by === 'admin' ? '手动' : '自动'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 批量调整（管理员） */}
      <div className="fx-panel rounded-xl border border-border bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand-600" />
          <h3 className="text-[14px] font-semibold text-text">批量调整运营人员</h3>
          <span className="ml-auto text-[11px] text-text-muted">管理员可用 · 立即生效，绕过宽限期</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-secondary">新增（每行一个，或逗号分隔）</label>
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={4}
              placeholder={'例如：\n张三\n李四'}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-secondary">移除（每行一个，或逗号分隔）</label>
            <textarea
              value={removeText}
              onChange={(e) => setRemoveText(e.target.value)}
              rows={4}
              placeholder={'例如：\n王五'}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-brand-400"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={adminToken}
            onChange={(e) => { setAdminToken(e.target.value); try { localStorage.setItem(ADMIN_TOKEN_KEY, e.target.value) } catch { /* ignore */ } }}
            placeholder="管理员口令（服务端 config.json 的 adminToken）"
            className="w-72 rounded-lg border border-border bg-bg px-3 py-1.5 text-[12px] text-text outline-none focus:border-brand-400"
          />
          <button
            onClick={doBatch}
            disabled={busy}
            className="fx-pop inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            <UserPlus size={13} />应用批量调整
          </button>
          <button
            onClick={doSyncNow}
            disabled={busy}
            className="fx-pop inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={13} />立即同步检测
          </button>
          {msg && <span className="text-[12px] text-text-muted">{msg}</span>}
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          说明：自动同步基于 B站 抓取数据中「运营经纪人」字段——新名字出现即新增为在职；在职运营连续 {graceMinutes} 分钟未再出现于抓取数据即自动标记离职（防御抓取抖动）。批量调整为人工校正，立即生效并写入变动记录。
        </p>
      </div>
    </div>
  )
}
