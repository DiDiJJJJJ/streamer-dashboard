import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCcw, LogIn, Download, CheckCircle2, XCircle, Loader2,
  Clock, Server, AlertTriangle, Settings2, QrCode, CloudDownload, Trash2, Lock,
  CalendarClock, History, UserMinus, RotateCcw,
} from 'lucide-react'

const API_KEY = 'sync_api_base'
const ADMIN_TOKEN_KEY = 'sync_admin_token'
const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY) || ''

function defaultApiBase() {
  const saved = localStorage.getItem(API_KEY)
  if (saved) return saved
  // 由同步服务(8787)直接托管时用相对路径，开发模式(5173)指向本机服务
  if (typeof window !== 'undefined' && window.location.port === '8787') return ''
  return 'http://localhost:8787'
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function sinceText(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff) || diff < 0) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/** 返回相对今天 offset 天的 YYYY-MM-DD（B站后台数据为近 7 天窗口） */
function dayOffsetStr(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function StatCard({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-danger',
    gray: 'bg-slate-100 text-slate-500',
  }
  return (
    <div className="fx-card rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <div className="mt-2 text-lg font-bold text-text">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-muted">{sub}</div>}
    </div>
  )
}

export function SyncPage({ onImport, onClearRecords, onClearAll, onSync }) {
  const [apiBase, setApiBase] = useState(defaultApiBase)
  const [status, setStatus] = useState(null)
  const [online, setOnline] = useState(null) // null=检测中 true/false
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null) // {type:'ok'|'err', text}
  const [showConfig, setShowConfig] = useState(false)
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '')
  const [showToken, setShowToken] = useState(false)
  const onTokenChange = (v) => {
    setAdminToken(v)
    if (v) localStorage.setItem(ADMIN_TOKEN_KEY, v)
    else localStorage.removeItem(ADMIN_TOKEN_KEY)
  }
  const [cronToday, setCronToday] = useState('*/20 * * * *')
  const [cronYesterday, setCronYesterday] = useState('0 13 * * *')
  const [byDate, setByDate] = useState(() => dayOffsetStr(-1)) // 默认补抓昨天（缺失日）
  const [confirm, setConfirm] = useState(null) // {title, text, actionKey, action}
  const timerRef = useRef(null)

  // 主播移除同步面板状态
  const [rmPreview, setRmPreview] = useState(null)
  const [rmBackup, setRmBackup] = useState(null)
  const [rmBusy, setRmBusy] = useState('')
  const [rmMsg, setRmMsg] = useState(null)

  const api = useCallback((path, opts = {}) => {
    const headers = { ...(opts.headers || {}) }
    const token = getAdminToken()
    if (token) headers['x-admin-token'] = token
    return fetch(`${apiBase}${path}`, { ...opts, headers })
  }, [apiBase])

  const loadStatus = useCallback(async (check = false) => {
    try {
      const res = await api(`/api/status${check ? '?check=1' : ''}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setStatus(json)
      setOnline(true)
      if (json.cronToday) setCronToday(json.cronToday)
      if (json.cronYesterday) setCronYesterday(json.cronYesterday)
      return json
    } catch {
      setOnline(false)
      return null
    }
  }, [api])

  useEffect(() => {
    loadStatus(false)
    timerRef.current = setInterval(() => loadStatus(false), 15000)
    return () => clearInterval(timerRef.current)
  }, [loadStatus])

  const run = async (key, fn) => {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally {
      setBusy('')
      loadStatus(false)
    }
  }

  const readJson = async (res) => {
    const text = await res.text()
    let json = {}
    if (text) { try { json = JSON.parse(text) } catch { /* ignore */ } }
    if (res.status === 401) throw new Error('需要管理员口令：请在页面顶部输入口令后再操作')
    if (!res.ok) throw new Error(json.error || json.message || `服务器返回非 JSON：${text.slice(0, 120)}`)
    return json
  }

  const handleLogin = () => run('login', async () => {
    const res = await api('/api/login', { method: 'POST' })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '打开登录窗口失败')
    setMsg({ type: 'ok', text: '已在本机打开浏览器窗口，请用B站APP扫码登录。登录成功后回到本页点击【我已完成登录】' })
  })

  const handleLoginDone = () => run('logindone', async () => {
    const res = await api('/api/login/done', { method: 'POST' })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '登录检测失败')
    if (json.loggedIn) {
      setMsg({ type: 'ok', text: `登录成功：${json.uname || 'B站账号'}，之后的定时抓取会自动复用该登录状态` })
    } else {
      throw new Error('未检测到登录状态，请重新扫码登录')
    }
  })

  const handleFetch = (type) => run(`fetch-${type}`, async () => {
    const res = await api(`/api/fetch?type=${type}`, { method: 'POST' })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || json.message || '抓取失败')
    const summary = json.check?.summary
      ? `\n校验：${json.check.summary}`
      : ''
    setMsg({
      type: 'ok',
      text: `【${type === 'today' ? '今日' : '昨日'}】抓取成功：${json.count} 条数据，大航海合计 ${json.seaCount || 0} 人${summary}`,
    })
    try { await onSync?.() } catch { /* 刷新失败不阻断抓取成功提示 */ }
  })

  const handleFetchDate = () => run('fetch-date', async () => {
    if (!byDate) throw new Error('请先选择要补抓的日期')
    const res = await api('/api/fetch-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: byDate }),
    })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '补抓失败')
    setMsg({
      type: 'ok',
      text: `【补抓 ${byDate}】成功：${json.count} 条数据，大航海合计 ${json.seaCount || 0} 人，房间 ${json.roomCount || 0} 个`,
    })
    try { await onSync?.() } catch { /* 重载失败不阻断提示 */ }
  })

  const handleCatchUp = () => run('catchup', async () => {
    const res = await api('/api/catchup', { method: 'POST' })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '补跑检查失败')
    if (!json.ran?.length) {
      setMsg({ type: 'ok', text: '检查完成：没有错过的定时任务，无需补跑' })
      return
    }
    const detail = json.ran
      .map(r => `【${r.label}】${r.ok ? `补跑成功 ${r.result?.count ?? 0} 条` : `补跑失败：${r.result?.error || '未知错误'}`}`)
      .join('；')
    setMsg({ type: json.ran.every(r => r.ok) ? 'ok' : 'err', text: `已补跑 ${json.ran.length} 个错过的任务 — ${detail}` })
    try { await onSync?.() } catch { /* 重载失败不阻断提示 */ }
  })

  const handleSaveCron = () => run('cron', async () => {
    const res = await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cronToday, cronYesterday }),
    })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '保存失败')
    setMsg({ type: 'ok', text: '定时规则已更新并立即生效' })
  })

  const clearAllData = () => run('clearall', async () => {
    const res = await api('/api/clear', { method: 'POST' })
    const json = await readJson(res)
    if (!json.ok) throw new Error(json.error || '清空失败')
    onClearAll?.()
    try { await onSync?.() } catch { /* 重载失败不阻断清空成功提示 */ }
    setMsg({ type: 'ok', text: '已清空全部看板数据（服务器数据集与本地缓存均已重置，登录态保持不变）' })
  })

  const clearLocalRecords = () => run('clearlocal', async () => {
    onClearRecords?.()
    onSync?.()
    setMsg({ type: 'ok', text: '已清空本地直播记录（保留线下标记/在职状态/自定义字段）' })
  })

  const askClearLocal = () => {
    setConfirm({
      title: '确认清空本地记录？',
      text: '这会清除浏览器本地缓存的主播每日记录，但会保留线下主播标记、在职状态等自定义字段。服务器端数据集不受影响。',
      actionKey: 'clearlocal',
      action: () => { setConfirm(null); clearLocalRecords() },
    })
  }

  const askClearAll = () => {
    setConfirm({
      title: '确认清空全部数据？',
      text: '这将同时清空服务器端数据集与浏览器本地缓存（包括线下标记、KPI 设置等），操作不可恢复。是否继续？',
      actionKey: 'clearall',
      action: () => { setConfirm(null); clearAllData() },
    })
  }

  // ---------------- 主播移除同步 ----------------
  const loadRemoved = useCallback(async () => {
    setRmBusy('preview')
    setRmMsg(null)
    try {
      const p = await api('/api/removed-rooms').then(r => r.json()).catch(() => null)
      const b = await api('/api/removed-rooms/backup').then(r => r.json()).catch(() => null)
      setRmPreview(p)
      setRmBackup(b)
    } catch (e) {
      setRmMsg({ type: 'err', text: e.message })
    } finally {
      setRmBusy('')
    }
  }, [api])

  const doRemove = useCallback(async (force) => {
    setRmBusy(force ? 'force' : 'sync')
    setRmMsg(null)
    try {
      const res = await api('/api/removed-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const json = await readJson(res)
      if (!json.ok) throw new Error(json.error || json.message || '移除失败')
      setRmMsg({
        type: 'ok',
        text: force
          ? `已强制移除 ${json.rooms} 个房间 / ${json.pruned} 条记录`
          : `已移除 ${json.rooms} 个房间 / ${json.pruned} 条记录（宽限期达标项）`,
      })
      await loadRemoved()
      try { await onSync?.() } catch { /* 重载失败不阻断提示 */ }
    } catch (e) {
      setRmMsg({ type: 'err', text: e.message })
    } finally {
      setRmBusy('')
    }
  }, [api, loadRemoved, onSync])

  const doRemoveRoom = useCallback(async (room) => {
    setRmBusy('rm-' + room)
    setRmMsg(null)
    try {
      const res = await api('/api/removed-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, rooms: [room] }),
      })
      const json = await readJson(res)
      if (!json.ok) throw new Error(json.error || json.message || '移除失败')
      setRmMsg({ type: 'ok', text: `已移除房间 ${room}（${json.targets?.[0]?.count ?? 0} 条记录）` })
      await loadRemoved()
      try { await onSync?.() } catch { /* 重载失败不阻断提示 */ }
    } catch (e) {
      setRmMsg({ type: 'err', text: e.message })
    } finally {
      setRmBusy('')
    }
  }, [api, loadRemoved, onSync])

  const doRestoreRoom = useCallback(async (room) => {
    setRmBusy('re-' + room)
    setRmMsg(null)
    try {
      const res = await api('/api/removed-rooms/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms: [room] }),
      })
      const json = await readJson(res)
      if (!json.ok) throw new Error(json.error || json.message || '恢复失败')
      setRmMsg({ type: 'ok', text: `已恢复房间 ${room}（${json.restored} 条记录）` })
      await loadRemoved()
      try { await onSync?.() } catch { /* 重载失败不阻断提示 */ }
    } catch (e) {
      setRmMsg({ type: 'err', text: e.message })
    } finally {
      setRmBusy('')
    }
  }, [api, loadRemoved, onSync])

  const rmBtn = 'fx-lift inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50'

  useEffect(() => { loadRemoved() }, [loadRemoved])

  const loggedIn = !!status?.loggedIn
  const btn = 'fx-lift inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="space-y-4 p-4">
      {/* 管理员口令 */}
      <div className="fx-panel rounded-lg border border-amber-200 bg-amber-50">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Lock className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">管理员口令</span>
          <input
            type={showToken ? 'text' : 'password'}
            placeholder="输入口令以解锁写操作"
            value={adminToken}
            onChange={(e) => onTokenChange(e.target.value)}
            className="w-56 rounded border border-amber-300 px-2 py-1 font-mono text-xs outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={() => setShowToken(v => !v)}
            className="inline-flex items-center rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-200"
          >
            {showToken ? '隐藏' : '显示'}
          </button>
          <span className="text-xs text-amber-700">
            {adminToken ? '✓ 已解锁，可执行清空 / 抓取等操作' : '未输入口令：清空 / 抓取 / 配置等写操作将被服务器拒绝'}
          </span>
        </div>
        <div className="border-t border-amber-200 px-4 py-2 text-[11px] leading-5 text-amber-700">
          口令由服务端首次启动时自动生成，保存在 <code className="rounded bg-white px-1 font-mono">server\config.json</code> 的 adminToken 字段（也打印在启动日志）。
          分享出去的链接没有此口令，他人无法修改你的数据。
        </div>
      </div>

      {/* 服务状态 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-brand-600" />
            <span className="text-sm font-semibold text-text">数据自动同步服务</span>
            {online === true && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">运行中</span>
            )}
            {online === false && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-danger">未连接</span>
            )}
            {online === null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">检测中</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className={`${btn} bg-slate-100 text-text-secondary hover:bg-slate-200`} onClick={() => loadStatus(true)}>
              <RefreshCcw className="h-3.5 w-3.5" /> 刷新状态
            </button>
            <button className={`${btn} bg-slate-100 text-text-secondary hover:bg-slate-200`} onClick={() => setShowConfig(v => !v)}>
              <Settings2 className="h-3.5 w-3.5" /> 定时设置
            </button>
          </div>
        </div>

        {online === false && (
          <div className="m-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-700">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> 未检测到同步服务
            </div>
            <div className="mt-1">
              请双击运行 <code className="rounded bg-white px-1 py-0.5 font-mono">streamer-dashboard\server\启动数据同步服务.bat</code>，
              服务启动后本页会自动连接（默认端口 8787）。
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span>服务地址</span>
              <input
                className="w-56 rounded border border-amber-300 px-2 py-1 font-mono text-[11px] outline-none"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
              />
              <button
                className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
                onClick={() => { localStorage.setItem(API_KEY, apiBase); loadStatus(true) }}
              >
                保存并重试
              </button>
            </div>
          </div>
        )}

        {status?.alert && (
          <div className={`mx-4 mt-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${status.alert.level === 'login' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
            <div className="font-semibold">
              {status.alert.level === 'login' ? '⚠ 需要重新登录B站' : status.alert.level === 'stale' ? '⚠ 数据已过期' : '⚠ 抓取异常'}
            </div>
            <div className="mt-0.5 text-[13px] leading-relaxed">{status.alert.msg}</div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={loggedIn ? CheckCircle2 : XCircle}
            tone={loggedIn ? 'green' : 'red'}
            label="B站登录状态"
            value={loggedIn ? (status?.uname || '已登录') : '未登录'}
            sub={loggedIn ? '定时任务将复用此登录' : '请先扫码登录'}
          />
          <StatCard
            icon={Clock}
            tone="brand"
            label="上次【今日】抓取"
            value={fmtTime(status?.lastToday)}
            sub={sinceText(status?.lastToday) || `每 20 分钟自动执行`}
          />
          <StatCard
            icon={Clock}
            tone="brand"
            label="上次【昨日】抓取"
            value={fmtTime(status?.lastYesterday)}
            sub={sinceText(status?.lastYesterday) || '每日 13:00 自动执行'}
          />
          <StatCard
            icon={CloudDownload}
            tone={status?.lastError ? 'red' : 'gray'}
            label="最近一次结果"
            value={status?.lastError ? '失败' : (status?.lastCount ? `${status.lastCount} 条` : '—')}
            sub={status?.lastError || (status?.running ? '抓取进行中...' : '正常')}
          />
        </div>

        {/* 定时计划 + 漏跑补偿 */}
        {status?.schedule && (
          <div className="border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <CalendarClock className="h-4 w-4 text-brand-600" />
                定时计划
                {status.schedule.catchUpEnabled ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-normal text-emerald-700">
                    漏跑自动补偿 · 已开启
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
                    漏跑自动补偿 · 已关闭
                  </span>
                )}
              </div>
              <button
                className={`${btn} bg-brand-50 text-brand-700 hover:bg-brand-100`}
                disabled={!online || !!busy}
                onClick={handleCatchUp}
                title="立即检查是否有错过的定时任务，有则马上补抓一次"
              >
                {busy === 'catchup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                立即检查补跑
              </button>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { key: 'today', label: '今日数据', s: status.schedule.today },
                { key: 'yesterday', label: '昨日数据', s: status.schedule.yesterday },
              ].map(({ key, label, s }) => (
                <div
                  key={key}
                  className={`fx-card rounded-md border px-3 py-2 text-xs ${s.missed ? 'border-amber-300 bg-amber-50' : 'border-border bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text">{label}</span>
                    <code className="font-mono text-[11px] text-text-muted">{s.cron}</code>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-text-secondary">
                    <span>上次应执行：{fmtTime(s.prevDue)}</span>
                    <span>下次执行：{fmtTime(s.nextDue)}</span>
                  </div>
                  {s.missed && (
                    <div className="mt-1 flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      该时刻服务未运行，尚未补抓（服务重启或点击上方按钮会自动补跑）
                    </div>
                  )}
                </div>
              ))}
            </div>

            {status.lastCatchUpAt && (
              <div className="mt-2 text-[11px] text-text-muted">
                上次漏跑检查：{fmtTime(status.lastCatchUpAt)}
                {status.lastCatchUp?.some(c => c.action === 'run') && (
                  <span className="ml-1 text-emerald-700">
                    · 已补跑 {status.lastCatchUp.filter(c => c.action === 'run').map(c => c.label).join('、')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {showConfig && (
          <div className="border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-text-secondary">
                <div className="mb-1">今日数据 Cron</div>
                <input
                  className="w-44 rounded border border-border px-2 py-1.5 font-mono text-xs outline-none focus:border-brand-500"
                  value={cronToday}
                  onChange={(e) => setCronToday(e.target.value)}
                />
              </label>
              <label className="text-xs text-text-secondary">
                <div className="mb-1">昨日数据 Cron</div>
                <input
                  className="w-44 rounded border border-border px-2 py-1.5 font-mono text-xs outline-none focus:border-brand-500"
                  value={cronYesterday}
                  onChange={(e) => setCronYesterday(e.target.value)}
                />
              </label>
              <button
                className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}
                disabled={busy === 'cron'}
                onClick={handleSaveCron}
              >
                {busy === 'cron' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                保存
              </button>
              <span className="text-[11px] text-text-muted">
                默认 <code className="font-mono">*/20 * * * *</code>（每20分钟）与 <code className="font-mono">0 13 * * *</code>（每日13:00），时区 Asia/Shanghai
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text">手动操作</div>
        <div className="flex flex-wrap gap-2 p-4">
          <button
            className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}
            disabled={!online || !!busy}
            onClick={handleLogin}
          >
            {busy === 'login' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
            扫码登录B站
          </button>
          <button
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
            disabled={!online || !!busy}
            onClick={handleLoginDone}
          >
            {busy === 'logindone' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            我已完成登录
          </button>
          <span className="mx-1 w-px self-stretch bg-border" />
          <button
            className={`${btn} bg-brand-50 text-brand-700 hover:bg-brand-100`}
            disabled={!online || !!busy}
            onClick={() => handleFetch('today')}
          >
            {busy === 'fetch-today' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            立即抓取【今日】
          </button>
          <button
            className={`${btn} bg-brand-50 text-brand-700 hover:bg-brand-100`}
            disabled={!online || !!busy}
            onClick={() => handleFetch('yesterday')}
          >
            {busy === 'fetch-yesterday' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            立即抓取【昨日】
          </button>
          <span className="mx-1 w-px self-stretch bg-border" />
          <span className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">抓取完成将自动载入看板</span>
        </div>

        {msg && (
          <div
            className={`mx-4 mb-4 rounded-md px-3 py-2 text-xs leading-5 ${
              msg.type === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-red-200 bg-red-50 text-danger'
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {/* 补抓指定日期 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text">补抓指定日期</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-xs text-text-secondary">B站后台近 7 天可查（含昨天），选择某一天自动筛选并导出「按日汇总」：</span>
          <input
            type="date"
            className="rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-brand-500"
            value={byDate}
            min={dayOffsetStr(-7)}
            max={dayOffsetStr(-1)}
            onChange={(e) => setByDate(e.target.value)}
          />
          <button
            className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}
            disabled={!online || !!busy || !byDate}
            onClick={handleFetchDate}
          >
            {busy === 'fetch-date' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
            补抓指定日期
          </button>
          {status?.lastByDate && (
            <span className="text-[11px] text-text-muted">
              上次补抓：{status.lastByDate.date} · {fmtTime(status.lastByDate.at)} · {status.lastByDate.count} 条
            </span>
          )}
        </div>
        <div className="px-4 pb-4 text-xs leading-5 text-text-muted">
          由服务端 Playwright 自动打开B站后台，在日期范围选择器中筛选该日并导出「按日汇总下载」，仅覆盖该日记录（按 房间号::日期 合并），不会影响其他日期数据。
        </div>
      </div>

      {/* 主播移除同步 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <UserMinus className="h-4 w-4 text-brand-600" />
            主播数据同步移除
          </div>
          <button
            className={`${rmBtn} bg-slate-100 text-text-secondary hover:bg-slate-200`}
            disabled={rmBusy === 'preview'}
            onClick={loadRemoved}
          >
            {rmBusy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            刷新检测
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-xs leading-5 text-text-secondary">
            当主播在 B站后台被移出时，其记录仍残留在看板。系统以「今日抓取快照」作为在册权威来源：房间连续
            <span className="font-semibold text-text"> {rmPreview?.graceMinutes ?? 60} 分钟</span>
            未出现在今日抓取中（且今日抓取条数 ≥ {rmPreview?.minHealthyCount ?? 800} 视为健康），即自动判定为已移出并移除。
            每次【今日】抓取成功后自动执行；移除前自动备份，可随时恢复。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`${rmBtn} bg-brand-50 text-brand-700 hover:bg-brand-100`}
              disabled={rmBusy || !rmPreview?.candidateCount}
              onClick={() => doRemove(false)}
              title="仅移除已满足宽限期的疑似房间（防御误删）"
            >
              {rmBusy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
              立即同步移除（宽限期达标）
            </button>
            <button
              className={`${rmBtn} bg-red-50 text-danger hover:bg-red-100`}
              disabled={rmBusy || !rmPreview?.candidateCount}
              onClick={() => setConfirm({
                title: '确认强制移除全部疑似已移出主播？',
                text: '将忽略宽限期，立即移除当前所有「不在今日抓取中」的房间数据。这些房间确已不在 B站后台在册列表，但操作会直接生效并写入备份。是否继续？',
                actionKey: 'rm-force',
                action: () => { setConfirm(null); doRemove(true) },
              })}
            >
              {rmBusy === 'force' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              强制移除全部疑似
            </button>
            <span className="text-[11px] text-text-muted">
              今日在册 {rmPreview?.todayCount ?? '—'} 个 · 疑似已移出 {rmPreview?.candidateCount ?? '—'} 个
              {rmPreview?.eligibleCount ? `（其中 ${rmPreview.eligibleCount} 个已可移除）` : ''}
            </span>
          </div>

          {rmMsg && (
            <div className={`rounded-md px-3 py-2 text-xs leading-5 ${rmMsg.type === 'ok' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-danger'}`}>
              {rmMsg.text}
            </div>
          )}

          {/* 疑似已移除清单 */}
          {rmPreview?.candidates?.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-slate-50 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">房间号</th>
                    <th className="px-3 py-2 text-left font-medium">主播</th>
                    <th className="px-3 py-2 text-left font-medium">运营</th>
                    <th className="px-3 py-2 text-right font-medium">记录数</th>
                    <th className="px-3 py-2 text-left font-medium">昨日仍在册</th>
                    <th className="px-3 py-2 text-left font-medium">等待时长</th>
                    <th className="px-3 py-2 text-left font-medium">状态</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rmPreview.candidates.map((c) => (
                    <tr key={c.room} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-text-secondary">{c.room}</td>
                      <td className="px-3 py-2 text-text">{c.name}</td>
                      <td className="px-3 py-2 text-text-secondary">{c.operator}</td>
                      <td className="px-3 py-2 text-right font-bold text-text">{c.count}</td>
                      <td className="px-3 py-2">{c.inYesterday ? <span className="text-amber-600">是</span> : <span className="text-text-muted">否</span>}</td>
                      <td className="px-3 py-2 text-text-muted">{c.pendingSince ? `已等待 ${c.elapsedMin} 分钟` : '首次检测'}</td>
                      <td className="px-3 py-2">
                        {c.eligible
                          ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">可移除</span>
                          : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">宽限期中</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          className={`${rmBtn} bg-red-50 px-2 py-1 text-danger hover:bg-red-100`}
                          disabled={rmBusy}
                          onClick={() => doRemoveRoom(c.room)}
                        >
                          {rmBusy === 'rm-' + c.room ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 已移除备份（可恢复） */}
          {rmBackup?.entries?.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-bg/40 px-3 py-2 text-[11px] font-semibold text-text-secondary">
                <History className="h-3.5 w-3.5" />
                已移除备份（共 {rmBackup.entries.length} 个房间，可恢复）
              </div>
              <div className="divide-y divide-border">
                {rmBackup.entries.map((e) => (
                  <div key={e.room} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0 text-text">
                      <span className="font-mono text-text-secondary">{e.room}</span>
                      <span className="ml-2">{e.name}</span>
                      <span className="ml-2 text-text-muted">运营 {e.operator}</span>
                      <span className="ml-2 text-text-muted">{e.count} 条 · 移除于 {fmtTime(e.removedAt)}</span>
                    </div>
                    <button
                      className={`${rmBtn} bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100`}
                      disabled={rmBusy}
                      onClick={() => doRestoreRoom(e.room)}
                    >
                      {rmBusy === 're-' + e.room ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      恢复
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 数据管理 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text">数据管理</div>
        <div className="flex flex-wrap gap-2 p-4">
          <button
            className={`${btn} bg-slate-100 text-text-secondary hover:bg-slate-200`}
            disabled={!!busy}
            onClick={askClearLocal}
          >
            {busy === 'clearlocal' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            仅清空本地记录
          </button>
          <button
            className={`${btn} bg-red-50 text-danger hover:bg-red-100`}
            disabled={!online || !!busy}
            onClick={askClearAll}
          >
            {busy === 'clearall' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            清空全部数据
          </button>
        </div>
        <div className="px-4 pb-4 text-xs leading-5 text-text-muted">
          「清空全部数据」会同时重置服务器数据集与浏览器本地缓存（包括线下标记、KPI 设置等），操作不可恢复；
          「仅清空本地记录」保留线下标记、在职状态等本地设置，服务器数据集不受影响。两个操作均会弹出确认框。
        </div>
      </div>

      {/* 抓取历史 */}
      <div className="fx-panel rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text">抓取记录</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50 text-text-secondary">
              <tr>
                <th className="px-4 py-2 text-left font-medium">时间</th>
                <th className="px-4 py-2 text-left font-medium">类型</th>
                <th className="px-4 py-2 text-left font-medium">结果</th>
                <th className="px-4 py-2 text-right font-medium">条数</th>
                <th className="px-4 py-2 text-right font-medium">大航海人数</th>
                <th className="px-4 py-2 text-left font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {(status?.history || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">暂无抓取记录</td>
                </tr>
              )}
              {(status?.history || []).map((h, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 text-text-secondary">{fmtTime(h.at)}</td>
                  <td className="px-4 py-2">{h.type === 'today' ? '今日' : '昨日'}</td>
                  <td className="px-4 py-2">
                    {h.ok
                      ? <span className="text-emerald-600">成功</span>
                      : <span className="text-danger">失败</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-bold text-text">{h.count ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-bold text-text">{h.seaCount ?? '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{h.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="rounded-lg border border-border bg-white p-4 text-xs leading-6 text-text-secondary">
        <div className="mb-2 text-sm font-semibold text-text">使用说明</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>双击 <code className="rounded bg-slate-100 px-1 font-mono">server\启动数据同步服务.bat</code> 启动本机同步服务（首次会自动安装依赖）。</li>
          <li>点击【扫码登录B站】，在弹出的浏览器窗口用B站APP扫码登录，完成后点【我已完成登录】。登录状态会保存在本机，之后无需重复登录。</li>
          <li>服务会<strong className="text-text">每 20 分钟</strong>自动抓取一次B站后台【今日】数据（含大航海人数），<strong className="text-text">每日 13:00</strong> 自动抓取【昨日】数据。</li>
          <li><strong className="text-text">漏跑自动补偿</strong>：若电脑关机 / 服务停止，导致 13:00 那次抓取被跳过，服务下次启动时会自动回溯并<strong className="text-text">立即补抓一次</strong>，无需手动操作；服务运行期间也会每 10 分钟自查一次（覆盖系统休眠场景）。也可点击【立即检查补跑】手动触发。<span className="text-text-muted">注意：补跑抓到的是「当前的昨日」，若停机已跨越多天，可用本页【补抓指定日期】自动补齐（限B站后台近 7 天窗口），超出窗口的历史缺失仍需用 B站后台导出的 Excel 补齐。</span></li>
          <li><strong className="text-text">补抓指定日期</strong>：在【补抓指定日期】卡片选择某一天（B站后台近 7 天可查），点【补抓指定日期】即可由服务端自动打开B站后台、筛选该日并导出「按日汇总下载」，仅覆盖该日数据，安全无污染。</li>
          <li>抓取的数据保存在 <code className="rounded bg-slate-100 px-1 font-mono">server\data\</code>，点击【载入…到看板】即可同步到主播数据/列表等页面。</li>
          <li>【数据自动同步】页顶部需输入<strong className="text-text">管理员口令</strong>才能执行清空 / 抓取 / 配置等写操作。口令在 <code className="rounded bg-slate-100 px-1 font-mono">server\config.json</code> 的 adminToken 字段中查看（首次启动自动生成并打印到日志）。把链接分享给他人时，他们只能查看数据，无法改动。</li>
          <li>若B站后台页面改版导致找不到导出按钮，可在 <code className="rounded bg-slate-100 px-1 font-mono">server\config.json</code> 的 selectors 里补充按钮文案，排查快照在 <code className="rounded bg-slate-100 px-1 font-mono">server\logs\</code>。</li>
        </ol>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="fx-card w-full max-w-sm rounded-lg border border-border bg-white p-5 shadow-lg">
            <div className="flex items-center gap-2 text-base font-semibold text-text">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {confirm.title}
            </div>
            <div className="mt-3 text-sm leading-6 text-text-secondary">{confirm.text}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="fx-lift rounded-md border border-border bg-white px-4 py-2 text-xs font-medium text-text-secondary hover:bg-slate-50"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                className="fx-lift rounded-md bg-danger px-4 py-2 text-xs font-medium text-white hover:bg-red-600"
                onClick={confirm.action}
                disabled={busy === confirm.actionKey}
              >
                {busy === confirm.actionKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  '确认'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
