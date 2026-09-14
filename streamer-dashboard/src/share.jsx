import { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Crown, Trophy, Flame, RefreshCw, Clock } from 'lucide-react'
import { PosterButton } from './components/ChallengePoster'
import './index.css'

function fmtMoney(v) {
  return '¥' + Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
    dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
function fmtStatTime(d) {
  if (!d) return ''
  const dt = new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}
// 精确到秒（数据实际产生并统计完成的具体时间）
function fmtFull(d) {
  if (!d) return ''
  const dt = new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-blue-50 to-sky-100 text-text">
      {children}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-white/15 px-2 py-2">
      <div className="text-[10px] text-white/75">{label}</div>
      <div className="mt-0.5 text-base font-bold text-white">{value}</div>
    </div>
  )
}

function TrackTable({ title, rows, accent }) {
  const ring = accent === 'amber' ? 'border-amber-200' : 'border-brand-200'
  const chip = accent === 'amber'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-brand-100 text-brand-700'
  return (
    <section className={`fx-panel rounded-2xl border ${ring} bg-white p-4 shadow-sm`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          {accent === 'amber' ? <Flame size={16} className="text-amber-500" /> : <Trophy size={16} className="text-brand-600" />}
          {title}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chip}`}>{rows.length} 人</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-secondary">暂无数据</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.房间号 || i} className="flex items-center gap-3 rounded-lg bg-bg px-3 py-2">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-slate-300'
              }`}>{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{r.主播昵称}</div>
                <div className="truncate text-[10px] text-text-secondary">房间号 {r.房间号} · {r.开播分区}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-brand-700">{fmtMoney(r.总流水)}</div>
                <div className="text-[10px] text-text-muted">{r.晋级状态}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function ShareApp() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [state, setState] = useState({ status: 'loading', data: null, share: null, error: '', meta: null })
  const [now, setNow] = useState(Date.now())
  const timer = useRef(null)
  const clock = useRef(null)

  const load = useCallback(async () => {
    if (!token) {
      setState({ status: 'error', data: null, share: null, error: '链接缺少访问令牌（token），请从完整分享地址打开' })
      return
    }
    try {
      // 追加 _ 时间戳，强制绕开任何代理 / 浏览器缓存，确保每次轮询都拿到服务端最新榜单
      const res = await fetch(`./api/challenge/board?token=${encodeURIComponent(token)}&_=${Date.now()}`)
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setState({ status: 'error', data: null, share: null, error: j.error || '加载失败' })
        return
      }
      setState({ status: 'ok', data: j.board, share: j.share, error: '', meta: j.meta || null })
    } catch (e) {
      setState({ status: 'error', data: null, share: null, error: e.message })
    }
  }, [token])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 60_000)
    clock.current = setInterval(() => setNow(Date.now()), 1000)

    // 实时推送：订阅服务端 SSE，数据一变更立即刷新（无需等 60s 轮询），多端同步
    let es
    try {
      es = new EventSource('./api/events')
      es.onmessage = () => { load() }
      // 服务端告警（登录失效/抓取异常/数据过期）即时推送，立即显示横幅
      es.addEventListener('alert', (ev) => {
        try {
          const a = ev.data ? JSON.parse(ev.data) : null
          setState(s => ({
            ...s,
            meta: {
              ...(s.meta || {}),
              alert: a,
              needsLogin: a?.level === 'login' || !!(s.meta?.needsLogin),
              paused: a?.level === 'login' || (s.meta?.staleHours != null && s.meta.staleHours >= 3),
            },
          }))
        } catch { /* ignore */ }
      })
      es.onerror = () => { /* EventSource 会自动重连；下方轮询作为兜底 */ }
    } catch { /* 不支持 SSE 时降级为纯轮询 */ }

    // 切回前台 / 重新聚焦时立刻刷新一次（移动端后台标签页定时器会被系统节流）
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    const onFocus = () => { load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(timer.current)
      clearInterval(clock.current)
      if (es) es.close()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  let countdown = ''
  if (state.share?.expiresAt) {
    const ms = new Date(state.share.expiresAt).getTime() - now
    if (ms > 0) {
      const h = Math.floor(ms / 3600_000)
      const m = Math.floor((ms % 3600_000) / 60_000)
      countdown = `链接有效期剩 ${h} 小时 ${m} 分`
    } else countdown = '链接已过期'
  }

  if (state.status === 'loading') {
    return <Shell><div className="flex h-screen items-center justify-center text-text-secondary">榜单加载中…</div></Shell>
  }
  if (state.status === 'error') {
    return (
      <Shell>
        <div className="mx-auto max-w-md p-8 text-center">
          <div className="text-lg font-semibold text-danger">无法查看榜单</div>
          <div className="mt-2 text-sm text-text-secondary">{state.error}</div>
        </div>
      </Shell>
    )
  }

  const b = state.data
  const promotions = b.rows.filter(r => r.赛道 === '晋级赛')
  const ranks = b.rows.filter(r => r.赛道 === '排位赛')

  return (
    <Shell>
      <div className="relative mx-auto max-w-3xl space-y-4 p-4 pb-10">
        {state.meta?.paused && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            <div className="font-semibold">⚠ 榜单数据已暂停更新</div>
            <div className="mt-0.5 text-[13px] leading-relaxed">
              {state.meta?.needsLogin
                ? 'B站登录会话已失效，后台无法继续抓取数据。请通知管理员在「数据自动同步」页点击【扫码登录B站】重新登录，登录后榜单将自动恢复。'
                : `数据已超过 ${(state.meta?.staleHours ?? 0).toFixed?.(1)} 小时未成功更新（上次更新：${fmtFull(state.meta?.lastToday) || '未知'}），可能已停更，请联系管理员排查。`}
            </div>
          </div>
        )}
        <DanmakuLayer />
        {/* 头部 */}
        <header className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-5 text-white shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-white/80">线下主播 · 暑期挑战赛</div>
              <h1 className="mt-0.5 text-xl font-bold">本周榜单</h1>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1 text-[11px] font-bold text-amber-950 shadow-sm ring-1 ring-amber-200/60">
                <Clock size={12} /> 数据统计时间 {fmtFull(b.dataGeneratedAt) || fmtStatTime(b.generatedAt)}
              </div>
            </div>
            <div className="text-right text-[11px] text-white/85">
              <div>数据统计周期 {b.statTime}</div>
              <div className="mt-1 flex items-center justify-end gap-1">
                <span className={`h-2 w-2 rounded-full ${state.meta?.paused ? 'bg-red-400' : 'bg-green-300 animate-pulse'}`} />
                {state.meta?.paused ? '已暂停' : '实时更新'}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="参赛人数" value={b.totals.参赛人数} />
            <Stat label="达标人数" value={b.totals.达标人数} />
            <Stat label="总流水" value={fmtMoney(b.totals.总流水)} />
          </div>
        </header>

        {/* 排位赛 TOP3 */}
        {b.top3.length > 0 && (
          <section className="fx-panel rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
              <Crown size={16} className="text-amber-500" /> 排位赛 TOP 3
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {b.top3.map((s, i) => (
                <div
                  key={s.房间号 || i}
                  className={`flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm border ${
                    i === 0 ? 'border-yellow-300' : i === 1 ? 'border-gray-300' : 'border-orange-200'
                  }`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                    i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                  }`}>{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{s.主播昵称}</div>
                    <div className="truncate text-[10px] text-text-secondary">房间号 {s.房间号}</div>
                    <div className="mt-0.5 text-sm font-bold text-brand-700">{fmtMoney(s.总流水)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <TrackTable title="排位赛" rows={ranks} accent="amber" />
        <TrackTable title="晋级赛" rows={promotions} accent="brand" />

        <div className="flex justify-center pt-1">
          <PosterButton board={b} statTime={b.statTime} label="保存榜单海报" />
        </div>

        <footer className="pt-2 text-center text-[11px] text-text-muted">
          <div className="flex items-center justify-center gap-1">
            <RefreshCw size={11} /> 数据统计时间 {fmtFull(b.dataGeneratedAt) || fmtDate(b.generatedAt)} · 每 60 秒自动刷新
          </div>
          {countdown && (
            <div className="mt-1 flex items-center justify-center gap-1">
              <Clock size={11} /> {countdown}
            </div>
          )}
        </footer>
      </div>
    </Shell>
  )
}

// ===== 弹幕层：45 条轻松有趣文案 + emoji，覆盖两个榜单及下方区域；半透明、pointer-events-none，不彻底遮挡昵称/流水 =====
const DANMAKU = [
  '🎉 主播加油鸭', '🔥 太强了家人们', '💰 冲冲冲', '🌟 666', '🥳 恭喜上榜',
  '🎊 人气爆棚', '❤️ 爱了爱了', '😎 稳了', '🚀 起飞', '👏 好厉害',
  '✨ 闪闪发光', '🍀 好运连连', '🎯 精准打击', '💪 干就完了', '🏆 冠军相',
  '😍 太可爱了', '🥰 心动的感觉', '🤩 哇哦', '👍 没毛病', '🌈 彩虹屁',
  '🎵 上才艺', '🍭 甜度超标', '🐂 牛哇', '💥 高能预警', '🧨 炸场了',
  '🎁 礼物走起', '💎 钻石主播', '🌹 送花花', '😂 笑死', '🤙 安排',
  '⚡ 速度飞快', '🎤 麦霸本霸', '🫶 比心', '🌟 明日之星', '🔝 登顶',
  '💃 舞力全开', '🎮 操作拉满', '🧧 红包雨', '🍻 干杯', '🥂 举杯',
  '🎈 氛围感', '😺 喵喵喵', '🐱 吸猫', '🌟 聚光灯', '🎉 冲榜啦',
]

function DanmakuLayer() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {DANMAKU.map((text, i) => {
        const top = 3 + ((i * 37) % 90)               // 纵向铺开：头部 / 两个榜单 / 下方
        const delay = ((i * 1.7) % 26).toFixed(1)     // 错峰出现，避免瞬间全屏
        const dur = (13 + (i % 8) * 2.2).toFixed(1)   // 速度略有差异，更灵动
        const bg = i % 2 ? 'rgba(251,114,153,0.5)' : 'rgba(0,174,236,0.5)' // B站粉 / B站蓝
        return (
          <span
            key={i}
            className="fx-danmaku absolute left-full top-0 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold text-white shadow-sm"
            style={{ top: `${top}%`, animationDelay: `${delay}s`, animationDuration: `${dur}s`, background: bg }}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

// 挂载入口（分享页为独立页面，直接渲染，不依赖后台主应用路由）
const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<ShareApp />)
}
