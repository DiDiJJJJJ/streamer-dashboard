import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ROOT, config, log } from './config.js'
import { bus } from './events.js'
import { atomicWriteSync } from './utils/atomicWrite.js'
import { mergeRecords } from './parser.js'

// ---------------- 主播数据同步移除机制 ----------------
// 当某主播在 B站后台被移出时，其记录仍残留在 latest.json（看板权威数据源）中。
// 本模块通过「今日抓取快照 today.json」判断在册状态：
//   - 在册主播：必然出现在 today.json（B站主播数据页会列出全部主播，含当日 0 开播者）
//   - 已移出主播：不再出现在 today.json → 判定为「疑似已移除」
// 为避免单次抓取残缺 / 网络抖动导致误删，引入宽限期（removedGraceMinutes）：
//   同一房间需连续 N 分钟（多次抓取周期）未出现才真正移除；并设健康阈值
//   （removedMinHealthyCount）防止今日抓取条数异常时触发移除。
// 移除前先备份到 removed_rooms.json，支持按房间恢复。

const LATEST_FILE = path.join(DATA_DIR, 'latest.json')
const TODAY_FILE = path.join(DATA_DIR, 'today.json')
const YESTERDAY_FILE = path.join(DATA_DIR, 'yesterday.json')
const BACKUP_FILE = path.join(DATA_DIR, 'removed_rooms.json')   // 已移除房间备份（可恢复）
const STATE_FILE = path.join(DATA_DIR, 'removed_state.json')    // 宽限期计时状态

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf-8'))
      return d
    }
  } catch (e) {
    log('[removed] 读取失败 ' + path.basename(file) + ': ' + e.message)
  }
  return fallback
}

function roomOf(r) {
  return String(r['房间号'] || r['主播id'] || '').trim()
}
function nameOf(r) {
  return String(r['主播昵称'] || '').trim()
}
function parseOperator(raw) {
  const s = String(raw || '').trim()
  if (!s) return '未分配'
  const t = s.replace(/^运营经纪人[：:\s]+/i, '').replace(/^经纪人[：:\s]+/i, '').trim()
  return t.split('|')[0].trim() || '未分配'
}

function getState() {
  return readJSON(STATE_FILE, { pendingSince: {}, lastDetectedAt: null, lastHealthy: true })
}
function saveState(state) {
  atomicWriteSync(STATE_FILE, JSON.stringify(state, null, 2))
}
function getBackup() {
  return readJSON(BACKUP_FILE, { version: 1, entries: [] })
}
function saveBackup(b) {
  atomicWriteSync(BACKUP_FILE, JSON.stringify(b, null, 2))
}

/** 把 records 同步到 public / dist（与 fetcher.syncToPublicDataset 行为一致） */
function syncPublic(records) {
  const payload = JSON.stringify(records, null, 2)
  const publicFile = path.join(ROOT, 'public', 'streamer_data.json')
  try { atomicWriteSync(publicFile, payload) } catch (e) { log('[removed] 同步 public 失败: ' + e.message) }
  const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
  try {
    if (fs.existsSync(distFile)) atomicWriteSync(distFile, payload)
  } catch (e) { log('[removed] 同步 dist 失败: ' + e.message) }
}

/** 读取 latest.json，按房间号聚合 */
function readLatestByRoom() {
  const latest = readJSON(LATEST_FILE, [])
  if (!Array.isArray(latest)) return new Map()
  const map = new Map()
  for (const r of latest) {
    const room = roomOf(r)
    if (!room) continue
    if (!map.has(room)) map.set(room, { room, records: [], names: new Set(), operators: new Set(), dates: [] })
    const e = map.get(room)
    e.records.push(r)
    const n = nameOf(r)
    if (n) e.names.add(n)
    const op = parseOperator(r['运营经纪人'])
    if (op) e.operators.add(op)
    const d = r['统计结束日期'] || r['统计日期'] || ''
    if (d) e.dates.push(d)
  }
  return map
}

/** 从今日 / 昨日抓取快照读取当前在册房间集合 */
function readCurrentRooms() {
  const today = readJSON(TODAY_FILE, [])
  const yesterday = readJSON(YESTERDAY_FILE, [])
  const todaySet = new Set(Array.isArray(today) ? today.map(roomOf).filter(Boolean) : [])
  const ySet = new Set(Array.isArray(yesterday) ? yesterday.map(roomOf).filter(Boolean) : [])
  return { todaySet, ySet, todayCount: todaySet.size }
}

