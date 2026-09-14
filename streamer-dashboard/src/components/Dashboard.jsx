import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Search, ArrowUpDown, ChevronLeft, ChevronRight, Crown, Info, Clock, AlertTriangle, Users } from 'lucide-react'
import { parseISO, isWithinInterval, startOfMonth, endOfMonth, format, isSameDay } from 'date-fns'
import { QuickDateFilter } from './QuickDateFilter'
import { Money } from './Money'

const tableColumns = [
  { key: '主播昵称', label: '主播', width: 'min-w-[160px]' },
  { key: '开播分区', label: '开播分区', width: 'min-w-[90px]' },
  { key: '运营经纪人', label: '运营经纪人', width: 'min-w-[140px]' },
  { key: '主播在会时间', label: '在会时间', width: 'min-w-[90px]' },
  { key: '粉丝数', label: '粉丝数', width: 'min-w-[80px]', align: 'right' },
  { key: '总流水（元）', label: '总流水', width: 'min-w-[120px]', align: 'right' },
  { key: '总收益（元）', label: '总收益', width: 'min-w-[120px]', align: 'right' },
  { key: '开播天数', label: '开播天数', width: 'min-w-[80px]', align: 'right' },
  { key: '开播时长（小时）', label: '开播时长(h)', width: 'min-w-[110px]', align: 'right' },
  { key: '弹幕数', label: '弹幕数', width: 'min-w-[80px]', align: 'right' },
  { key: '大航海人数', label: '大航海人数', width: 'min-w-[90px]', align: 'right' },
]

const SUM_COLUMNS = [
  '总流水（元）', '总收益（元）', '主播自提礼物收益', '语聊房嘉宾收益（元）',
  '专属互动礼物收益（元）', '新增粉丝数', '弹幕数', '开播天数', '开播时长（小时）',
  'pk次数', 'pk流水', 'pk付费人数', '违规次数', '峰值在线人数（pcu）',
  '平均在线人数（acu）', '付费人数',
]

// 时点快照型字段：累计值（如大航海/舰队数），取时间段内「最新一天」的值，不可跨日求和
const SNAPSHOT_COLUMNS = ['大航海人数']

function formatNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

function parseStatEndDate(statTimeStr) {
  if (!statTimeStr) return null
  const match = String(statTimeStr).match(/(\d{4}-\d{2}-\d{2})/g)
  return match && match.length >= 1 ? parseISO(`${match[match.length - 1]}T00:00:00`) : null
}

const PAGE_SIZE = 20

function inDateRange(r, range) {
  if (!range || range.label === '全部') return true
  const ed = parseStatEndDate(r['统计时间'])
  if (!ed) return false
  return isWithinInterval(ed, { start: range.start, end: range.end })
}

function aggregateByRoom(records, dateRange) {
  const filtered = records.filter(r => inDateRange(r, dateRange))
  const byRoom = new Map()
  const snapLatest = new Map() // room -> { date: Date, value: number }
  filtered.forEach(r => {
    const room = String(r['房间号'] || r['主播id'] || '')
    if (!room) return
    const existing = byRoom.get(room)
    const base = existing || {}
    const next = { ...base, ...r }
    // 文本类字段优先保留非空值
    ;['主播昵称', '主播id', '开播分区', '运营经纪人', '主播在会时间'].forEach(k => {
      if (!next[k] && base[k]) next[k] = base[k]
      if (!next[k] && r[k]) next[k] = r[k]
    })
    // 数值类字段在当前时间段内求和
    SUM_COLUMNS.forEach(k => {
      next[k] = Number(base[k] || 0) + Number(r[k] || 0)
    })
    // 时点快照型字段：取统计时间最新的一条对应值（大航海人数为累计舰队数，跨日求和会严重虚高）
    for (const k of SNAPSHOT_COLUMNS) {
      const rd = parseStatEndDate(r['统计时间'])
      const prev = snapLatest.get(room)
      if (rd && (!prev || rd >= prev.date)) {
        next[k] = Number(r[k] || 0)
        snapLatest.set(room, { date: rd, value: Number(r[k] || 0) })
      } else if (prev) {
        next[k] = prev.value
      }
    }
    // 粉丝数取最大值（粉丝数是时点指标）
    next['粉丝数'] = Math.max(Number(base['粉丝数'] || 0), Number(r['粉丝数'] || 0))
    byRoom.set(room, next)
  })
  return Array.from(byRoom.values())
}

