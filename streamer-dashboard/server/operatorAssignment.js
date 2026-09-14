import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, log } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

// ---------------- 主播 × 运营 归属关系表（带生效 / 失效时间） ----------------
// 背景：按日导出的数据里，每条记录自带当天的「运营经纪人」，天然能还原归属变化
//       （已实测：房间 1732562810 在 8/1~9/3 挂「轨迹」，9/4 起变「小辫子」）。
//       但「整月区间导出」只有一行、且运营取的是导出时刻的当前归属 —— 月内换过运营的话，
//       整月流水会被全部算给同一个人。这种场景必须靠本表按生效日期覆盖。
// 结构：{ version, updatedAt, entries: { [房间号]: [{ operator, from, to, source, note }] } }
//   from / to 均为 YYYY-MM-DD，to 为 null 表示至今有效。
//   多条区间允许首尾相接，不允许重叠（导入时自动按 from 排序，查询取第一条命中的）。

const ASSIGN_FILE = path.join(DATA_DIR, 'operator_assignment.json')
const EMPTY = { version: 1, updatedAt: null, entries: {} }

function readAll() {
  try {
    if (!fs.existsSync(ASSIGN_FILE)) return { ...EMPTY, entries: {} }
    const j = JSON.parse(fs.readFileSync(ASSIGN_FILE, 'utf-8'))
    if (!j || typeof j !== 'object' || typeof j.entries !== 'object' || !j.entries) {
      return { ...EMPTY, entries: {} }
    }
    return j
  } catch (e) {
    log('[operatorAssignment] 读取失败，按空处理: ' + e.message)
    return { ...EMPTY, entries: {} }
  }
}

function writeAll(data) {
  data.updatedAt = new Date().toISOString()
  atomicWriteSync(ASSIGN_FILE, JSON.stringify(data, null, 2))
  return data
}

/** 日期规范化：只保留 YYYY-MM-DD；非法返回 '' */
export function normDate(d) {
  const s = String(d || '').trim().replace(/\//g, '-')
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, dd] = s.split('-')
    return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  // 只有年月时补 01 日（月归属场景）
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [y, m] = s.split('-')
    return `${y}-${String(m).padStart(2, '0')}-01`
  }
  return ''
}

/** 归一化运营名：'林夕|运营组|虚拟线下部' -> '林夕' */
export function normOperator(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s.replace(/^运营经纪人[：:\s]+/i, '').replace(/^经纪人[：:\s]+/i, '').trim().split('|')[0].trim()
}

/** 全量列表（扁平化，便于前端展示） */
export function listEntries() {
  const j = readAll()
  const out = []
  for (const [room, list] of Object.entries(j.entries || {})) {
    for (const e of list || []) {
      out.push({ room, ...e })
    }
  }
  out.sort((a, b) => String(a.room).localeCompare(String(b.room)) || String(a.from || '').localeCompare(String(b.from || '')))
  return out
}

/** 某房间的归属区间 */
export function getRoom(room) {
  const j = readAll()
  return j.entries?.[String(room || '').trim()] || []
}

/**
 * 按日期解析归属：命中区间返回运营名，未命中返回 null（null 表示「不要覆盖」，由调用方回退）
 */
export function resolveOperator(room, date) {
  const key = String(room || '').trim()
  if (!key) return null
  const d = normDate(date)
  const list = getRoom(key)
  for (const e of list) {
    if (!e || !e.operator) continue
    const from = normDate(e.from)
    const to = normDate(e.to)
    if (from && d && d < from) continue
    if (to && d && d > to) continue
    return normOperator(e.operator)
  }
  return null
}

/**
 * 写入/更新一条归属（同 room + from 视为同一条，覆盖）
 */
export function setEntry({ room, operator, from, to = null, source = 'manual', note = '' }) {
  const key = String(room || '').trim()
  const op = normOperator(operator)
  if (!key) throw new Error('缺少房间号')
  if (!op) throw new Error('缺少运营名')
  const f = normDate(from)
  if (!f) throw new Error('生效日期 from 非法，应为 YYYY-MM-DD')
  const t = to ? normDate(to) : null
  if (t && t < f) throw new Error('失效日期 to 不能早于生效日期 from')

  const j = readAll()
  const list = j.entries[key] || []
  const idx = list.findIndex((e) => normDate(e.from) === f)
  const entry = { operator: op, from: f, to: t, source, note }
  if (idx >= 0) list[idx] = { ...list[idx], ...entry }
  else list.push(entry)
  list.sort((a, b) => String(normDate(a.from)).localeCompare(String(normDate(b.from))))
  j.entries[key] = list
  writeAll(j)
  return { room: key, ...entry, replaced: idx >= 0 }
}

/** 删除某房间的某条归属（按 from 定位） */
export function removeEntry(room, from) {
  const key = String(room || '').trim()
  const f = normDate(from)
  const j = readAll()
  const list = j.entries[key]
  if (!list || !list.length) return { room: key, deleted: false }
  const next = f ? list.filter((e) => normDate(e.from) !== f) : []
  if (next.length === list.length) return { room: key, deleted: false }
  if (next.length) j.entries[key] = next
  else delete j.entries[key]
  writeAll(j)
  return { room: key, deleted: true, remaining: next.length }
}

/**
 * 批量导入归属（整表替换）
 * @param {Array} rows 形如 [{room, operator, from, to, source, note}]
 */
export function bulkReplace(rows) {
  if (!Array.isArray(rows)) throw new Error('rows 必须是数组')
  const entries = {}
  let ok = 0
  const errors = []
  rows.forEach((r, i) => {
    const key = String(r?.room ?? r?.房间号 ?? '').trim()
    const op = normOperator(r?.operator ?? r?.运营 ?? r?.运营经纪人 ?? '')
    const f = normDate(r?.from ?? r?.生效日期 ?? r?.开始日期 ?? '')
    const t = normDate(r?.to ?? r?.失效日期 ?? r?.结束日期 ?? '') || null
    if (!key || !op || !f) { errors.push(`第 ${i + 1} 行缺少 房间号/运营/生效日期`); return }
    if (t && t < f) { errors.push(`第 ${i + 1} 行 to 早于 from`); return }
    if (!entries[key]) entries[key] = []
    entries[key].push({ operator: op, from: f, to: t, source: r?.source || 'import', note: r?.note || '' })
    ok++
  })
  for (const k of Object.keys(entries)) {
    entries[k].sort((a, b) => a.from.localeCompare(b.from))
  }
  writeAll({ version: 1, updatedAt: null, entries })
  log(`[operatorAssignment] 批量导入 ${ok} 条归属，跳过 ${errors.length} 条`)
  return { ok, skipped: errors.length, errors: errors.slice(0, 20), roomCount: Object.keys(entries).length }
}