/**
 * 检测疑似已移除的房间。
 * @param {{now:number, healthy:boolean, state:object}} opts
 */
function detectCandidates({ now, healthy, state }) {
  const latestByRoom = readLatestByRoom()
  const { todaySet, ySet } = readCurrentRooms()
  const graceMs = (config.removedGraceMinutes || 60) * 60_000
  const candidates = []
  for (const [room, e] of latestByRoom) {
    if (todaySet.has(room)) {
      // 仍在册：清除待移除计时（可能曾短暂消失后又出现）
      if (state.pendingSince[room]) delete state.pendingSince[room]
      continue
    }
    // 不在今日抓取中 = 疑似已从 B站后台移出
    // 抓取不健康时不启动/推进宽限期计时，避免把异常抓取误判为移除
    const pendingSince = healthy && state.pendingSince[room]
      ? new Date(state.pendingSince[room]).getTime()
      : (healthy ? now : (state.pendingSince[room] ? new Date(state.pendingSince[room]).getTime() : null))
    if (healthy && !state.pendingSince[room]) state.pendingSince[room] = new Date(now).toISOString()
    const elapsedMin = pendingSince ? Math.max(0, Math.round((now - pendingSince) / 60000)) : 0
    const eligible = healthy && pendingSince !== null && (now - pendingSince >= graceMs)
    candidates.push({
      room,
      name: [...e.names].join(' / ') || '(未知昵称)',
      operator: [...e.operators].join(' / ') || '未分配',
      count: e.records.length,
      firstDate: e.dates.length ? e.dates.slice().sort()[0] : '',
      lastDate: e.dates.length ? e.dates.slice().sort().pop() : '',
      inYesterday: ySet.has(room),
      pendingSince: pendingSince ? new Date(pendingSince).toISOString() : null,
      elapsedMin,
      eligible,
    })
  }
  return candidates
}

/**
 * 预览疑似已移除的房间（不修改数据）。
 * 返回候选清单、健康状态、宽限期与可立即移除清单。
 */
export function previewRemovedRooms() {
  const now = Date.now()
  const state = getState()
  const { todayCount } = readCurrentRooms()
  const healthy = todayCount >= (config.removedMinHealthyCount || 800)
  const candidates = detectCandidates({ now, healthy, state })
  // 持久化：清除「已回册」房间的计时；保留仍在等待宽限期的房间
  saveState(state)
  const eligible = candidates.filter(c => c.eligible)
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    healthy,
    todayCount,
    graceMinutes: config.removedGraceMinutes || 60,
    minHealthyCount: config.removedMinHealthyCount || 800,
    totalRooms: readLatestByRoom().size,
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    candidates,
    eligible,
  }
}

/**
 * 移除已判定为「移出」的主播数据。
 * @param {{force?:boolean, rooms?:string[]}} opts
 *   - force=true：忽略宽限期与健康阈值，移除所有候选（或指定的 rooms）
 *   - rooms：仅移除指定房间号（配合 force 用于定向 / 遗留清理）
 */
