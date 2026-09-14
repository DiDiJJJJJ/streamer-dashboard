import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, config, log } from './config.js'
import { aggregateOperatorMonthlyStats } from './operatorStats.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

// ---------------- 运营 KPI 月度结算 ----------------
// 需求：每个自然月过完后，按「运营数据看板 → 卡片管理」里设置的 KPI 值，
//       自动汇总每位运营的完成情况（线上线下总流水 / 线下总流水 双目标）。
//
// 数据源：
//   - kpi.json                  运营双 KPI 目标（key 形如「林夕|运营组|虚拟线下部」，取首段匹配运营名）
//   - operatorStats.js          运营 × 自然月 的真实流水 / 入会 / 开播等聚合（与「运营月度统计」同源）
//
// 归档策略（关键）：
//   B站 流水存在 T+N 延迟结算（昨日 14:30 才会用「按日期精确」覆盖成终值），
//   若在次月 1 日 00:00 就冻结，月末最后一天仍是早盘快照 → 整月被低估。
//   因此：自然月结束后，在次月的前 kpiSettleDelayDays 天内**持续刷新**该月结算；
//   过了该窗口才冻结快照（frozen=true），此后不再自动改写历史，保证复盘口径稳定。
//   冻结后如需重算，走 POST /api/kpi-monthly/settle { force:true }。

const KPI_FILE = path.join(DATA_DIR, 'kpi.json')
const ARCHIVE_FILE = path.join(DATA_DIR, 'kpi_monthly.json')

// 惰性结算的最小间隔（毫秒）：避免每次前端请求都全量重算
const SETTLE_MIN_INTERVAL_MS = 30 * 60 * 1000
let _lastSettleAt = 0

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    log('[kpiMonthly] 读取失败 ' + path.basename(file) + ': ' + e.message)
  }
  return fallback
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function momPct(to, from) {
  const f = Number(from) || 0
  const t = Number(to) || 0
  if (f === 0) return t > 0 ? 100 : 0
  return round2(((t - f) / f) * 100)
}

// ---------------- 月份工具（统一 Asia/Shanghai 口径） ----------------
function tzPart(options) {
  const tz = config.timezone || 'Asia/Shanghai'
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...options }).format(new Date())
  } catch {
    const d = new Date()
    if (options.day) return String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}
