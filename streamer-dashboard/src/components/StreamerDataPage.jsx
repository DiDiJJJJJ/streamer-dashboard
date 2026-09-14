import { useEffect, useMemo, useState } from 'react'
import {
  Users, Search, ArrowUp, ArrowDown, Minus, Wallet, Clock, CalendarDays, Anchor,
  TrendingUp, Filter, LayoutGrid, Table2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Flame,
} from 'lucide-react'
import { Money } from './Money'

function formatNum(n, decimals = 0) {
  return Number(n || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function personOf(raw) {
  const s = String(raw || '').trim()
  if (!s) return '未分配'
  return s.split('|')[0].trim() || '未分配'
}

function prevMonthKey(m) {
  if (!m) return ''
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-').map(Number)
  return `${y}年${mo}月`
}

function latestCaptain(entries) {
  if (!entries || !entries.length) return 0
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  return sorted[sorted.length - 1].cap
}

const METRICS = [
  { key: 'rev', label: '总流水', icon: Wallet, isMoney: true, unit: '元' },
  { key: 'hours', label: '直播时长', icon: Clock, isMoney: false, unit: '小时', decimals: 1 },
  { key: 'days', label: '开播天数', icon: CalendarDays, isMoney: false, unit: '天' },
  { key: 'cap', label: '大航海数量', icon: Anchor, isMoney: false, unit: '人' },
]

function deltaInfo(cur, prev) {
  const delta = cur - prev
  if (prev === 0 && cur === 0) return { dir: 0, delta: 0, pct: 0, isNew: false }
  if (prev === 0 && cur > 0) return { dir: 1, delta, pct: null, isNew: true }
  const pct = (delta / prev) * 100
  return { dir: delta > 0 ? 1 : delta < 0 ? -1 : 0, delta, pct, isNew: false }
}

function DeltaPill({ cur, prev, isMoney }) {
  const { dir, delta, pct, isNew } = deltaInfo(cur, prev)
  if (dir === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-text-muted">
        <Minus size={11} /> 持平
      </span>
    )
  }
  const color = dir > 0 ? 'text-danger' : 'text-success'
  const Icon = dir > 0 ? ArrowUp : ArrowDown
  const deltaStr = isMoney
    ? <Money value={Math.abs(delta)} prefix={dir > 0 ? '+' : '-'} />
    : `${dir > 0 ? '+' : '-'}${formatNum(Math.abs(delta), isMoney ? 0 : 1)}`
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${color} ${
      dir > 0 ? 'bg-red-50' : 'bg-green-50'
    }`}>
      <Icon size={11} />
      {deltaStr}
      {isNew
        ? <span className="ml-0.5 opacity-80">新增</span>
        : <span className="ml-0.5 opacity-80">({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)</span>}
    </span>
  )
}

function MiniBars({ cur, prev }) {
  const max = Math.max(cur, prev, 1)
  const cw = ((cur / max) * 100).toFixed(1)
  const pw = ((prev / max) * 100).toFixed(1)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="w-7 shrink-0 text-[10px] text-text-muted">本月</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${cw}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-7 shrink-0 text-[10px] text-text-muted">上月</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-slate-300 transition-all" style={{ width: `${pw}%` }} />
        </div>
      </div>
    </div>
  )
}

function MetricCell({ m, cur, prev }) {
  return (
    <div className="leading-tight">
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold text-text">{m.isMoney ? <Money value={cur} /> : formatNum(cur, m.decimals || 0)}</span>
        <DeltaPill cur={cur} prev={prev} isMoney={m.isMoney} />
      </div>
      <div className="mt-0.5 text-[11px] text-text-muted">
        上月 {m.isMoney ? <Money value={prev} /> : formatNum(prev, m.decimals || 0)} {m.unit}
      </div>
      <MiniBars cur={cur} prev={prev} />
    </div>
  )
}

function StreamerCard({ s }) {
  return (
    <div className="fx-card rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text" title={s.name}>{s.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
            <span>房间号 {s.room}</span>
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{s.person}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {METRICS.map(m => (
          <div key={m.key} className="rounded-lg border border-border bg-bg/50 p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary">
              <m.icon size={13} className="text-brand-600" />{m.label}
            </div>
            <MetricCell m={m} cur={s.cur[m.key]} prev={s.prev[m.key]} />
          </div>
        ))}
      </div>
    </div>
  )
}

function HighlightCard({ streamer, metricKey }) {
  if (!streamer || !metricKey) return null
  const m = METRICS.find(x => x.key === metricKey)
  const cur = streamer.cur[m.key]
  const prev = streamer.prev[m.key]
  const { dir, pct, isNew } = deltaInfo(cur, prev)
  const up = dir > 0
  return (
    <div className="fx-enter fx-lift relative overflow-hidden rounded-xl border-2 border-danger/40 bg-gradient-to-r from-red-50 to-white p-4 shadow-sm">
      <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-danger/10" />
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Flame size={20} />
          </div>
          <div>
            <div className="text-xs font-medium text-text-secondary">数据变化最大 · {streamer.person}</div>
            <div className="text-base font-bold text-text">
              {streamer.name} <span className="text-[11px] font-normal text-text-muted">房间号 {streamer.room}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-text-secondary">{m.label}</div>
            <div className="text-xl font-bold text-text">{m.isMoney ? <Money value={cur} /> : formatNum(cur, m.decimals || 0)}</div>
          </div>
          <div className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold ${up ? 'bg-red-100 text-danger' : dir < 0 ? 'bg-green-100 text-success' : 'bg-slate-100 text-text-muted'}`}>
            {up ? <ArrowUp size={16} /> : dir < 0 ? <ArrowDown size={16} /> : <Minus size={16} />}
            {isNew ? '新增' : `${up ? '+' : ''}${pct.toFixed(1)}%`}
          </div>
        </div>
      </div>
    </div>
  )
}

