import { useState, useMemo } from 'react'
import {
  Users, Search, ArrowUp, ArrowDown, Minus, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Anchor, Wallet, Clock, CalendarDays,
  UserCog, Briefcase, UserX, ListChecks,
} from 'lucide-react'
import { aggByRoom, periodRange, parseAgent, num, fmt, money } from '../lib/metrics'
import { Money } from './Money'

// 在职状态排序权重（升序时：在职 → 未标记 → 离职）
const STATUS_ORDER = { '在职': 0, '未标记': 1, '离职': 2 }

// 列定义：基本信息（左） + 核心数据指标（右，随周期聚合）
const COLS = [
  { key: 'name', label: '主播昵称', type: 'str', group: 'info', width: 'min-w-[150px]' },
  { key: 'room', label: '房间号', type: 'str', group: 'info', width: 'min-w-[110px]' },
  { key: 'operator', label: '运营经纪人', type: 'str', group: 'info', width: 'min-w-[130px]' },
  { key: 'area', label: '开播分区', type: 'str', group: 'info', width: 'min-w-[110px]' },
  { key: 'status', label: '在职状态', type: 'status', group: 'info', width: 'min-w-[100px]' },
  { key: 'openDate', label: '开播日期', type: 'str', group: 'info', width: 'min-w-[110px]' },
  { key: 'guarantee', label: '保底金额', type: 'num', group: 'info', money: true, width: 'min-w-[110px]' },
  { key: 'rev', label: '总流水', type: 'num', group: 'metric', money: true, width: 'min-w-[120px]' },
  { key: 'cap', label: '大航海人数', type: 'num', group: 'metric', width: 'min-w-[100px]' },
  { key: 'days', label: '开播天数', type: 'num', group: 'metric', width: 'min-w-[90px]' },
  { key: 'hours', label: '直播时长(h)', type: 'num', group: 'metric', dp: 1, width: 'min-w-[100px]' },
  { key: 'paid', label: '付费人数', type: 'num', group: 'metric', width: 'min-w-[90px]' },
  { key: 'fans', label: '新增粉丝', type: 'num', group: 'metric', width: 'min-w-[90px]' },
  { key: 'danmu', label: '弹幕数', type: 'num', group: 'metric', width: 'min-w-[90px]' },
]

const PAGE_SIZE = 20

function statusBadgeCls(s) {
  if (s === '在职') return 'bg-green-50 text-success'
  if (s === '离职') return 'bg-gray-100 text-text-secondary'
  return 'bg-amber-50 text-amber-600'
}

function statusIcon(s) {
  if (s === '在职') return Briefcase
  if (s === '离职') return UserX
  return UserCog
}

function SortHeader({ col, sortKey, sortDesc, onSort }) {
  const active = sortKey === col.key
  const Icon = !active ? Minus : sortDesc ? ArrowDown : ArrowUp
  return (
    <th
      onClick={() => onSort(col.key)}
      className={`sticky top-0 z-10 cursor-pointer select-none px-3 py-2.5 font-medium hover:bg-brand-50/60 ${col.width || ''} ${
        col.type === 'num' ? 'text-right' : 'text-left'
      }`}
      title="点击排序"
    >
      <span className={`inline-flex items-center gap-1 ${col.type === 'num' ? 'flex-row-reverse' : ''}`}>
        {col.label}
        <Icon size={12} className={active ? 'text-brand-600' : 'text-slate-400'} />
      </span>
    </th>
  )
}