export function pruneRemovedRooms({ force = false, rooms = null } = {}) {
  const now = Date.now()
  const state = getState()
  const { todayCount } = readCurrentRooms()
  const healthy = todayCount >= (config.removedMinHealthyCount || 800)
  const latest = readJSON(LATEST_FILE, [])
  const latestByRoom = readLatestByRoom()

  let targets = []
  if (Array.isArray(rooms) && rooms.length) {
    // 指定房间定向移除（管理员操作 / 遗留清理），强制模式
    for (const room of rooms.map(String)) {
      const e = latestByRoom.get(room)
      if (!e) continue
      const dates = e.dates.slice().sort()
      targets.push({
        room,
        name: [...e.names].join(' / ') || '(未知昵称)',
        operator: [...e.operators].join(' / ') || '未分配',
        count: e.records.length,
        firstDate: dates[0] || '',
        lastDate: dates[dates.length - 1] || '',
        inYesterday: false,
        records: e.records,
        forced: true,
      })
    }
  } else {
    const candidates = detectCandidates({ now, healthy, state })
    for (const c of candidates) {
      if (force || c.eligible) {
        targets.push({ ...c, records: latestByRoom.get(c.room)?.records || [], forced: force })
      }
    }
  }

  if (!targets.length) {
    saveState(state)
    return { ok: true, pruned: 0, message: '没有需要移除的主播数据', targets: [] }
  }

  // 健康度保护：非强制且抓取异常时不移除，防止误删
  if (!force && !healthy) {
    return {
      ok: false,
      pruned: 0,
      message: `今日抓取条数(${todayCount})低于健康阈值(${config.removedMinHealthyCount})，疑似抓取异常，已暂停移除以防误删`,
      targets: [],
    }
  }

  const targetRooms = new Set(targets.map(t => t.room))
  const pruned = latest.filter(r => !targetRooms.has(roomOf(r)))
  const removedCount = latest.length - pruned.length

  // 备份（可恢复）
  const backup = getBackup()
  for (const t of targets) {
    backup.entries.push({
      room: t.room,
      name: t.name || '(未知昵称)',
      operator: t.operator || '未分配',
      count: t.records.length,
      firstDate: t.firstDate || '',
      lastDate: t.lastDate || '',
      inYesterday: !!t.inYesterday,
      reason: t.forced ? 'manual/force' : 'auto-grace',
      removedAt: new Date().toISOString(),
      records: t.records,
    })
  }
  saveBackup(backup)

  // 写回 latest + 同步 public/dist
  atomicWriteSync(LATEST_FILE, JSON.stringify(pruned, null, 2))
  syncPublic(pruned)
  bus.emit('data-changed', { type: 'removed', rooms: targets.map(t => t.room) })

  // 清除已移除房间的宽限期计时
  for (const room of targetRooms) delete state.pendingSince[room]
  state.lastDetectedAt = new Date().toISOString()
  state.lastHealthy = healthy
  saveState(state)

  log(`[removed] 已移除 ${removedCount} 条记录 / ${targets.length} 个房间（force=${force}）`)

  return {
    ok: true,
    pruned: removedCount,
    rooms: targets.length,
    targets: targets.map(t => ({
      room: t.room,
      name: t.name,
      operator: t.operator,
      count: t.records.length,
      reason: t.forced ? 'force' : 'auto',
    })),
  }
}

/**
 * 从备份恢复指定房间的数据。
 * @param {string[]} rooms 要恢复的房间号列表
 */
export function restoreRemovedRooms(rooms) {
  const targetSet = new Set((Array.isArray(rooms) ? rooms : [rooms]).map(String).filter(Boolean))
  if (!targetSet.size) return { ok: false, error: '未指定要恢复的房间' }
  const backup = getBackup()
  const latest = readJSON(LATEST_FILE, [])
  const restoredRecords = []
  const remaining = []
  for (const entry of backup.entries) {
    if (targetSet.has(String(entry.room))) {
      restoredRecords.push(...(entry.records || []))
    } else {
      remaining.push(entry)
    }
  }
  if (!restoredRecords.length) {
    return { ok: false, error: '备份中未找到指定房间', restored: 0 }
  }
  const merged = mergeRecords(latest, restoredRecords)
  atomicWriteSync(LATEST_FILE, JSON.stringify(merged, null, 2))
  syncPublic(merged)
  bus.emit('data-changed', { type: 'restore', rooms: [...targetSet] })

  backup.entries = remaining
  saveBackup(backup)

  log(`[removed] 已恢复 ${restoredRecords.length} 条记录 / ${targetSet.size} 个房间`)
  return { ok: true, restored: restoredRecords.length, rooms: targetSet.size }
}

/** 列出已移除备份（供前端「主播移除同步」面板展示） */
export function listRemovedRooms() {
  const backup = getBackup()
  return {
    ok: true,
    count: backup.entries.length,
    entries: backup.entries.map(e => ({
      room: e.room,
      name: e.name,
      operator: e.operator,
      count: e.count,
      firstDate: e.firstDate,
      lastDate: e.lastDate,
      inYesterday: e.inYesterday,
      reason: e.reason,
      removedAt: e.removedAt,
    })),
  }
}
