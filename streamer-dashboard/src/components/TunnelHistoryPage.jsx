import { useState, useEffect, useRef } from 'react'

// 外网地址变更记录：当前地址卡片 + 历史列表（按时间查询）+ 手动登记（密码/其他）
const ADMIN_TOKEN_FALLBACK = 'fbc1985757d7849a22e64c672d3120a6'
function getToken() {
  try { return localStorage.getItem('sync_admin_token') || ADMIN_TOKEN_FALLBACK } catch { return ADMIN_TOKEN_FALLBACK }
}

const TYPE_META = {
  tunnel: { label: '外网地址', cls: 'bg-brand-50 text-brand-600' },
  password: { label: '管理员密码', cls: 'bg-red-50 text-red-600' },
  other: { label: '其他', cls: 'bg-slate-100 text-slate-600' },
}

function fmtTime(at) {
  if (!at) return '—'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function TunnelHistoryPage() {
  const [current, setCurrent] = useState({ url: '', at: '', healthy: null, reason: '' })
  const [list, setList] = useState([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)

  // 新增记录表单
  const [noteType, setNoteType] = useState('password')
  const [noteValue, setNoteValue] = useState('')
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Tailscale 虚拟组网状态
  const [tailscale, setTailscale] = useState({ installed: false, online: false, needsLogin: false, ips: [], url: null, reason: '' })

  const esRef = useRef(null)

  async function loadCurrent() {
    try {
      const res = await fetch('./api/tunnel/current')
      const j = await res.json()
      if (j.ok) setCurrent({ url: j.url || '', at: j.at || '', healthy: j.healthy, reason: j.reason || '' })
    } catch { /* ignore */ }
  }

  async function loadTailscale() {
    try {
      const res = await fetch('./api/tailscale')
      const j = await res.json()
      if (j.ok) setTailscale({ installed: !!j.installed, online: !!j.online, needsLogin: !!j.needsLogin, ips: j.ips || [], url: j.url || null, reason: j.reason || '' })
    } catch { /* ignore */ }
  }

  async function loadHistory() {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from + 'T00:00:00.000')
      if (to) qs.set('to', to + 'T23:59:59.999')
      const res = await fetch('./api/tunnel/history?' + qs.toString())
      const j = await res.json()
      if (j.ok) setList(Array.isArray(j.list) ? j.list : [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    loadCurrent()
    loadTailscale()
    loadHistory()
    // 监听手动登记更新，自动刷新列表
    try {
      const es = new EventSource('./api/events')
      es.addEventListener('changelog-updated', () => loadHistory())
      esRef.current = es
    } catch { /* ignore */ }
    return () => { if (esRef.current) esRef.current.close() }
  }, [from, to])

  function copy(text) {
    try { navigator.clipboard?.writeText(text) } catch { /* ignore */ }
  }

  async function submitNote(e) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('./api/tunnel/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() },
        body: JSON.stringify({ type: noteType, value: noteValue, note: noteText }),
      })
      const j = await res.json()
      if (j.ok) {
        setMsg('已记录')
        setNoteValue('')
        setNoteText('')
        loadHistory()
      } else {
        setMsg('记录失败：' + (j.error || '未知错误'))
      }
    } catch (err) {
      setMsg('记录失败：' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <h1 className="mb-4 text-[18px] font-bold text-text">外网地址变更记录</h1>

      {/* Tailscale 虚拟组网访问（推荐方案） */}
      <section className="fx-panel fx-enter mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm">
        <div className="flex items-center gap-2 text-[12px] font-medium text-text-secondary">
          Tailscale 虚拟组网访问（推荐）
          {tailscale.installed && tailscale.online && tailscale.url && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">已就绪</span>
          )}
          {tailscale.installed && !tailscale.online && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">未连线</span>
          )}
          {!tailscale.installed && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">未安装</span>
          )}
        </div>

        {tailscale.url ? (
          <>
            <a
              href={tailscale.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-[15px] font-semibold text-brand-600 underline"
            >
              {tailscale.url}
            </a>
            <div className="mt-1 text-[11px] text-text-secondary">
              手机安装 Tailscale App 并登录同一账号后，直接访问此地址即可（虚拟 IP：{tailscale.ips.join('、')}）
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={tailscale.url}
                target="_blank"
                rel="noreferrer"
                className="fx-pop rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
              >
                打开
              </a>
              <button
                onClick={() => copy(tailscale.url)}
                className="fx-pop rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-bg"
              >
                复制地址
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1 text-[13px] text-text-secondary">
            尚未就绪：{tailscale.reason || '请运行「安装并启动Tailscale.bat」安装并登录'}
          </div>
        )}
      </section>

      {/* 当前外网地址 */}
      <section className="fx-panel fx-enter mb-4 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-[12px] font-medium text-text-secondary">
          当前外网地址
          {current.url && current.healthy === true && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">正常</span>
          )}
          {current.url && current.healthy === false && (
            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">异常</span>
          )}
          {current.url && current.healthy === null && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">未知</span>
          )}
        </div>
        {current.url ? (
          <>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-[15px] font-semibold text-brand-600 underline"
            >
              {current.url}
            </a>
            <div className="mt-1 text-[11px] text-text-secondary">更新于 {fmtTime(current.at)}</div>
            {current.reason && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-[12px] ${current.healthy === false ? 'bg-red-50 text-red-700' : current.healthy === true ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {current.healthy === false && <span className="mr-1">⚠️</span>}
                {current.reason}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="fx-pop rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
              >
                打开
              </a>
              <button
                onClick={() => copy(current.url)}
                className="fx-pop rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-bg"
              >
                复制地址
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1 text-[13px] text-text-secondary">尚未检测到外网地址（请确认 cloudflared 隧道是否已启动）</div>
        )}
      </section>

      {/* 筛选 + 新增 */}
      <section className="fx-panel fx-enter mb-4 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
              从
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
              至
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand-500"
              />
            </label>
            <button
              onClick={loadHistory}
              className="fx-pop rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
            >
              查询
            </button>
            {(from || to) && (
              <button
                onClick={() => { setFrom(''); setTo('') }}
                className="fx-pop rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-bg"
              >
                重置
              </button>
            )}
          </div>

          <form onSubmit={submitNote} className="flex flex-wrap items-end gap-2">
            <select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value)}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand-500"
            >
              <option value="password">管理员密码</option>
              <option value="other">其他关键信息</option>
            </select>
            {noteType === 'other' && (
              <input
                value={noteValue}
                onChange={(e) => setNoteValue(e.target.value)}
                placeholder="内容"
                className="w-32 rounded-lg border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand-500"
              />
            )}
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={noteType === 'password' ? '备注（如：已更新口令）' : '备注'}
              className="w-44 rounded-lg border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="fx-pop rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-900 disabled:opacity-60"
            >
              登记变更
            </button>
          </form>
        </div>
        {msg && <div className="mt-2 text-[12px] text-text-secondary">{msg}</div>}
      </section>

      {/* 历史列表 */}
      <section className="fx-panel fx-enter overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="bg-bg text-text-secondary">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">时间</th>
              <th className="px-4 py-2.5 text-left font-semibold">类型</th>
              <th className="px-4 py-2.5 text-left font-semibold">内容</th>
              <th className="px-4 py-2.5 text-left font-semibold">备注</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-secondary">加载中…</td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-secondary">暂无记录</td>
              </tr>
            )}
            {!loading && list.map((e) => {
              const meta = TYPE_META[e.type] || TYPE_META.other
              return (
                <tr key={e.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2.5 text-text">{fmtTime(e.at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {e.type === 'tunnel' && e.value ? (
                      <a
                        href={e.value}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-brand-600 underline"
                      >
                        {e.value}
                      </a>
                    ) : (
                      <span className="break-all text-text">{e.value || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">{e.note || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-text-muted">
        <p>推荐方案：<b className="text-text-secondary">Tailscale 虚拟组网</b>——手机和电脑登录同一账号后，手机直接用上方「Tailscale 虚拟组网访问」地址打开即可，稳定且免费，不依赖任何被封的服务器。手机需安装 Tailscale App。</p>
        <p>备选方案：下方「当前外网地址」为 Cloudflare 临时隧道，每次重启服务都会变化；本页自动记录变更历史，无需去日志文件查找。若临时隧道打不开（公司网络常见），优先改用 Tailscale。</p>
      </div>
    </div>
  )
}
