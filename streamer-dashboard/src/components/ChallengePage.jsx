import { useState, useMemo, useEffect } from 'react'
import { computeChallenge } from '../utils/challenge'
import { Trophy, Medal, ChevronDown, ChevronUp, TrendingUp, Users, Crown, Award, AlertCircle, ArrowLeft, Flag, Plus, Trash2, CalendarPlus, Share2, Copy, Check, X, Image as ImageIcon } from 'lucide-react'
import { format, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns'
import { Money } from './Money'
import { PosterButton } from './ChallengePoster'

// 赛道徽章样式：排位赛（金橙渐变，强调"巅峰"）与晋级赛（品牌蓝）明显区分
function trackBadgeClass(track) {
  return track === '排位赛'
    ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-white font-semibold shadow-sm'
    : 'bg-brand-100 text-brand-700 font-medium'
}
// 晋级状态徽章样式：按新赛制文案区分颜色
function statusBadgeClass(status) {
  if (status.includes('TOP')) return 'bg-amber-50 text-amber-700 font-semibold'
  if (status.includes('晋级')) return 'bg-green-50 text-success'
  if (status.includes('排位落榜')) return 'bg-orange-50 text-orange-600'
  if (status.includes('冲刺')) return 'bg-blue-50 text-blue-600'
  return 'bg-red-50 text-danger'
}

const fmt = (d) => format(d, 'yyyy-MM-dd')
const EVENTS_KEY = 'challenge_events'
const ACTIVE_KEY = 'challenge_active_event'

function loadEvents() {
  try {
    const v = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
    if (Array.isArray(v) && v.length) return v
  } catch {}
  return [{ id: 'default', name: '2026暑期主播挑战赛' }]
}
function loadActive(events) {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (id && events.some(e => e.id === id)) return id
  } catch {}
  return events[0].id
}