export function StreamerDataPage({ records }) {
  const [sel, setSel] = useState('全部')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('rev')
  const [sortDesc, setSortDesc] = useState(true)
  const [view, setView] = useState('table')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const model = useMemo(() => {
    const rooms = {}
    for (const r of records || []) {
      const room = String(r['房间号'] || '').trim()
      if (!room) continue
      const m = String(r['统计开始日期'] || '').slice(0, 7)
      if (!m) continue
      const person = personOf(r['运营经纪人'])
      const date = String(r['统计开始日期'] || '')
      const name = String(r['主播昵称'] || '').trim() || room
      const rev = Number(r['总流水（元）'] || 0)
      const hours = Number(r['开播时长（小时）'] || 0)
      const days = Number(r['开播天数'] || 0)
      const cap = Number(r['大航海人数'] || 0)

      if (!rooms[room]) rooms[room] = { room, name, person, nameByDate: {}, months: {} }
      const rm = rooms[room]
      if (!rm.months[m]) rm.months[m] = { rev: 0, hours: 0, days: 0, capEntries: [], maxDate: '' }
      const mo = rm.months[m]
      mo.rev += rev
      mo.hours += hours
      mo.days += days
      mo.capEntries.push({ date, cap })
      if (date > mo.maxDate) mo.maxDate = date
      if (date >= (rm.nameByDate._max || '')) {
        rm.nameByDate._max = date
        rm.name = name
      }
    }

    const allMonths = new Set()
    Object.values(rooms).forEach(rm => Object.keys(rm.months).forEach(mm => allMonths.add(mm)))
    const monthsSorted = [...allMonths].sort()
    const curMonth = monthsSorted[monthsSorted.length - 1] || ''
    const prevMonth = curMonth ? prevMonthKey(curMonth) : ''
    const prevHasData = monthsSorted.includes(prevMonth)

    const personAgg = {}
    Object.values(rooms).forEach(rm => {
      const p = rm.person
      if (!personAgg[p]) personAgg[p] = { person: p, count: 0, rev: 0 }
      personAgg[p].count += 1
      personAgg[p].rev += rm.months[curMonth] ? rm.months[curMonth].rev : 0
    })
    const operators = Object.values(personAgg).sort((a, b) => b.rev - a.rev)

    return {
      rooms,
      curMonth,
      prevMonth,
      prevHasData,
      operators,
      curMonthMaxDate: curMonth
        ? Object.values(rooms).reduce((mx, rm) => {
            const md = rm.months[curMonth] ? (rm.months[curMonth].maxDate || '') : ''
            return md > mx ? md : mx
          }, '')
        : '',
    }
  }, [records])

  const { rooms, curMonth, prevMonth, prevHasData, operators, curMonthMaxDate } = model

  const streamers = useMemo(() => {
    const list = Object.values(rooms)
      .filter(rm => sel === '全部' ? true : rm.person === sel)
      .map(rm => {
        const cur = rm.months[curMonth] || { rev: 0, hours: 0, days: 0, capEntries: [] }
        const prev = (prevHasData && rm.months[prevMonth]) || { rev: 0, hours: 0, days: 0, capEntries: [] }
        return {
          room: rm.room,
          name: rm.name,
          person: rm.person,
          cur: { rev: cur.rev, hours: cur.hours, days: cur.days, cap: latestCaptain(cur.capEntries) },
          prev: { rev: prev.rev, hours: prev.hours, days: prev.days, cap: latestCaptain(prev.capEntries) },
        }
      })

    const kw = search.trim().toLowerCase()
    const filtered = kw
      ? list.filter(s => s.name.toLowerCase().includes(kw) || s.room.toLowerCase().includes(kw))
      : list

    const dir = sortDesc ? -1 : 1
    filtered.sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name, 'zh-CN')
      return dir * ((a.cur[sortKey] || 0) - (b.cur[sortKey] || 0))
    })
    return filtered
  }, [rooms, sel, search, sortKey, sortDesc, curMonth, prevMonth, prevHasData])

  const summary = useMemo(() => {
    const sum = (f) => streamers.reduce((s, x) => s + (x.cur[f] || 0), 0)
    const sumPrev = (f) => streamers.reduce((s, x) => s + (x.prev[f] || 0), 0)
    return {
      count: streamers.length,
      rev: sum('rev'), prevRev: sumPrev('rev'),
      hours: sum('hours'), prevHours: sumPrev('hours'),
      days: sum('days'), prevDays: sumPrev('days'),
      cap: sum('cap'), prevCap: sumPrev('cap'),
    }
  }, [streamers])

  const highlight = useMemo(() => {
    if (!prevHasData || streamers.length === 0) return null
    let best = null
    for (const s of streamers) {
      for (const m of METRICS) {
        const cur = s.cur[m.key]
        const prev = s.prev[m.key]
        const { dir, pct, isNew } = deltaInfo(cur, prev)
        if (dir === 0) continue
        const score = isNew ? Infinity : Math.abs(pct)
        if (!best || score > best.score) {
          best = { streamer: s, metricKey: m.key, score, dir }
        }
      }
    }
    return best
  }, [streamers, prevHasData])

  // 分页重置
  const totalPages = Math.max(1, Math.ceil(streamers.length / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const paged = streamers.slice((page - 1) * pageSize, page * pageSize)

  if (!records || records.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary shadow-sm">
          暂无可分析的数据，请先完成数据同步或导入。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {/* 运营人员切换 */}
      <div className="fx-panel fx-enter sticky top-0 z-20 -mx-4 bg-bg px-4 pb-2 pt-0.5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
          <Users size={16} className="text-brand-600" />
          运营人员
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">点击查看其名下主播数据对比</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSel('全部'); setPage(1) }}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
              sel === '全部'
                ? 'border-brand-500 bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.6)]'
                : 'border-border bg-white text-text-secondary hover:border-brand-300 hover:text-brand-700'
            }`}
          >
            全部
            <span className={`rounded-full px-1.5 text-[10px] ${sel === '全部' ? 'bg-white/20' : 'bg-bg text-text-muted'}`}>{operators.reduce((s, o) => s + o.count, 0)}</span>
          </button>
          {operators.map(o => (
            <button
              key={o.person}
              onClick={() => { setSel(o.person); setPage(1) }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                sel === o.person
                  ? 'border-brand-500 bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.6)]'
                  : 'border-border bg-white text-text-secondary hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {o.person}
              <span className={`rounded-full px-1.5 text-[10px] ${sel === o.person ? 'bg-white/20' : 'bg-bg text-text-muted'}`}>{o.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 对比周期 */}
      <div className="fx-panel fx-enter flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-text">对比周期</span>
          <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
            {monthLabel(curMonth)}（截至 {curMonthMaxDate ? curMonthMaxDate.slice(5) : '—'}）
          </span>
          <span className="text-text-muted">vs</span>
          {prevHasData ? (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-text-secondary">{monthLabel(prevMonth)}</span>
          ) : (
            <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">上月（暂无数据）</span>
          )}
        </div>
        {!prevHasData && (
          <span className="text-[11px] text-text-muted">系统自 {curMonth || '—'} 月起开始采集，次月将自动生成环比对比</span>
        )}
      </div>

      {/* 汇总条 */}
      <div className="fx-panel fx-enter grid grid-cols-2 gap-3 rounded-xl border border-border bg-white p-4 shadow-sm lg:grid-cols-4">
        <SummaryItem label={`名下主播数（${sel === '全部' ? '全部' : sel}）`} value={formatNum(summary.count)} />
        <SummaryItem label="本月总流水" value={<Money value={summary.rev} />} cur={summary.rev} prev={prevHasData ? summary.prevRev : undefined} isMoney />
        <SummaryItem label="本月直播时长" value={`${formatNum(summary.hours, 1)} 小时`} cur={summary.hours} prev={prevHasData ? summary.prevHours : undefined} />
        <SummaryItem label="本月大航海数量" value={`${formatNum(summary.cap)} 人`} cur={summary.cap} prev={prevHasData ? summary.prevCap : undefined} />
      </div>

      {/* 变化最大高亮 */}
      {highlight && <HighlightCard streamer={highlight.streamer} metricKey={highlight.metricKey} />}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5">
          <Search size={13} className="text-text-secondary" />
          <input
            type="text"
            placeholder="搜索主播昵称 / 房间号"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-44 border-none bg-transparent text-xs outline-none"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
          <Filter size={12} className="text-text-secondary" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="border-none bg-transparent text-xs outline-none"
          >
            <option value="rev">按本月流水</option>
            <option value="hours">按本月时长</option>
            <option value="days">按本月开播天数</option>
            <option value="cap">按本月大航海</option>
            <option value="name">按昵称</option>
          </select>
        </div>
        <button
          onClick={() => setSortDesc(d => !d)}
          className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text-secondary hover:bg-bg"
        >
          {sortDesc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
          {sortDesc ? '降序' : '升序'}
        </button>
        <div className="ml-auto flex items-center rounded-md border border-border bg-white p-0.5">
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === 'table' ? 'bg-brand-600 text-white' : 'text-text-secondary hover:bg-bg'}`}
          >
            <Table2 size={12} /> 表格
          </button>
          <button
            onClick={() => setView('card')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === 'card' ? 'bg-brand-600 text-white' : 'text-text-secondary hover:bg-bg'}`}
          >
            <LayoutGrid size={12} /> 卡片
          </button>
        </div>
      </div>

      {/* 内容区 */}
      {streamers.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary shadow-sm">
          {search ? '未找到匹配的主播' : '该运营人员暂无名下主播数据'}
        </div>
      ) : view === 'table' ? (
        <div className="fx-panel fx-enter overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg text-text-secondary">
                <tr>
                  <th className="sticky top-0 z-10 min-w-[160px] px-3 py-2.5 font-medium">主播</th>
                  {METRICS.map(m => (
                    <th key={m.key} className="sticky top-0 z-10 min-w-[180px] px-3 py-2.5 font-medium">
                      <span className="flex items-center gap-1"><m.icon size={12} className="text-brand-600" />{m.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map(s => (
                  <tr key={s.room} className="hover:bg-bg/60">
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold text-text">{s.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
                        <span>房间号 {s.room}</span>
                        <span className="rounded bg-brand-50 px-1 py-0.5 text-brand-700">{s.person}</span>
                      </div>
                    </td>
                    {METRICS.map(m => (
                      <td key={m.key} className="px-3 py-3 align-top">
                        <MetricCell m={m} cur={s.cur[m.key]} prev={s.prev[m.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={streamers.length} onChange={setPage} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {paged.map(s => <StreamerCard key={s.room} s={s} />)}
          </div>
          <Pagination page={page} totalPages={totalPages} total={streamers.length} onChange={setPage} />
        </div>
      )}

      <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-text-muted">
        <TrendingUp size={12} />
        红=本月较上月增长 · 绿=下降 · 环比基于本月与上月同口径聚合
      </div>
    </div>
  )
}

function SummaryItem({ label, value, cur, prev, isMoney }) {
  return (
    <div className="rounded-xl border border-border bg-bg/40 p-3">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className="mt-1 text-xl font-bold text-text lg:text-2xl">{value}</div>
      {cur !== undefined && prev !== undefined && (
        <div className="mt-0.5">
          <DeltaPill cur={cur} prev={prev} isMoney={isMoney} />
        </div>
      )}
    </div>
  )
}

function Pagination({ page, totalPages, total, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <span className="text-[11px] text-text-muted">共 {total} 条 · 第 {page}/{totalPages} 页</span>
      <div className="flex items-center gap-1">
        <PageBtn onClick={() => onChange(1)} disabled={page === 1} title="首页"><ChevronsLeft size={14} /></PageBtn>
        <PageBtn onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft size={14} /></PageBtn>
        <span className="px-2 text-xs font-medium text-text">{page}</span>
        <PageBtn onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}><ChevronRight size={14} /></PageBtn>
        <PageBtn onClick={() => onChange(totalPages)} disabled={page === totalPages} title="末页"><ChevronsRight size={14} /></PageBtn>
      </div>
    </div>
  )
}

function PageBtn({ children, onClick, disabled, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md border text-text-secondary transition-all ${
        disabled
          ? 'cursor-not-allowed border-border bg-bg opacity-50'
          : 'border-border bg-white hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  )
}