/** 当前自然月，形如 2026-09 */
export function currentMonthKey() {
  return tzPart({ year: 'numeric', month: '2-digit' }).slice(0, 7)
}
/** 当前是当月第几天 */
function currentDayOfMonth() {
  return Number(tzPart({ day: '2-digit' })) || 1
}
function shiftMonth(m, delta) {
  const [y, mm] = String(m || '').split('-').map(Number)
  if (!y || !mm) return ''
  const d = new Date(y, mm - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 该月是否已到冻结时点（不再自动改写） */
export function isMonthFrozen(m, cur = currentMonthKey(), day = currentDayOfMonth()) {
  if (!/^\d{4}-\d{2}$/.test(String(m || ''))) return false
  if (m >= cur) return false                       // 当月进行中
  if (shiftMonth(m, 1) < cur) return true          // 已跨过次月，数据早已稳定
  const delay = Number(config.kpiSettleDelayDays)
  return day > (Number.isFinite(delay) ? delay : 0)
}

// ---------------- KPI 目标读取 ----------------
function readKpiTargets() {
  const kpi = readJSON(KPI_FILE, { map: {}, layout: {} })
  const targets = {}
  for (const [key, cfg] of Object.entries(kpi.map || {})) {
    const name = String(key).split('|')[0].trim()
    if (!name) continue
    const t = Number(cfg?.totalKpi) || 0
    const o = Number(cfg?.offlineKpi) || 0
    if (!targets[name]) targets[name] = { totalKpi: t, offlineKpi: o }
    else { targets[name].totalKpi += t; targets[name].offlineKpi += o }
  }
  const hidden = new Set()
  for (const key of (kpi.layout?.hidden || [])) {
    hidden.add(String(key).split('|')[0].trim())
  }
  return { targets, hidden }
}

// ---------------- 单月计算 ----------------
function computeMonthRows(month, stats) {
  const { targets, hidden } = readKpiTargets()
  const prev = shiftMonth(month, -1)
  const rows = []
  for (const op of stats.operators) {
    const cur = stats.byOperator?.[op]?.[month] || null
    const pre = prev ? (stats.byOperator?.[op]?.[prev] || null) : null
    const cfg = targets[op] || { totalKpi: 0, offlineKpi: 0 }
    const totalKpi = Number(cfg.totalKpi) || 0
    const offlineKpi = Number(cfg.offlineKpi) || 0
    const totalFlow = Number(cur?.totalFlow) || 0
    const offlineFlow = Number(cur?.offlineFlow) || 0
    const onlineFlow = Number(cur?.onlineFlow) || 0
    const roomCount = Number(cur?.roomCount) || 0
    const joined = Number(cur?.joined) || 0
    const openDays = Number(cur?.openDays) || 0
    const hasData = totalFlow > 0 || offlineFlow > 0 || onlineFlow > 0 || roomCount > 0 || joined > 0 || openDays > 0
    // 无数据且未设 KPI 的运营不参与结算；「未分配」除非显式设了 KPI，否则跳过
    if (!hasData && !totalKpi && !offlineKpi) continue
    if (op === '未分配' && !totalKpi && !offlineKpi) continue

    const totalPass = totalKpi > 0 && totalFlow >= totalKpi
    const offlinePass = offlineKpi > 0 && offlineFlow >= offlineKpi
    rows.push({
      operator: op,
      month,
      totalKpi,
      offlineKpi,
      hasKpi: totalKpi > 0 || offlineKpi > 0,
      totalFlow: round2(totalFlow),
      offlineFlow: round2(offlineFlow),
      onlineFlow: round2(onlineFlow),
      totalProgress: totalKpi > 0 ? round2((totalFlow / totalKpi) * 100) : null,
      offlineProgress: offlineKpi > 0 ? round2((offlineFlow / offlineKpi) * 100) : null,
      totalPass,
      offlinePass,
      passed: totalPass || offlinePass,
      totalGap: totalKpi > 0 ? round2(totalFlow - totalKpi) : null,
      offlineGap: offlineKpi > 0 ? round2(offlineFlow - offlineKpi) : null,
      roomCount,
      joined,
      joinedOffline: Number(cur?.joinedOffline) || 0,
      payCount: Number(cur?.payCount) || 0,
      seaCount: Number(cur?.seaCount) || 0,
      openDays,
      broadcastHours: Number(cur?.broadcastHours) || 0,
      momTotalFlow: pre ? momPct(totalFlow, pre.totalFlow) : null,
      momOfflineFlow: pre ? momPct(offlineFlow, pre.offlineFlow) : null,
      hidden: hidden.has(op),
    })
  }
  rows.sort((a, b) => (b.totalFlow || 0) - (a.totalFlow || 0))
  return rows
}

function summarize(rows) {
  const sumBy = (list, k) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const withTotal = rows.filter(r => r.totalKpi > 0)
  const withOffline = rows.filter(r => r.offlineKpi > 0)
  const totalKpi = sumBy(withTotal, 'totalKpi')
  const totalFlow = sumBy(withTotal, 'totalFlow')
  const offlineKpi = sumBy(withOffline, 'offlineKpi')
  const offlineFlow = sumBy(withOffline, 'offlineFlow')
  return {
    operatorCount: rows.length,          // 参与本次汇总的运营数
    evaluatedCount: rows.filter(r => r.hasKpi).length, // 设置了 KPI 的运营数
    passedCount: rows.filter(r => r.passed).length,
    totalPassCount: rows.filter(r => r.totalPass).length,
    offlinePassCount: rows.filter(r => r.offlinePass).length,
    totalKpi: round2(totalKpi),
    totalFlow: round2(totalFlow),
    totalProgress: totalKpi > 0 ? round2((totalFlow / totalKpi) * 100) : null,
    offlineKpi: round2(offlineKpi),
    offlineFlow: round2(offlineFlow),
    offlineProgress: offlineKpi > 0 ? round2((offlineFlow / offlineKpi) * 100) : null,
  }
}

// ---------------- 归档读写 ----------------
function readArchive() {
  const obj = readJSON(ARCHIVE_FILE, {})
  return {
    version: 1,
    updatedAt: obj.updatedAt || null,
    months: obj.months && typeof obj.months === 'object' ? obj.months : {},
  }
}
function saveArchive(archive) {
  atomicWriteSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2))
}