export function ChallengePage({ records, roster }) {
  const today = new Date()
  const [startDate, setStartDate] = useState(fmt(startOfWeek(new Date('2026-08-01'), { weekStartsOn: 1 })))
  const [endDate, setEndDate] = useState(fmt(endOfWeek(today, { weekStartsOn: 1 })))
  const [expandedWeeks, setExpandedWeeks] = useState({})
  const [view, setView] = useState('home')
  const [trackFilter, setTrackFilter] = useState('全部')
  const [events, setEvents] = useState(() => loadEvents())
  const [activeId, setActiveId] = useState(() => loadActive(loadEvents()))

  // 对外分享链接管理（运营可生成本周榜单的公开分享地址）
  const [showShare, setShowShare] = useState(false)
  const [shareList, setShareList] = useState([])
  const [expiresHours, setExpiresHours] = useState(168)
  const [shareLabel, setShareLabel] = useState('')
  const [newShareUrl, setNewShareUrl] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [copied, setCopied] = useState(false)

  // 持久化
  useEffect(() => { try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)) } catch {} }, [events])
  useEffect(() => { try { localStorage.setItem(ACTIVE_KEY, activeId) } catch {} }, [activeId])

  const activeEvent = events.find(e => e.id === activeId) || events[0]
  const eventName = activeEvent?.name || '赛事'

  // ---- 分享链接管理 ----
  function adminToken() {
    return localStorage.getItem('sync_admin_token') || ''
  }
  async function refreshShares() {
    try {
      const res = await fetch('./api/challenge/shares', { headers: { 'x-admin-token': adminToken() } })
      const j = await res.json()
      if (j.ok) setShareList(j.shares || [])
    } catch { /* ignore */ }
  }
  async function openSharePanel() {
    setShowShare(v => !v)
    setNewShareUrl('')
    setShareMsg('')
    if (!showShare) await refreshShares()
  }
  async function genShare() {
    setGenBusy(true); setShareMsg('')
    try {
      const res = await fetch('./api/challenge/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken() },
        body: JSON.stringify({ expiresInHours: Number(expiresHours) || 168, label: shareLabel }),
      })
      const j = await res.json()
      if (j.ok) {
        setNewShareUrl(j.url)
        setShareMsg('已生成，复制后发给运营/外部伙伴即可')
        await refreshShares()
      } else {
        setShareMsg(j.error || '生成失败')
      }
    } catch (e) {
      setShareMsg(e.message || '生成失败')
    } finally {
      setGenBusy(false)
    }
  }
  async function revokeShare(t) {
    try {
      await fetch(`./api/challenge/share?token=${t}`, { method: 'DELETE', headers: { 'x-admin-token': adminToken() } })
      await refreshShares()
    } catch { /* ignore */ }
  }
  function copyUrl() {
    if (!newShareUrl) return
    navigator.clipboard?.writeText(newShareUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => setShareMsg('复制失败，请手动选择链接复制'))
  }

  const offlineCount = useMemo(() => records.filter(r => r['是否线下主播']).length, [records])

  const weekStats = useMemo(() => {
    try {
      return computeChallenge(records, {
        startDate,
        endDate,
        tracks: roster?.tracks || {},
        overrideWeek: { start: '2026-08-03', end: '2026-08-09' },
      })
    } catch (e) {
      console.error(e)
      return []
    }
  }, [records, startDate, endDate, roster])

  // 仅展示存在数据的自然周
  const nonEmptyWeekStats = useMemo(() => weekStats.filter(w => w.list && w.list.length > 0), [weekStats])

  // 排序：当周置顶、上周次之、其余按时间倒序
  const sortedWeekStats = useMemo(() => {
    const arr = [...nonEmptyWeekStats]
    const score = (w) => {
      const containsToday = isWithinInterval(today, { start: w.weekStart, end: w.weekEnd })
      if (containsToday) return [0, 0]
      if (w.weekEnd < today) return [1, -w.weekStart.getTime()]
      return [2, w.weekStart.getTime()]
    }
    return arr.sort((a, b) => {
      const sa = score(a), sb = score(b)
      if (sa[0] !== sb[0]) return sa[0] - sb[0]
      return sa[1] - sb[1]
    })
  }, [nonEmptyWeekStats])

  const toggleWeek = (label) => {
    setExpandedWeeks(prev => ({ ...prev, [label]: !prev[label] }))
  }

  const overall = useMemo(() => {
    const totalRevenue = nonEmptyWeekStats.reduce((s, w) => s + (w.总流水 || 0), 0)
    const totalPassed = nonEmptyWeekStats.reduce((s, w) => s + (w.达标人数 || 0), 0)
    return { totalRevenue, totalPassed, weekCount: nonEmptyWeekStats.length }
  }, [nonEmptyWeekStats])

  // 本周排位赛巅峰榜 TOP 3：仅取「当前自然周」内【排位赛】赛道、且周流水≥2000元的主播，按流水取前三；无人达标时返回空（整体隐藏）
  const TOP3_THRESHOLD = 2000
  const top3Week = useMemo(() => weekStats.find(w => isWithinInterval(today, { start: w.weekStart, end: w.weekEnd })) || null, [weekStats])
  const overallTop3 = useMemo(() => {
    if (!top3Week) return []
    return top3Week.list
      .filter(s => s.赛道 === '排位赛' && s.总流水 >= TOP3_THRESHOLD)
      .sort((a, b) => b.总流水 - a.总流水)
      .slice(0, 3)
      .map(s => ({ ...s, 总流水: Number(s.总流水.toFixed(2)) }))
  }, [top3Week])

  // 海报所需「本周榜单」数据（当前自然周；用于生成分享海报）
  const currentBoard = useMemo(() => {
    const w = top3Week || weekStats[0]
    if (!w) return null
    const rows = (w.list || []).map(s => ({
      主播昵称: s.主播昵称,
      房间号: s.房间号,
      总流水: Number(s.总流水.toFixed(2)),
      赛道: s.赛道,
    }))
    const top3 = rows
      .filter(s => s.赛道 === '排位赛' && s.总流水 >= TOP3_THRESHOLD)
      .sort((a, b) => b.总流水 - a.总流水)
      .slice(0, 3)
    return {
      weekLabel: `${format(w.weekStart, 'yyyy-MM-dd')} ~ ${format(w.weekEnd, 'yyyy-MM-dd')}`,
      totals: { 参赛人数: rows.length, 达标人数: w.达标人数, 总流水: w.总流水 },
      top3, rows,
    }
  }, [top3Week, weekStats])

  // 海报统计时间：每次渲染取最新时刻（点击「生成海报」时使用当前值，避免挂载时冻结为旧时间）
  const posterStatTime = format(new Date(), 'yyyy-MM-dd HH:mm')

  function handleAddEvent() {
    const name = prompt('请输入新赛事活动名称：')
    if (!name || !name.trim()) return
    const id = 'evt_' + Date.now()
    const next = [...events, { id, name: name.trim() }]
    setEvents(next)
    setActiveId(id)
    setView('detail')
  }

  function handleEventNameChange(v) {
    setEvents(prev => prev.map(e => e.id === activeId ? { ...e, name: v } : e))
  }

  function handleDeleteEvent() {
    if (events.length <= 1) { alert('至少保留一个赛事活动'); return }
    if (!confirm(`确定删除赛事「${eventName}」吗？`)) return
    const next = events.filter(e => e.id !== activeId)
    setEvents(next)
    setActiveId(next[0].id)
    setView('home')
  }

  // ===== 赛事首页（活动独立为按钮入口 + 添加活动） =====
  if (view === 'home') {
    return (
      <div className="p-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <Trophy size={20} className="text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">线下主播赛事管理</h2>
                <p className="text-xs text-text-secondary">管理并查看各赛事活动的实时赛况数据</p>
              </div>
            </div>
            <button
              onClick={handleAddEvent}
              className="fx-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:from-brand-700 hover:to-brand-600"
            >
              <Plus size={16} /> 添加活动
            </button>
          </div>

          {offlineCount === 0 && (
            <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              当前未录入线下主播房间号，请先在「线下主播管理」中导入，赛事数据将自动统计。
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {events.map(ev => (
              <div
                key={ev.id}
                className="fx-card group flex items-center justify-between rounded-xl border border-border bg-white p-4 shadow-sm transition-colors hover:border-brand-400"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-400 text-white">
                    <Flag size={18} />
                  </div>
                  <div>
                    <div className="font-medium text-text">{ev.name}</div>
                    <div className="text-[10px] text-text-muted">点击进入查看赛况</div>
                  </div>
                </div>
                <button
                  onClick={() => { setActiveId(ev.id); setView('detail') }}
                  className="fx-lift flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  进入 <ChevronDown size={12} className="rotate-270" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-xs text-text-secondary">
            赛制：自然周内流水 ≥ 2000 元晋级排位赛；排位赛周流水 ≥ 2000 元争夺 TOP3 奖励金，低于 2000 元则下周需重新达标方可重回排位赛。
          </div>
        </div>
      </div>
    )
  }

  // ===== 赛事详情页 =====
  if (offlineCount === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm border border-border">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
            <Trophy size={32} className="text-brand-600" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-text">线下主播赛事管理</h2>
          <p className="mb-6 text-sm text-text-secondary">
            当前未录入线下主播房间号。请先在「线下主播管理」中导入/录入线下主播，挑战赛数据将自动统计。
          </p>
          <div className="text-xs text-text-muted">
            赛制：自然周内流水 ≥ 2000 元晋级排位赛；排位赛周流水 ≥ 2000 元争夺 TOP3 奖励金，低于 2000 元则下周需重新达标方可重回排位赛。
          </div>
          <button
            onClick={() => setView('home')}
            className="mt-6 flex items-center justify-center gap-1 text-xs text-brand-700 hover:underline"
          >
            <ArrowLeft size={14} /> 返回赛事列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setView('home')}
          className="flex items-center gap-1 text-xs text-brand-700 hover:underline"
        >
          <ArrowLeft size={14} /> 返回赛事列表
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">当前赛事：{eventName}</span>
          <button
            onClick={handleDeleteEvent}
            className="fx-pop flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:border-danger hover:text-danger"
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-500 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 text-white/80 text-xs"><TrendingUp size={14} /> 累计实时流水</div>
          <div className="mt-1 text-xl font-bold"><Money value={overall.totalRevenue} className="text-white" /></div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 text-white/80 text-xs"><Users size={14} /> 达标人次</div>
          <div className="mt-1 text-xl font-bold">{overall.totalPassed} 人次</div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-brand-500 to-brand-300 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 text-white/80 text-xs"><Trophy size={14} /> 统计周数</div>
          <div className="mt-1 text-xl font-bold">{overall.weekCount} 周</div>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm border border-border">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-brand-600" />
            <input
              type="text"
              value={eventName}
              onChange={e => handleEventNameChange(e.target.value)}
              className="rounded-md border border-transparent px-2 py-1 text-sm font-semibold text-text outline-none hover:border-border focus:border-brand-500"
            />
            <span className="text-xs text-text-secondary">自然周（周一 00:00 ~ 周日 24:00）</span>
          </div>
          <button
            onClick={openSharePanel}
            className="fx-glow flex items-center gap-1.5 rounded-md bg-gradient-to-r from-brand-600 to-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
          >
            <Share2 size={13} /> 生成分享链接
          </button>
          <PosterButton board={currentBoard} statTime={posterStatTime} label="生成海报" />
        </div>

        {showShare && (
          <div className="mb-4 rounded-lg border border-border bg-bg p-3">
            <div className="text-xs font-medium text-text">本周榜单对外分享（公开链接，无需登录）</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number" min="1" value={expiresHours}
                onChange={e => setExpiresHours(e.target.value)}
                className="w-20 rounded-md border border-border bg-white px-2 py-1 text-xs outline-none focus:border-brand-500"
              />
              <span className="text-xs text-text-secondary">小时有效期</span>
              <input
                type="text" value={shareLabel} placeholder="备注（可选）"
                onChange={e => setShareLabel(e.target.value)}
                className="w-32 rounded-md border border-border bg-white px-2 py-1 text-xs outline-none focus:border-brand-500"
              />
              <button
                onClick={genShare} disabled={genBusy}
                className="fx-lift rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {genBusy ? '生成中…' : '生成链接'}
              </button>
            </div>
            {newShareUrl && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-brand-200 bg-white px-2 py-1.5">
                <input readOnly value={newShareUrl} className="min-w-0 flex-1 bg-transparent text-[11px] text-text-secondary outline-none" />
                <button onClick={copyUrl} className="fx-pop flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100">
                  {copied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
                </button>
              </div>
            )}
            {shareMsg && <div className="mt-1.5 text-[11px] text-text-secondary">{shareMsg}</div>}
            {shareList.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-text-muted">已有链接（点击 ✕ 吊销）：</div>
                {shareList.map(s => (
                  <div key={s.tokenMask} className="flex items-center gap-2 text-[11px]">
                    <span className={`rounded-full px-1.5 py-0.5 ${s.active ? 'bg-green-50 text-success' : 'bg-gray-100 text-text-secondary'}`}>
                      {s.active ? '有效' : '失效'}
                    </span>
                    <span className="text-text-secondary">{s.label || '（无备注）'}</span>
                    <span className="text-text-muted">至 {new Date(s.expiresAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <button onClick={() => revokeShare(s.token)} className="fx-pop ml-auto text-danger hover:opacity-70" title="吊销">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-4 rounded-lg bg-brand-50 p-3 text-xs text-text-secondary">
          <div className="mb-1 font-medium text-brand-800">赛制说明</div>
          <ul className="list-inside list-disc space-y-0.5">
            <li>晋级赛：当周流水 ≥ 2000 元 → 显示【已晋级】，下周进入排位赛</li>
            <li>排位赛：当周流水 ≥ 2000 元 → 争夺 TOP1/2/3 奖励金；流水 {'<'} 2000 元 → 取消前三资格，下周需达 ≥ 2000 元，下下周方可重回排位赛</li>
          </ul>
        </div>

        {/* 排位赛 TOP1/2/3 展示区（无排位赛主播达 2000 元时整体隐藏） */}
        {overallTop3.length > 0 && (
          <div className="fx-card mb-4 rounded-xl border border-border bg-gradient-to-br from-brand-50 to-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-text">
              <Crown size={16} className="text-warning" />
              本周排位赛巅峰榜 TOP 3
              {top3Week && (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-normal text-text-secondary">
                  {format(top3Week.weekStart, 'yyyy-MM-dd')} 至 {format(top3Week.weekEnd, 'yyyy-MM-dd')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {overallTop3.map((s, i) => (
                <div
                  key={s.主播id}
                  className={`fx-card flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm border ${
                    i === 0 ? 'border-yellow-300' : i === 1 ? 'border-gray-300' : 'border-orange-200'
                  }`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                    i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-text">{s.主播昵称}</div>
                    <div className="truncate text-[10px] text-text-secondary">房间号:{s.房间号}</div>
                    <div className="mt-0.5 text-sm font-semibold text-brand-700">
                      <Money value={s.总流水} className="font-bold text-brand-700" />
                    </div>
                  </div>
                  <Medal size={18} className={i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : 'text-orange-400'} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 赛道筛选 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm border border-border">
          <span className="text-xs text-text-secondary">赛道筛选：</span>
          {['全部', '晋级赛', '排位赛'].map(t => (
            <button
              key={t}
              onClick={() => setTrackFilter(t)}
              className={`fx-chip rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                trackFilter === t ? 'bg-brand-600 text-white' : 'border border-border bg-white text-text-secondary hover:border-brand-400 hover:text-brand-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {sortedWeekStats.map(week => {
            const isExpanded = expandedWeeks[week.label] !== false
            const top3 = week.list?.filter(s => s.是否获奖) || []
            const baseRows = trackFilter === '全部' ? (week.list || []) : (week.list || []).filter(r => r.赛道 === trackFilter)
            // 赛道筛选时按所选赛道内部流水重新排名，而非全部赛道混合名次
            const rows = [...baseRows].sort((a, b) => b.总流水 - a.总流水).map((r, i) => ({ ...r, 排名: i + 1 }))
            return (
              <div key={week.label} className="fx-card rounded-lg border border-border bg-white overflow-hidden">
                <button
                  onClick={() => toggleWeek(week.label)}
                  className="flex w-full items-center justify-between bg-bg px-4 py-3 text-left hover:bg-brand-50/50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text">
                      {format(week.weekStart, 'MM/dd')} ~ {format(week.weekEnd, 'MM/dd')}
                    </span>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-danger">
                      达标 {week.达标人数} 人
                    </span>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-danger">
                      周流水 <Money value={week.总流水} className="font-bold text-danger" />
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {top3.length > 0 && (
                      <div className="hidden items-center gap-1 sm:flex">
                        {top3.map(s => (
                          <span key={s.主播id} className="flex items-center gap-0.5 text-[10px] text-brand-600">
                            <Medal size={10} />
                            {s.主播昵称}
                          </span>
                        ))}
                      </div>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="overflow-x-auto bili-scrollbar">
                    <table className="w-full min-w-[600px] text-xs">
                      <thead>
                        <tr className="border-b border-border bg-white text-text-secondary">
                          <th className="px-3 py-2.5 text-center font-medium">排名</th>
                          <th className="px-3 py-2.5 text-left font-medium">主播</th>
                          <th className="px-3 py-2.5 text-left font-medium">赛道</th>
                          <th className="px-3 py-2.5 text-right font-medium">周流水</th>
                          <th className="px-3 py-2.5 text-center font-medium">晋级状态</th>
                          <th className="px-3 py-2.5 text-center font-medium">奖励资格</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map(row => (
                          <tr key={row.主播id} className="hover:bg-bg">
                            <td className="px-3 py-2.5 text-center">
                              {row.排名 <= 3 ? (
                                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                                  row.排名 === 1 ? 'bg-yellow-400' : row.排名 === 2 ? 'bg-gray-400' : 'bg-orange-400'
                                }`}>
                                  {row.排名}
                                </span>
                              ) : (
                                <span className="text-text-secondary">{row.排名}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white text-[10px]">
                                  {String(row.主播昵称).slice(0, 1)}
                                </div>
                                <div>
                                  <div className="font-medium text-text">{row.主播昵称}</div>
                                  <div className="text-[10px] text-text-secondary">{row.开播分区}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] ${trackBadgeClass(row.赛道)}`}>
                                {row.赛道}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium text-brand-700">
                              <Money value={row.总流水} className="font-bold text-danger" />
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusBadgeClass(row.晋级状态)}`}>
                                {row.晋级状态}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {row.是否获奖 ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-warning">
                                  <Crown size={12} />
                                  有
                                </span>
                              ) : (
                                <span className="text-[10px] text-text-muted">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(rows.length === 0) && (
                      <div className="py-8 text-center text-sm text-text-secondary">
                        {(!week.list || week.list.length === 0) ? '该周暂无数据' : '该赛道暂无数据'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {sortedWeekStats.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white py-12 text-sm text-text-secondary">
              <AlertCircle size={24} className="mb-2 text-text-muted" />
              当前日期范围内无自然周数据
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