function compareRows(a, b, key, type, dir) {
  let r
  if (type === 'num') r = num(a[key]) - num(b[key])
  else if (type === 'status') r = (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
  else r = String(a[key] || '').localeCompare(String(b[key] || ''), 'zh-CN')
  return dir === 'desc' ? -r : r
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

export function OfflineStreamersDataPage({ offlineStreamers = [], records = [] }) {
  const [period, setPeriod] = useState('本月')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState('rev')
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(1)

  const range = useMemo(() => periodRange(period), [period])

  // 周期内按房间号聚合（含 大航海 最新快照口径，复用 lib/metrics 的 aggByRoom）
  const aggMap = useMemo(() => {
    const m = new Map()
    for (const r of aggByRoom(records, range)) {
      m.set(String(r['房间号'] || ''), r)
    }
    return m
  }, [records, range])

  const rows = useMemo(() => {
    return offlineStreamers.map(o => {
      const room = String(o['房间号'] || '')
      const a = aggMap.get(room) || {}
      return {
        room,
        name: String(o['主播昵称'] || room || '未知'),
        operator: parseAgent(o['运营经纪人']),
        area: String(o['开播分区'] || '').trim(),
        status: o['在职状态'] || '未标记',
        openDate: String(o['开播日期'] || '').trim(),
        guarantee: num(o['保底金额']),
        rev: num(a['总流水（元）']),
        cap: num(a['大航海人数']),
        days: num(a['开播天数']),
        hours: num(a['开播时长（小时）']),
        paid: num(a['付费人数']),
        fans: num(a['新增粉丝数']),
        danmu: num(a['弹幕数']),
      }
    })
  }, [offlineStreamers, aggMap])

  const filtered = useMemo(() => {
    let list = rows
    const kw = search.trim().toLowerCase()
    if (kw) {
      list = list.filter(r =>
        r.name.toLowerCase().includes(kw) ||
        r.room.includes(kw) ||
        r.operator.toLowerCase().includes(kw)
      )
    }
    if (statusFilter) list = list.filter(r => r.status === statusFilter)
    return list
  }, [rows, search, statusFilter])

  const sorted = useMemo(() => {
    const col = COLS.find(c => c.key === sortKey) || COLS[0]
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, col.type, sortDesc ? 'desc' : 'asc'))
  }, [filtered, sortKey, sortDesc])

  const summary = useMemo(() => {
    const s = { count: rows.length, active: 0, rev: 0, cap: 0, paid: 0, guarantee: 0 }
    for (const r of rows) {
      if (r.status === '在职') s.active += 1
      s.rev += r.rev
      s.cap += r.cap // 各房间大航海最新快照独立计数，求和即名册合计舰队数
      s.paid += r.paid
      if (r.status === '在职') s.guarantee += r.guarantee
    }
    return s
  }, [rows])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleSort(key) {
    const col = COLS.find(c => c.key === key)
    if (sortKey === key) {
      setSortDesc(d => !d)
    } else {
      setSortKey(key)
      setSortDesc(col && col.type === 'num')
    }
    setPage(1)
  }

  function renderCell(col, r) {
    if (col.key === 'status') {
      const Icon = statusIcon(r.status)
      return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeCls(r.status)}`}>
          <Icon size={10} />{r.status}
        </span>
      )
    }
    if (col.key === 'name') {
      return (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-400 text-[10px] text-white">
            {r.name.slice(0, 1)}
          </div>
          <span className="font-medium text-text">{r.name}</span>
        </div>
      )
    }
    if (col.type === 'num' && col.money) {
      const v = num(r[col.key])
      return v > 0 ? <Money value={v} /> : <span className="text-text-muted">—</span>
    }
    if (col.type === 'num') {
      const v = num(r[col.key])
      return v > 0 ? fmt(v, col.dp || 0) : <span className="text-text-muted">—</span>
    }
    const v = r[col.key]
    return v ? <span className="text-text-secondary">{v}</span> : <span className="text-text-muted">—</span>
  }

  if (!offlineStreamers.length) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary shadow-sm">
          暂无可分析的线下主播名册，请先在「线下主播管理」中录入线下主播房间号。
        </div>
      </div>
    )
  }

  const infoCols = COLS.filter(c => c.group === 'info')
  const metricCols = COLS.filter(c => c.group === 'metric')

  return (
    <div className="space-y-4 p-4">
      {/* 头部：标题 + 周期切换 */}
      <div className="fx-panel fx-enter rounded-2xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <ListChecks size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-text">线下主播数据列表</h2>
              <p className="text-[11px] text-text-muted">
                名册 {summary.count} 位线下主播 · 基本信息 + 核心数据指标 · 支持分页与排序
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg p-1">
            {['本月', '全部'].map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPage(1) }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p ? 'bg-white text-brand-700 shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 汇总卡 */}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="fx-card rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-4 text-white shadow-sm">
            <div className="flex items-center gap-1 text-xs text-white/80"><Users size={12} /> 线下主播</div>
            <div className="mt-1 text-2xl font-bold">{summary.count}</div>
            <div className="mt-1 text-[10px] text-white/70">在职 {summary.active} 人</div>
          </div>
          <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-text-secondary"><Wallet size={12} className="text-brand-600" /> {period}总流水</div>
            <div className="mt-1 text-xl font-bold text-text"><Money value={summary.rev} /></div>
          </div>
          <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-text-secondary"><Anchor size={12} className="text-brand-600" /> 大航海合计</div>
            <div className="mt-1 text-xl font-bold text-text">{fmt(summary.cap)} <span className="text-xs font-normal text-text-muted">人</span></div>
          </div>
          <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-text-secondary"><UserCog size={12} className="text-brand-600" /> 付费人数</div>
            <div className="mt-1 text-xl font-bold text-text">{fmt(summary.paid)}</div>
          </div>
          <div className="fx-card rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-text-secondary"><Wallet size={12} className="text-danger" /> 在职保底</div>
            <div className="mt-1 text-xl font-bold text-danger"><Money value={summary.guarantee} /></div>
          </div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="fx-panel fx-enter flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
        <div className="relative sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索主播昵称 / 房间号 / 运营"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-md border border-border py-1.5 pl-8 pr-3 text-xs outline-none focus:border-brand-500"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="border-none bg-transparent text-xs outline-none text-text-secondary"
          >
            <option value="">在职状态(全部)</option>
            <option value="在职">在职</option>
            <option value="离职">离职</option>
            <option value="未标记">未标记</option>
          </select>
        </div>
        <span className="ml-auto text-[11px] text-text-muted">
          共 {sorted.length} 条 · 点击表头排序
        </span>
      </div>

      {/* 列表表格 */}
      <div className="fx-panel fx-enter overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg text-text-secondary">
              <tr>
                <th colSpan={infoCols.length} className="border-b border-r border-border px-3 py-2 text-left text-[11px] font-semibold text-text-secondary">
                  基本信息
                </th>
                <th colSpan={metricCols.length} className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold text-brand-700">
                  核心数据指标（{period}）
                </th>
              </tr>
              <tr>
                {infoCols.map(c => <SortHeader key={c.key} col={c} sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />)}
                {metricCols.map(c => <SortHeader key={c.key} col={c} sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map(r => (
                <tr key={r.room} className="hover:bg-brand-50/40">
                  {COLS.map(c => (
                    <td
                      key={c.key}
                      className={`px-3 py-3 ${c.type === 'num' ? 'text-right tabular-nums' : 'text-left'}`}
                    >
                      {renderCell(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm text-text-secondary">没有符合条件的线下主播</div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-[11px] text-text-muted">
              共 {sorted.length} 条 · 第 {safePage}/{totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <PageBtn onClick={() => setPage(1)} disabled={safePage === 1} title="首页"><ChevronsLeft size={14} /></PageBtn>
              <PageBtn onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}><ChevronLeft size={14} /></PageBtn>
              <span className="px-2 text-xs font-medium text-text">{safePage}</span>
              <PageBtn onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}><ChevronRight size={14} /></PageBtn>
              <PageBtn onClick={() => setPage(totalPages)} disabled={safePage === totalPages} title="末页"><ChevronsRight size={14} /></PageBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