/** 数字滚动动画（count-up） */
function AnimatedNumber({ value, format = (v) => v.toLocaleString('zh-CN'), className }) {
  const [disp, setDisp] = useState(Number(value) || 0)
  const fromRef = useRef(Number(value) || 0)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = Number(value) || 0
    if (from === to) { setDisp(to); return }
    const start = performance.now()
    const dur = 700
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisp(from + (to - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])
  return <span className={className}>{format(disp)}</span>
}

function SummaryCard({ label, value, sub, accent, glow }) {
  return (
    <div className={`fx-card fx-enter group relative overflow-hidden rounded-2xl border border-border bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-brand-200`}>
      <div className={`absolute -right-6 -top-6 h-16 w-16 rounded-full opacity-20 blur-xl ${glow}`} />
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`mt-1 text-2xl font-bold lg:text-3xl tabular-nums ${accent}`}>{value}</div>
      <div className="mt-1 text-[11px] text-text-muted">{sub}</div>
    </div>
  )
}

function SkeletonBlock({ className = '' }) {
  return <div className={`fx-skeleton h-4 rounded ${className}`} />
}

/** 主播信息浮层（hover 触发） */
function StreamerPopover({ row, style }) {
  const items = [
    { k: '运营经纪人', v: row['运营经纪人'] },
    { k: '开播分区', v: row['开播分区'] },
    { k: '主播在会时间', v: row['主播在会时间'] },
    { k: '粉丝数', v: formatNum(row['粉丝数']) },
    { k: '总收益（元）', v: '¥' + formatNum(row['总收益（元）']) },
    { k: '开播天数', v: row['开播天数'] },
    { k: '开播时长（小时）', v: row['开播时长（小时）'] },
    { k: '弹幕数', v: formatNum(row['弹幕数']) },
    { k: '大航海人数', v: row['大航海人数'] },
  ]
  return (
    <div
      className="fx-pop pointer-events-none fixed z-40 w-60 rounded-xl border border-border bg-white/95 p-3 text-xs shadow-xl backdrop-blur"
      style={style}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-400 text-white text-[11px]">
          {String(row['主播昵称']).slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-text">{row['主播昵称']}</div>
          <div className="text-[10px] text-text-muted">房间号 {row['房间号']}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map(it => (
          <div key={it.k} className="flex flex-col">
            <span className="text-[10px] text-text-muted">{it.k}</span>
            <span className="font-medium text-text">{it.v ?? '-'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Dashboard({ records, loading, onNavigate }) {
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    return { start: startOfMonth(now), end: endOfMonth(now), label: '本月' }
  })
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('总流水（元）')
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(1)
  const [hovered, setHovered] = useState(null) // { row, style }
  const [status, setStatus] = useState(null)

  const handleApply = useCallback((range) => setDateRange(range), [])

  // 拉取抓取状态：用于展示「昨日数据快照」新鲜度（接口同步说明）
  useEffect(() => {
    let alive = true
    fetch('./api/status')
      .then(r => r.json())
      .then(j => { if (alive) setStatus(j) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // 按当前时间段聚合到主播维度，仅保留有流水的主播（用于列表展示）
  const aggregated = useMemo(() => {
    return aggregateByRoom(records, dateRange).filter(r => Number(r['总流水（元）'] || 0) >= 1)
  }, [records, dateRange])

  // 全量聚合（含 <1 元小额打赏），仅用于总流水汇总，避免 0~1 元打赏被口径过滤掉
  const aggregatedFull = useMemo(() => {
    return aggregateByRoom(records, dateRange)
  }, [records, dateRange])

  const filtered = useMemo(() => {
    let list = aggregated
    if (search.trim()) {
      const kw = search.toLowerCase()
      list = list.filter(r =>
        String(r['主播昵称']).toLowerCase().includes(kw) ||
        String(r['主播id']).includes(kw) ||
        String(r['房间号']).includes(kw) ||
        String(r['运营经纪人']).toLowerCase().includes(kw)
      )
    }
    list = [...list].sort((a, b) => {
      const av = Number(a[sortKey] || 0)
      const bv = Number(b[sortKey] || 0)
      return sortDesc ? bv - av : av - bv
    })
    return list
  }, [aggregated, search, sortKey, sortDesc])

  // 数据或排序变化时回到第一页
  useEffect(() => { setPage(1) }, [filtered.length, sortKey, sortDesc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // 当前选中区间的总流水（全量，含 <1 元小额打赏）与有流水主播数（过滤后计数）
  const rangeRevenue = aggregatedFull.reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)
  const rangeCount = aggregated.length

  // 本月（固定维度）有流水主播数与总流水
  const monthRange = useMemo(() => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()), label: '本月' }), [])
  const monthAggregated = useMemo(() => {
    return aggregateByRoom(records, monthRange).filter(r => Number(r['总流水（元）'] || 0) >= 1)
  }, [records, monthRange])
  const monthAggregatedFull = useMemo(() => {
    return aggregateByRoom(records, monthRange)
  }, [records, monthRange])
  const monthRevenue = monthAggregatedFull.reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)

  // 昨日快照新鲜度
  const yesterdayInfo = useMemo(() => {
    if (!status?.lastYesterday) return null
    const d = new Date(status.lastYesterday)
    const hh = d.getHours()
    return {
      label: format(d, 'MM-dd HH:mm'),
      isFinal: hh >= 20, // 20:00 收盘补抓后为最终结算
      isToday: isSameDay(d, new Date()),
    }
  }, [status])

  // 统计时间范围格式化
  function formatStatTime(range) {
    if (!range) {
      const dates = records.map(r => r['统计日期'] || '').filter(Boolean).sort()
      if (!dates.length) return '无数据'
      return `${dates[0]} 00:00 ~ ${dates[dates.length - 1]} 23:59`
    }
    const start = format(range.start, 'yyyy-MM-dd') + ' 00:00'
    const now = new Date()
    const endIsNow = isSameDay(range.end, now) || range.end > now
    const end = endIsNow ? format(now, 'yyyy-MM-dd HH:mm') : format(range.end, 'yyyy-MM-dd') + ' 23:59'
    return `${start} ~ ${end}`
  }

  function handleSort(key) {
    if (sortKey === key) setSortDesc(!sortDesc)
    else { setSortKey(key); setSortDesc(true) }
  }

  // hover 浮层定位：根据行位置放在右侧或左侧
  function onRowEnter(e, row) {
    const rect = e.currentTarget.getBoundingClientRect()
    const popW = 240
    const popH = 230
    let left = rect.right + 12
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 12
    if (left < 8) left = 8
    let top = rect.top + rect.height / 2 - popH / 2
    top = Math.max(8, Math.min(top, window.innerHeight - popH - 8))
    setHovered({ row, style: { left, top, width: popW } })
  }

  return (
    <div className="space-y-4 p-4">
      {/* 头部：标题 + 日期筛选 + 昨日快照状态 */}
      <div className="fx-panel fx-enter rounded-2xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <BarChartMini />
            <h2 className="text-base font-semibold text-text">我的主播数据概况</h2>
            {yesterdayInfo && (
              <span
                className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  yesterdayInfo.isFinal
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
                title="昨日数据由每日 13:00 早盘快照与 20:00 收盘补抓两批写入；20:00 前为早盘快照，可能略低于 B站 后台最终值（延迟结算）"
              >
                <Clock size={11} />
                昨日更新 {yesterdayInfo.label}
                {yesterdayInfo.isFinal ? ' · 已结算' : ' · 早盘快照'}
              </span>
            )}
            {typeof onNavigate === 'function' && (
              <button
                onClick={() => onNavigate('offlinelist')}
                className="fx-lift ml-1 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                title="查看线下主播数据列表（基本信息 + 核心指标，支持分页与排序）"
              >
                <Users size={11} /> 线下主播数据列表
                <ChevronRight size={11} />
              </button>
            )}
          </div>
          <QuickDateFilter onApply={handleApply} defaultMode="month" />
        </div>

        {/* 汇总卡：加载时显示骨架，否则显示数字滚动 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {loading ? (
            <>
              <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm"><SkeletonBlock className="w-20" /><SkeletonBlock className="mt-2 w-28 h-7" /><SkeletonBlock className="mt-2 w-16" /></div>
              <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm"><SkeletonBlock className="w-20" /><SkeletonBlock className="mt-2 w-28 h-7" /><SkeletonBlock className="mt-2 w-16" /></div>
              <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm"><SkeletonBlock className="w-20" /><SkeletonBlock className="mt-2 w-28 h-7" /><SkeletonBlock className="mt-2 w-16" /></div>
              <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm"><SkeletonBlock className="w-20" /><SkeletonBlock className="mt-2 w-28 h-7" /><SkeletonBlock className="mt-2 w-16" /></div>
            </>
          ) : (
            <>
              <SummaryCard
                label={`总流水（${dateRange?.label || '全部'}）`}
                value={<AnimatedNumber value={rangeRevenue} format={(v) => '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />}
                sub={`${rangeCount} 位有流水主播`}
                accent="text-brand-700"
                glow="bg-brand-400"
              />
              <SummaryCard
                label="本月有流水主播"
                value={<AnimatedNumber value={monthAggregated.length} />}
                sub={<span>本月总流水 <Money value={monthRevenue} /></span>}
                accent="text-emerald-600"
                glow="bg-emerald-400"
              />
              <SummaryCard
                label="当前区间主播数"
                value={<AnimatedNumber value={filtered.length} />}
                sub={`搜索/筛选后 ${filtered.length} 位`}
                accent="text-text"
                glow="bg-slate-300"
              />
              <SummaryCard
                label="数据延迟说明"
                value={yesterdayInfo ? (yesterdayInfo.isFinal ? '已结算' : '早盘') : '—'}
                sub={yesterdayInfo ? `昨日快照 ${yesterdayInfo.label}` : '接口同步中'}
                accent={yesterdayInfo?.isFinal ? 'text-emerald-600' : 'text-amber-600'}
                glow={yesterdayInfo?.isFinal ? 'bg-emerald-400' : 'bg-amber-400'}
              />
            </>
          )}
        </div>

        {yesterdayInfo && !yesterdayInfo.isFinal && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              昨日总流水取自 <b>13:00 早盘快照</b>，B站 礼物/大航海按日汇总存在 T+N 延迟结算，可能略低于后台最终值；
              系统每日 <b>20:00 收盘补抓</b> 会覆盖为最终结算。如需即时校正可在「数据自动同步」点击【抓取昨日】。
            </span>
          </div>
        )}
      </div>

      {/* 主播汇总表 */}
      <div className="fx-panel fx-enter rounded-2xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-text">主播汇总</h2>
            <span className="text-xs text-text-muted">
              {dateRange?.label || '全部'} · 共 {filtered.length} 位有流水主播
            </span>
            <span className="rounded bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
              统计时间：{formatStatTime(dateRange)}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-2 py-0.5 text-[11px] text-text-secondary">
              <Info size={11} /> 悬停行查看详情
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative sm:w-64">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                placeholder="搜索主播昵称/ID/房间号"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-brand-500 focus:bg-white"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bili-scrollbar">
          <table className="w-full min-w-[1000px] text-xs">
            <thead>
              <tr className="border-b border-border bg-bg text-text-secondary">
                {tableColumns.map(col => (
                  <th
                    key={col.key}
                    className={`fx-th cursor-pointer px-3 py-2.5 font-medium transition-colors hover:bg-brand-50 hover:text-brand-700 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.width}`}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      {col.label}
                      {sortKey === col.key && <ArrowUpDown size={12} className={sortDesc ? '' : 'rotate-180'} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map(row => (
                <tr
                  key={`${row['房间号']}-${row['统计日期'] || ''}`}
                  className="group transition-colors duration-150 hover:bg-brand-50/60"
                  onMouseEnter={(e) => onRowEnter(e, row)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-400 text-white text-[10px] transition-transform group-hover:scale-110">
                        {String(row['主播昵称']).slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text group-hover:text-brand-700">
                          {row['主播昵称']}
                          <span className="ml-1 text-[10px] font-normal text-text-secondary">（{row['房间号']}）</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary">{row['开播分区']}</td>
                  <td className="px-3 py-2.5 text-text-secondary">{row['运营经纪人']}</td>
                  <td className="px-3 py-2.5 text-text-secondary">{row['主播在会时间']}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(row['粉丝数'])}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-brand-700">
                    <Money value={row['总流水（元）']} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(row['总收益（元）'])}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(row['开播天数'])}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(row['开播时长（小时）'])}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNum(row['弹幕数'])}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-0.5 text-brand-600">
                      <Crown size={12} />
                      {formatNum(row['大航海人数'])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-text-secondary">
            暂无符合条件的数据
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-xs text-text-secondary">
            <span>第 {page} / {totalPages} 页，共 {filtered.length} 条</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="fx-lift flex items-center gap-0.5 rounded-md border border-border px-2 py-1 transition-colors hover:bg-bg disabled:opacity-40"
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="fx-lift flex items-center gap-0.5 rounded-md border border-border px-2 py-1 transition-colors hover:bg-bg disabled:opacity-40"
              >
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {hovered && <StreamerPopover row={hovered.row} style={hovered.style} />}
    </div>
  )
}

function BarChartMini() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-brand-600">
      <rect x="3" y="10" width="4" height="11" rx="1" fill="currentColor" />
      <rect x="10" y="6" width="4" height="15" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}
