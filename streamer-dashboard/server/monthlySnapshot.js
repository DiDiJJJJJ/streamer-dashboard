import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, log } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

// ---------------- 月度快照存储 ----------------
// 用途：存放「整月区间导出」的历史数据（如 2026-07 一次性导出 7/1~7/31）。
// 为什么不写进 latest.json：
//   1) latest.json 是「房间号::统计日期」累积的按日明细，区间记录混进去会污染前端看板
//      （今日数据 / 主播数据列表会突然冒出 7 月的区间行）；
//   2) operatorStats 的去重规则 isRange() 会直接跳过区间记录，写进去也统计不到，等于白写。
// 因此区间数据单独存这里，统计时由 operatorStats 做双源融合：
//   某月有按日明细 → 用明细求和；某月只有快照 → 回退用快照求和。两者不会同时生效，不会重复计数。

const SNAPSHOT_FILE = path.join(DATA_DIR, 'monthly_snapshot.json')
const EMPTY = { version: 1, updatedAt: null, months: {} }

function readAll() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return { ...EMPTY, months: {} }
    const j = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'))
    if (!j || typeof j !== 'object' || typeof j.months !== 'object' || !j.months) {
      return { ...EMPTY, months: {} }
    }
    return j
  } catch (e) {
    log('[monthlySnapshot] 读取失败，按空处理: ' + e.message)
    return { ...EMPTY, months: {} }
  }
}

function writeAll(data) {
  data.updatedAt = new Date().toISOString()
  atomicWriteSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2))
  return data
}

/** 规范化月份：仅接受 YYYY-MM */
export function normalizeMonth(m) {
  const s = String(m || '').trim()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  // 兼容 2026-07-15 / 2026/07
  const t = s.replace(/\//g, '-')
  if (/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(t)) {
    const [y, mm] = t.split('-')
    return `${y}-${String(mm).padStart(2, '0')}`
  }
  return ''
}

/** 已有快照的月份列表（升序） */
export function listMonths() {
  return Object.keys(readAll().months).sort()
}

/** 取某月快照，无则 null */
export function getSnapshot(month) {
  const m = normalizeMonth(month)
  if (!m) return null
  return readAll().months[m] || null
}

/** 取某月快照的记录数组（安全） */
export function getSnapshotRecords(month) {
  const s = getSnapshot(month)
  return Array.isArray(s?.records) ? s.records : []
}

/**
 * 幂等写入某月快照：同月重复导入直接整月覆盖，不会追加造成翻倍。
 * @returns {{month:string, recordCount:number, replaced:boolean, prevRecordCount:number}}
 */
export function upsertSnapshot(month, records, meta = {}) {
  const m = normalizeMonth(month)
  if (!m) throw new Error('月份格式非法，应为 YYYY-MM')
  if (!Array.isArray(records)) throw new Error('records 必须是数组')

  const j = readAll()
  const prev = j.months[m]
  const entry = {
    ...(prev || {}),
    ...meta,
    month: m,
    source: meta.source || 'range-import',
    recordCount: records.length,
    prevRecordCount: prev?.recordCount ?? 0,
    records,
    importedAt: new Date().toISOString(),
  }
  j.months[m] = entry
  writeAll(j)
  log(`[monthlySnapshot] 写入 ${m}：${records.length} 条${prev ? `（覆盖原有 ${prev.recordCount || 0} 条）` : '（新增）'}`)
  return {
    month: m,
    recordCount: records.length,
    replaced: !!prev,
    prevRecordCount: entry.prevRecordCount,
  }
}

/** 删除某月快照 */
export function deleteSnapshot(month) {
  const m = normalizeMonth(month)
  if (!m) throw new Error('月份格式非法，应为 YYYY-MM')
  const j = readAll()
  if (!j.months[m]) return { month: m, deleted: false }
  const n = j.months[m].recordCount || 0
  delete j.months[m]
  writeAll(j)
  log(`[monthlySnapshot] 删除 ${m}（原有 ${n} 条）`)
  return { month: m, deleted: true, removedCount: n }
}

/** 概览：月份 / 条数 / 来源 / 导入时间 */
export function summary() {
  const j = readAll()
  return Object.keys(j.months).sort().map((m) => {
    const e = j.months[m]
    return {
      month: m,
      recordCount: e.recordCount ?? (e.records?.length || 0),
      source: e.source || 'range-import',
      importedAt: e.importedAt || null,
      file: e.file || '',
      range: e.range || null,
    }
  })
}
