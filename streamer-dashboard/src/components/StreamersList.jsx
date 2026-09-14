import { useState, useMemo, Fragment } from 'react'
import { Search, Users, Briefcase, UserX, Plus, Upload, Trash2, Calendar, Filter, Wallet, Radio, ListChecks, FileDown, HelpCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { readExcelFile } from '../utils/excel'
import { Money } from './Money'

function formatNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

function parseStatDates(statTimeStr) {
  if (!statTimeStr) return []
  const match = String(statTimeStr).match(/(\d{4}-\d{2}-\d{2})/g)
  return match || []
}

// Excel 日期标准化：支持 Date 对象、Excel 序列号、各类中文/斜杠日期字符串 → YYYY-MM-DD
function normalizeDate(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number') {
    // Excel 日期序列号（1900 日期系统）
    const d = new Date((v - 25569) * 86400 * 1000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  return s
}

// 生成「线下主播导入模板」并触发下载（表头：房间号 / 开播日期 / 保底金额 / 在职状态）
function downloadTemplate() {
  const aoa = [
    ['房间号', '开播日期', '保底金额', '在职状态'],
    ['10012345', '2026-08-10', '3000', '在职'],
    ['10012346', '2026-08-11', '2500', '在职'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '线下主播导入模板')
  XLSX.writeFile(wb, '线下主播导入模板.xlsx')
}

// 当前年月（用于"当月"统计）
const CUR_YM = new Date().toISOString().slice(0, 7)

// 入场动效错峰延迟
const enter = (i) => ({ animationDelay: `${i * 70}ms` })

export function StreamersList({
  records,
  onSetStatus,
  onUpdateExtra,
  offlineRooms,
  onAddOfflineRoom,
  onRemoveOfflineRoom,
  onBatchAddOfflineRooms,
  onImportOffline,
  onFetchBatches,
  onRollbackBatch,
}) {
  const [tab, setTab] = useState('offline')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [importErrors, setImportErrors] = useState(null)
  const [importOk, setImportOk] = useState('')
  const [showBatches, setShowBatches] = useState(false)
  const [batches, setBatches] = useState([])
  const [rollbackMsg, setRollbackMsg] = useState('')

  const offlineList = useMemo(() => records.filter(r => r['是否线下主播']), [records])
  const onlineList = useMemo(() => records.filter(r => !r['是否线下主播']), [records])

  const offlineStats = useMemo(() => {
    const active = offlineList.filter(r => r['在职状态'] === '在职').length
    const left = offlineList.filter(r => r['在职状态'] === '离职').length
    const unmarked = offlineList.filter(r => r['在职状态'] === '未标记').length
    return { total: offlineList.length, active, left, unmarked }
  }, [offlineList])

  // 线下主播管理框内三项汇总
  const offlineSummary = useMemo(() => {
    const guaranteeSum = offlineList
      .filter(r => r['在职状态'] === '在职')
      .reduce((s, r) => s + Number(r['保底金额'] || 0), 0)
    const openedThisMonth = offlineList.filter(r => {
      const d = r['开播日期'] || ''
      return d && d.slice(0, 7) === CUR_YM
    }).length
    const leftThisMonth = offlineList.filter(r => {
      if (r['在职状态'] !== '离职') return false
      const ld = r['离职日期'] || ''
      return ld ? ld.slice(0, 7) === CUR_YM : true
    }).length
    return { guaranteeSum, openedThisMonth, leftThisMonth }
  }, [offlineList])

  const currentList = tab === 'offline' ? offlineList : onlineList

  const agentOptions = useMemo(() => {
    const set = new Set(currentList.map(r => r['运营经纪人']).filter(Boolean))
    return Array.from(set).sort()
  }, [currentList])

  const filtered = useMemo(() => {
    let list = currentList
    if (search.trim()) {
      const kw = search.toLowerCase()
      list = list.filter(r =>
        String(r['主播昵称']).toLowerCase().includes(kw) ||
        String(r['主播id']).includes(kw) ||
        String(r['房间号']).includes(kw) ||
        String(r['运营经纪人']).toLowerCase().includes(kw)
      )
    }
    if (agentFilter) {
      list = list.filter(r => r['运营经纪人'] === agentFilter)
    }
    if (statusFilter) {
      list = list.filter(r => r['在职状态'] === statusFilter)
    } else {
      // 默认列表不展示「未标记」记录（仅在有状态时显示在职/离职）
      list = list.filter(r => r['在职状态'] !== '未标记')
    }
    if (tab === 'offline' && (appliedStart || appliedEnd)) {
      list = list.filter(r => {
        const dates = parseStatDates(r['统计时间'])
        if (dates.length < 2) return true
        const s = dates[0]
        const e = dates[1]
        if (appliedStart && s < appliedStart) return false
        if (appliedEnd && e > appliedEnd) return false
        return true
      })
    }
    return list
  }, [currentList, search, agentFilter, statusFilter, appliedStart, appliedEnd, tab])

  // 分组与排序：在职在上，离职（按离职日期由新到旧，无日期置底）在下，未标记垫底
  const grouped = useMemo(() => {
    const active = []
    const left = []
    const unmarked = []
    for (const r of filtered) {
      const s = r['在职状态']
      if (s === '离职') left.push(r)
      else if (s === '在职') active.push(r)
      else unmarked.push(r)
    }
    left.sort((a, b) => {
      const da = a['离职日期'] || ''
      const db = b['离职日期'] || ''
      if (da && db) return db.localeCompare(da) // 由新到旧
      if (da && !db) return -1 // 有日期的排在前
      if (!da && db) return 1 // 无日期的置底
      return 0
    })
    return { active, left, unmarked }
  }, [filtered])

  const colCount = tab === 'offline' ? 9 : 8

  const renderRow = (r) => {
    const room = r['房间号']
    const isLeft = r['在职状态'] === '离职'
    const hasGuarantee = r['保底金额'] !== '' && r['保底金额'] != null
    let guaranteeCls
    if (isLeft) guaranteeCls = 'border-border bg-gray-100 text-text-secondary' // 离职：恢复系统默认灰色
    else if (hasGuarantee) guaranteeCls = 'border-danger bg-red-50 font-bold text-danger'
    else guaranteeCls = 'border-border bg-white text-text'
    return (
      <tr key={room} className="transition-colors hover:bg-brand-50/50">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-400 text-white text-[10px]">
              {String(r['主播昵称']).slice(0, 1)}
            </div>
            <div>
              <div className="font-medium text-text">{r['主播昵称']}</div>
              <div className="text-[10px] text-text-secondary">房间号:{room}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-text-secondary">{r['运营经纪人']}</td>
        <td className="px-3 py-2.5 text-text-secondary">{r['开播分区']}</td>
        <td className="px-3 py-2.5">
          <input
            type="date"
            value={r['开播日期'] || ''}
            onChange={e => onUpdateExtra(room, { openDate: e.target.value })}
            className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text outline-none focus:border-brand-500"
          />
        </td>
        <td className="px-3 py-2.5">
          <input
            type="number"
            min="0"
            value={r['保底金额'] ?? ''}
            disabled={isLeft}
            onChange={e => onUpdateExtra(room, { guarantee: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="保底金额"
            className={`w-24 rounded-md border px-2 py-1 text-xs outline-none focus:border-brand-500 ${guaranteeCls} ${isLeft ? 'cursor-not-allowed opacity-70' : ''}`}
          />
        </td>
        <td className="px-3 py-2.5 text-center">
          <select
            value={r['在职状态']}
            onChange={e => onSetStatus(room, e.target.value, r['离职原因'], r['离职日期'])}
            className={`rounded-full px-2 py-0.5 text-[10px] outline-none ${
              r['在职状态'] === '在职' ? 'bg-green-50 text-success' : r['在职状态'] === '离职' ? 'bg-gray-100 text-text-secondary' : 'bg-amber-50 text-amber-600'
            }`}
          >
            <option value="在职">在职</option>
            <option value="离职">离职</option>
            <option value="未标记">未标记</option>
          </select>
        </td>
        <td className="px-3 py-2.5">
          {r['在职状态'] === '离职' ? (
            <input
              type="text"
              value={r['离职原因'] || ''}
              onChange={e => onSetStatus(room, r['在职状态'], e.target.value, r['离职日期'])}
              placeholder="请填写离职原因"
              className="w-32 rounded-md border border-border bg-white px-2 py-1 text-xs text-text outline-none focus:border-brand-500"
            />
          ) : (
            <span className="text-[10px] text-text-muted">-</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {r['在职状态'] === '离职' ? (
            <input
              type="date"
              value={r['离职日期'] || ''}
              onChange={e => onSetStatus(room, r['在职状态'], r['离职原因'], e.target.value)}
              className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text outline-none focus:border-brand-500"
            />
          ) : (
            <span className="text-[10px] text-text-muted">-</span>
          )}
        </td>
        {tab === 'offline' && (
          <td className="px-3 py-2.5 text-center">
            <button
              onClick={() => onRemoveOfflineRoom(room)}
              className="fx-pop flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-red-50"
            >
              <Trash2 size={12} /> 移除
            </button>
          </td>
        )}
      </tr>
    )
  }

  const renderGroupSection = (label, list) => {
    if (!list.length) return null
    const Icon = label === '离职主播' ? UserX : label === '在职主播' ? Briefcase : HelpCircle
    return (
      <Fragment key={'grp-' + label}>
        <tr className="bg-gray-50">
          <td colSpan={colCount} className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <Icon size={12} className={label === '在职主播' ? 'text-success' : 'text-text-secondary'} />
              {label}
              <span className="rounded-full bg-white px-1.5 text-[10px] text-text-muted">{list.length}</span>
            </span>
          </td>
        </tr>
        {list.map(renderRow)}
      </Fragment>
    )
  }

  function handleQuery() {
    setAppliedStart(startDate)
    setAppliedEnd(endDate)
  }

  function handleAddRoom() {
    if (!newRoom.trim()) return
    onAddOfflineRoom(newRoom.trim())
    setNewRoom('')
  }

  async function handleBatchFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportErrors(null)
    setImportOk('')
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const sheetName =
        wb.SheetNames.find((n) => /主播|anchor|数据|导入|模板/i.test(n)) || wb.SheetNames[0]
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false })
      const rawHeaders = (aoa[0] || []).map((h) => String(h ?? '').trim())
      while (rawHeaders.length && rawHeaders[rawHeaders.length - 1] === '') rawHeaders.pop()
      const rows = aoa
        .slice(1)
        .filter((arr) => Array.isArray(arr) && arr.some((v) => v !== '' && v != null))
        .map((arr) => {
          const obj = {}
          rawHeaders.forEach((h, i) => { obj[h] = arr[i] ?? '' })
          return obj
        })
      if (rows.length === 0) {
        setImportErrors([{ row: 0, col: '文件', field: '', reason: '未从文件中解析到有效数据行' }])
        return
      }
      if (typeof onImportOffline !== 'function') {
        setImportErrors([{ row: 0, col: '接口', field: '', reason: '未配置导入接口' }])
        return
      }
      const result = await onImportOffline({ headers: rawHeaders, rows })
      if (result.ok) {
        setImportOk(`导入成功（批次 ${result.batchId}）：新增 ${result.summary.added} 个房间号，更新 ${result.summary.updated} 条记录`)
      } else {
        setImportErrors(result.errors || [{ row: 0, col: '未知', field: '', reason: '导入失败' }])
      }
    } catch (err) {
      setImportErrors([{ row: 0, col: '文件', field: '', reason: '读取 Excel 失败：' + err.message }])
    } finally {
      e.target.value = '' // 允许再次选择同一文件重新导入
    }
  }

  async function handleShowBatches() {
    const next = !showBatches
    setShowBatches(next)
    setRollbackMsg('')
    if (next && typeof onFetchBatches === 'function') {
      const r = await onFetchBatches()
      if (r.ok) setBatches(r.batches || [])
      else setRollbackMsg('获取导入记录失败：' + (r.error || '未知错误'))
    }
  }

  async function handleRollback(batchId) {
    if (!confirm('确认回滚该次导入？将把名册还原到导入前状态（新增记录移除、被覆盖字段回写为原值）。')) return
    setRollbackMsg('回滚中…')
    const r = await onRollbackBatch(batchId)
    if (r.ok) {
      setRollbackMsg(`回滚成功：房间数 ${r.before?.rooms ?? '?'} → ${r.after?.rooms ?? '?'}。已刷新列表。`)
      const b = await onFetchBatches()
      if (b.ok) setBatches(b.batches || [])
    } else {
      setRollbackMsg('回滚失败：' + (r.error || '未知错误'))
    }
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    } catch {
      return iso || ''
    }
  }

  function handlePasteRooms() {
    const text = prompt('请粘贴房间号，多个房间号可用换行、逗号或空格分隔')
    if (!text) return
    const rooms = text.split(/[,\s\n]+/).filter(Boolean)
    onBatchAddOfflineRooms(rooms)
  }

  const selectCls = 'rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-500 text-text-secondary'

  return (
    <div className="space-y-4 p-4">
      {/* 区块一：线下主播管理概览 */}
      <section className="fx-panel fx-enter rounded-2xl border border-border bg-white p-5 shadow-sm" style={enter(0)}>
        <div className="mb-4 flex items-center gap-2 text-base font-semibold text-text">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Users size={18} />
          </span>
          线下主播管理
        </div>

        {/* 概览卡：总数 / 在职 / 离职 / 未标记 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="fx-card rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-4 text-white shadow-sm">
            <div className="text-xs text-white/80">线下主播总数</div>
            <div className="mt-1 text-2xl font-bold">{offlineStats.total}</div>
            <div className="mt-1 text-[10px] text-white/70">含在职、离职与未标记</div>
          </div>
          <div className="fx-card rounded-2xl bg-gradient-to-br from-brand-600 to-brand-400 p-4 text-white shadow-sm">
            <div className="flex items-center gap-1 text-xs text-white/80"><Briefcase size={12} /> 在职</div>
            <div className="mt-1 text-2xl font-bold">{offlineStats.active}</div>
          </div>
          <div className="fx-card rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 p-4 text-white shadow-sm">
            <div className="flex items-center gap-1 text-xs text-white/80"><UserX size={12} /> 离职</div>
            <div className="mt-1 text-2xl font-bold">{offlineStats.left}</div>
          </div>
          <div className="fx-card rounded-2xl bg-gradient-to-br from-slate-500 to-slate-400 p-4 text-white shadow-sm">
            <div className="flex items-center gap-1 text-xs text-white/80"><HelpCircle size={12} /> 未标记</div>
            <div className="mt-1 text-2xl font-bold">{offlineStats.unmarked}</div>
            <div className="mt-1 text-[10px] text-white/70">无状态记录</div>
          </div>
        </div>

        {/* 三项汇总 */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="fx-card rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-amber-700"><Wallet size={12} /> 在职主播保底金额汇总</div>
            <div className="mt-1 text-2xl">
              <Money value={offlineSummary.guaranteeSum} className="font-bold text-danger" />
            </div>
          </div>
          <div className="fx-card rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-emerald-700"><Radio size={12} /> 当月开播主播数量</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{offlineSummary.openedThisMonth}<span className="ml-1 text-xs font-normal text-emerald-600">人</span></div>
          </div>
          <div className="fx-card rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
            <div className="flex items-center gap-1 text-xs text-rose-700"><UserX size={12} /> 当月离职主播数量</div>
            <div className="mt-1 text-2xl font-bold text-rose-700">{offlineSummary.leftThisMonth}<span className="ml-1 text-xs font-normal text-rose-600">人</span></div>
          </div>
        </div>

        {/* 录入区 */}
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-bg p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-text-secondary">单条录入房间号</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRoom}
                onChange={e => setNewRoom(e.target.value)}
                placeholder="输入线下主播房间号"
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs outline-none focus:border-brand-500"
              />
              <button
                onClick={handleAddRoom}
                className="fx-glow flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                <Plus size={14} /> 添加
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-2">
              <label className="fx-lift flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white">
                <Upload size={14} />
                导入Excel
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBatchFile} />
              </label>
              <button
                onClick={downloadTemplate}
                className="fx-lift flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
              >
                <FileDown size={14} /> 下载模板
              </button>
              <button
                onClick={handlePasteRooms}
                className="fx-lift rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white"
              >
                粘贴房间号
              </button>
            </div>
            <span className="text-[10px] text-text-muted">模板表头：房间号 / 开播日期 / 保底金额 / 在职状态</span>
          </div>
        </div>

        {/* 导入结果：成功提示 */}
        {importOk && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            ✓ {importOk}
          </div>
        )}
        {/* 导入结果：模板校验错误（整表拒绝，指出具体行/列/原因） */}
        {importErrors && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <div className="mb-1 font-semibold">✗ 导入被拒绝（模板校验未通过，未写入任何数据）：</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
              {importErrors.map((e, i) => (
                <li key={i} className="leading-relaxed">
                  {e.row > 0 ? `第 ${e.row} 行` : '表头'} · {e.col || e.field || ''}：{e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 区块一·B：导入批次与回滚 */}
      <section className="fx-panel fx-enter rounded-2xl border border-border bg-white p-5 shadow-sm" style={enter(0)}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-text">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <FileDown size={18} />
            </span>
            导入批次与回滚
          </div>
          <button
            onClick={handleShowBatches}
            className="fx-lift rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white"
          >
            {showBatches ? '收起' : '查看导入记录'}
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          每次 Excel 导入都会生成可追溯的批次号（含导入前数据快照）。若某次导入误操作，可在此按批次一键回滚，将名册还原到导入前状态。
        </p>

        {showBatches && (
          <div className="mt-3 space-y-2">
            {batches.length === 0 && <div className="text-xs text-text-secondary">暂无导入记录</div>}
            {batches.map((b) => (
              <div key={b.batchId} className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs">
                  <div className="font-medium text-text">
                    批次 <span className="font-mono text-brand-600">{b.batchId}</span>
                  </div>
                  <div className="text-text-secondary">
                    {fmtTime(b.at)} · 文件 {b.fileName} · 行数 {b.rowCount}
                  </div>
                  <div className="text-text-secondary">
                    新增 {b.summary?.added ?? 0} / 更新 {b.summary?.updated ?? 0} / 影响房间 {(b.summary?.affectedRooms || []).length}
                  </div>
                </div>
                <button
                  onClick={() => handleRollback(b.batchId)}
                  disabled={!b.canRollback}
                  className={`fx-lift shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                    b.canRollback
                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'cursor-not-allowed bg-gray-200 text-gray-400'
                  }`}
                >
                  回滚此批次
                </button>
              </div>
            ))}
            {rollbackMsg && (
              <div className={`rounded-lg px-3 py-2 text-xs ${rollbackMsg.includes('成功') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
                {rollbackMsg}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 区块二：列表与筛选 */}
      <section className="fx-panel fx-enter rounded-2xl border border-border bg-white p-5 shadow-sm" style={enter(1)}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-text">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <ListChecks size={18} />
            </span>
            线下主播管理
            <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">{filtered.length} 位</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg p-1">
            {[
              { key: 'offline', label: `线下主播 (${offlineStats.total})` },
              { key: 'online', label: `线上主播 (${onlineList.length})` },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`fx-chip rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tab === 'offline' && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
              <Calendar size={12} className="text-text-secondary" />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border-none bg-transparent text-xs outline-none w-24"
              />
              <span className="text-text-secondary">~</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border-none bg-transparent text-xs outline-none w-24"
              />
              <button
                onClick={handleQuery}
                className="fx-lift rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
              >
                查询
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
            <Filter size={12} className="text-text-secondary" />
            <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className={selectCls}>
              <option value="">运营经纪人(全部)</option>
              {agentOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectCls}>
              <option value="">在职状态(全部)</option>
              <option value="在职">在职</option>
              <option value="离职">离职</option>
              <option value="未标记">未标记</option>
            </select>
          </div>

          <div className="relative sm:w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="搜索主播"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-border py-1.5 pl-8 pr-3 text-xs outline-none focus:border-brand-500"
            />
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto bili-scrollbar rounded-xl border border-border">
          <table className="w-full min-w-[920px] text-xs">
            <thead>
              <tr className="border-b border-border bg-bg text-text-secondary">
                <th className="px-3 py-2.5 text-left font-medium">主播</th>
                <th className="px-3 py-2.5 text-left font-medium">运营经纪人</th>
                <th className="px-3 py-2.5 text-left font-medium">开播分区</th>
                <th className="px-3 py-2.5 text-left font-medium">开播日期</th>
                <th className="px-3 py-2.5 text-left font-medium">保底金额</th>
                <th className="px-3 py-2.5 text-center font-medium">在职状态</th>
                <th className="px-3 py-2.5 text-left font-medium">离职原因</th>
                <th className="px-3 py-2.5 text-left font-medium">离职日期</th>
                {tab === 'offline' && <th className="px-3 py-2.5 text-center font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {renderGroupSection('在职主播', grouped.active)}
              {renderGroupSection('离职主播', grouped.left)}
              {renderGroupSection('未标记', grouped.unmarked)}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-text-secondary">
            暂无符合条件的数据
          </div>
        )}
      </section>
    </div>
  )
}