/**
 * 结算自然月：把「已过完」的月份写入归档。
 * - 未到冻结窗口的月份：每次都重算刷新（兼容 T+N 延迟结算导致月末数据后补）
 * - 已冻结的月份：默认跳过，force=true 时强制重算
 */
export function settleKpiMonths({ force = false, months = null } = {}) {
  _lastSettleAt = Date.now() // 同时刷新惰性结算的时间戳，避免刚结算完又被前端请求触发一次
  const stats = aggregateOperatorMonthlyStats()
  const archive = readArchive()
  const cur = currentMonthKey()
  const day = currentDayOfMonth()
  const candidates = (Array.isArray(months) && months.length)
    ? months.filter(m => /^\d{4}-\d{2}$/.test(String(m)))
    : (stats.months || []).filter(m => m < cur)

  const settled = []   // 本次首次归档
  const refreshed = [] // 本次刷新（未冻结）
  const excludedMonths = new Set((config.kpiExcludedMonths || []).filter(m => /^\d{4}-\d{2}$/.test(String(m))))
  for (const m of candidates) {
    if (m >= cur) continue // 当月进行中，只做实时预览，不归档
    if (excludedMonths.has(m)) continue // 考核豁免月份（如历史补录、不参与 KPI 考核的月份）
    const frozen = isMonthFrozen(m, cur, day)
    const existing = archive.months[m]
    if (!force && existing && frozen) continue
    const rows = computeMonthRows(m, stats)
    archive.months[m] = {
      month: m,
      settledAt: new Date().toISOString(),
      frozen,
      source: force ? 'manual' : 'auto',
      rows,
      summary: summarize(rows),
    }
    if (existing) refreshed.push(m)
    else settled.push(m)
  }
  archive.updatedAt = new Date().toISOString()
  saveArchive(archive)
  if (settled.length || refreshed.length) {
    log(`[kpiMonthly] 结算完成 新增=[${settled.join(',')}] 刷新=[${refreshed.join(',')}]`)
  }
  return {
    ok: true,
    currentMonth: cur,
    settled,
    refreshed,
    frozenMonths: Object.keys(archive.months).filter(m => archive.months[m].frozen).sort(),
  }
}

/**
 * 惰性结算：前端请求时兜底触发，保证「月过完就有汇总」，但最多 30 分钟一次，
 * 不会因频繁刷新页面而反复全量重算。
 */
export function maybeSettleKpiMonths() {
  const now = Date.now()
  if (now - _lastSettleAt < SETTLE_MIN_INTERVAL_MS) return null
  _lastSettleAt = now
  try {
    return settleKpiMonths()
  } catch (e) {
    log('[kpiMonthly] 惰性结算失败: ' + e.message)
    return null
  }
}

/** 汇总查询：已归档月份（快照）+ 当月实时预览 */
export function getKpiMonthlySummary() {
  maybeSettleKpiMonths()
  const stats = aggregateOperatorMonthlyStats()
  const archive = readArchive()
  const cur = currentMonthKey()
  const day = currentDayOfMonth()

  const liveRows = computeMonthRows(cur, stats)
  const live = {
    month: cur,
    frozen: false,
    live: true,
    settledAt: null,
    source: 'live',
    rows: liveRows,
    summary: summarize(liveRows),
  }

  const months = Object.keys(archive.months).sort()
  const settledList = months
    .filter(m => m !== cur)
    .map(m => archive.months[m])
    .sort((a, b) => (a.month < b.month ? 1 : -1))

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    currentMonth: cur,
    settleDelayDays: Number(config.kpiSettleDelayDays) || 0,
    months,                                   // 已归档月份（升序）
    archive: archive.months,                  // 完整归档：{ '2026-08': { rows, summary, frozen, settledAt } }
    settled: settledList,                     // 已归档月份（降序，最新在前）
    live,                                     // 当月实时预览（未结算）
    // 尚未归档的历史月份（服务关机跨月等场景，下次结算会自动补上）
    // 考核豁免月份（kpiExcludedMonths）既不归档也不计入待结算，避免 UI 长期显示「待结算」
    pendingMonths: (stats.months || []).filter(m => m < cur && !archive.months[m] && !(config.kpiExcludedMonths || []).includes(m)),
  }
}
