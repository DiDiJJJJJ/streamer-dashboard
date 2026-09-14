import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, config, log } from './config.js'
import { bus } from './events.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

// ---------------- 运营团队变动实时同步 ----------------
// 本模块维护一份「运营人员（运营经纪人）花名册」ops_team.json，并自动检测人员增减：
//   - 新增（add）：某运营经纪人名字首次出现在当前抓取数据中 → 自动入库为「在职」
//   - 减少（remove）：某在职运营连续 N 分钟（宽限期）未再出现于抓取数据 → 自动标记为「已离」
// 判定信号复用「今日抓取快照 today.json」作为当前在册权威来源（与主播移除机制同源），
// 抓取不健康时回退到 latest.json 当月数据，且宽限期内不标记离职，防御单次抓取残缺 / 网络抖动误判。
// 所有变动写入 ops_team_changelog.json，并通过 bus('ops-team-changed') 触发 SSE 推送，
// 前端无需手动刷新即可反映最新团队状态（在职人数 / 团队结构 / 绩效汇总）。
// 兼容批量调整：POST /api/ops-team/batch 可由管理员一次性增删多名运营（绕过宽限期立即生效）。

const LATEST_FILE = path.join(DATA_DIR, 'latest.json')
const TODAY_FILE = path.join(DATA_DIR, 'today.json')
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json')
const ARCHIVE_FILE = path.join(DATA_DIR, 'union_recruit_archive.json')
const TEAM_FILE = path.join(DATA_DIR, 'ops_team.json')            // 花名册（权威名册）
const CHANGELOG_FILE = path.join(DATA_DIR, 'ops_team_changelog.json') // 变动记录
const STATE_FILE = path.join(DATA_DIR, 'ops_team_state.json')    // 宽限期计时状态

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    log('[opsTeam] 读取失败 ' + path.basename(file) + ': ' + e.message)
  }
  return fallback
}
function mtime(file) {
  try { return fs.statSync(file).mtimeMs } catch { return 0 }
}
function iso(ts) {
  return new Date(ts || Date.now()).toISOString()
}
function parseOperator(raw) {
  const s = String(raw || '').trim()
  if (!s) return '未分配'
  const t = s.replace(/^运营经纪人[：:\s]+/i, '').replace(/^经纪人[：:\s]+/i, '').trim()
  return t.split('|')[0].trim() || '未分配'
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function readOfflineRooms() {
  try {
    if (!fs.existsSync(ROSTER_FILE)) return new Set()
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'))
    const list = Array.isArray(roster.offlineRooms) ? roster.offlineRooms : []
    return new Set(list.map(String))
  } catch {
    return new Set()
  }
}
function isRange(r) {
  const s = r['统计开始日期'] || ''
  const e = r['统计结束日期'] || r['统计日期'] || ''
  return !!s && !!e && s !== e
}
function monthOf(r) {
  const d = r['统计结束日期'] || r['统计日期'] || ''
  return /^\d{4}-\d{2}/.test(d || '') ? String(d).slice(0, 7) : ''
}
function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ---------------- 持久化 ----------------
function getRoster() {
  return readJSON(TEAM_FILE, { version: 1, updatedAt: null, entries: {} })
}
function saveRoster(r) {
  atomicWriteSync(TEAM_FILE, JSON.stringify(r, null, 2))
}
function getChangelog() {
  return readJSON(CHANGELOG_FILE, { version: 1, entries: [] })
}
function appendChangelog(entry) {
  const clog = getChangelog()
  clog.entries = clog.entries || []
  clog.entries.push(entry)
  // 仅保留最近 500 条，避免无限增长
  if (clog.entries.length > 500) clog.entries = clog.entries.slice(-500)
  atomicWriteSync(CHANGELOG_FILE, JSON.stringify(clog, null, 2))
}
function getState() {
  return readJSON(STATE_FILE, { pendingSince: {}, lastDetectedAt: null, lastHealthy: true })
}
function saveState(s) {
  atomicWriteSync(STATE_FILE, JSON.stringify(s, null, 2))
}

// 当前在册运营人员集合（取自今日抓取；抓取不健康时回退到 latest 当月）
function currentOperators() {
  const today = readJSON(TODAY_FILE, [])
  const todayCount = Array.isArray(today) ? today.length : 0
  const healthy = todayCount >= (config.opsMinHealthyCount || config.removedMinHealthyCount || 800)
  const set = new Set()
  if (healthy && todayCount > 0) {
    for (const r of today) {
      const op = parseOperator(r['运营经纪人'])
      if (op && op !== '未分配') set.add(op)
    }
    return { set, source: 'today', count: todayCount, healthy: true }
  }
  // 回退：latest 当月
  const latest = readJSON(LATEST_FILE, [])
  const m = currentMonth()
  for (const r of latest) {
    if (isRange(r)) continue
    if (monthOf(r) !== m) continue
    const op = parseOperator(r['运营经纪人'])
    if (op && op !== '未分配') set.add(op)
  }
  return { set, source: healthy ? 'today-empty' : 'latest-fallback', count: todayCount, healthy: false }
}

// 当月各运营绩效 / 团队结构（带 mtime 缓存，避免每次全量扫描）
let _mCache = { key: null, data: null }
function computeTeamMetrics({ force = false } = {}) {
  const m = currentMonth()
  const key = [m, mtime(LATEST_FILE), mtime(ROSTER_FILE), mtime(ARCHIVE_FILE)].join('|')
  if (!force && _mCache.key === key && _mCache.data) return _mCache.data

  const latest = readJSON(LATEST_FILE, [])
  const offlineRooms = readOfflineRooms()
  const archive = readJSON(ARCHIVE_FILE, { version: 2, records: [] })
  const map = {}
  for (const r of latest) {
    if (isRange(r)) continue
    if (monthOf(r) !== m) continue
    const op = parseOperator(r['运营经纪人'])
    if (op === '未分配') continue
    if (!map[op]) map[op] = { totalFlow: 0, offlineFlow: 0, onlineFlow: 0, rooms: new Set(), offlineRooms: new Set(), onlineRooms: new Set() }
    const a = map[op]
    const room = String(r['房间号'] || '').trim()
    const f = Number(r['总流水（元）']) || 0
    a.totalFlow += f
    const isOff = room && offlineRooms.has(room)
    if (isOff) a.offlineFlow += f
    else a.onlineFlow += f
    if (room) {
      a.rooms.add(room)
      if (isOff) a.offlineRooms.add(room)
      else a.onlineRooms.add(room)
    }
  }
  const joinedStatus = new Set(config.selectors.statusJoined || ['已入会'])
  for (const rec of (archive.records || [])) {
    if (!joinedStatus.has(rec.status)) continue
    if (String(rec.date || '').slice(0, 7) !== m) continue
    const op = rec.operator || '未分配'
    if (op === '未分配') continue
    if (!map[op]) map[op] = { totalFlow: 0, offlineFlow: 0, onlineFlow: 0, rooms: new Set(), offlineRooms: new Set(), onlineRooms: new Set() }
    const a = map[op]
    if (!a.joined) a.joined = { online: 0, offline: 0, unknown: 0, total: 0 }
    const bucket = rec.room ? (offlineRooms.has(rec.room) ? 'offline' : 'online') : 'unknown'
    a.joined[bucket] += 1
    a.joined.total += 1
  }
  const out = {}
  for (const [op, a] of Object.entries(map)) {
    out[op] = {
      totalFlow: round2(a.totalFlow),
      offlineFlow: round2(a.offlineFlow),
      onlineFlow: round2(a.onlineFlow),
      roomCount: a.rooms.size,
      offlineRoomCount: a.offlineRooms.size,
      onlineRoomCount: a.onlineRooms.size,
      joined: a.joined || { online: 0, offline: 0, unknown: 0, total: 0 },
    }
  }
  _mCache = { key, data: out }
  return out
}

// ---------------- 核心：自动同步检测 ----------------
/**
 * 依据当前抓取数据，自动检测运营人员新增 / 减少，并刷新花名册与变动记录。
 * @param {{force?:boolean}} opts force=true 时忽略宽限期，把当前不在册的在职人员立即标记为已离（仅手动触发时使用）
 */
export function syncOpsTeam({ force = false } = {}) {
  const now = Date.now()
  const { set: curSet, healthy } = currentOperators()
  const roster = getRoster()
  if (!roster.entries || typeof roster.entries !== 'object') roster.entries = {}
  const state = getState()
  if (!state.pendingSince || typeof state.pendingSince !== 'object') state.pendingSince = {}
  const graceMs = (config.opsGraceMinutes || 60) * 60_000
  const changes = []

  // 1) 处理当前在册人员：新增 / 重新激活 / 清除宽限计时
  for (const name of curSet) {
    const e = roster.entries[name]
    if (!e) {
      roster.entries[name] = {
        name, status: 'active', firstSeen: iso(now), joinedAt: iso(now),
        leftAt: null, lastSeen: iso(now), note: '',
      }
      changes.push({ type: 'add', name })
    } else {
      e.lastSeen = iso(now)
      if (e.status === 'left') {
        e.status = 'active'
        e.leftAt = null
        e.reactivatedAt = iso(now)
        changes.push({ type: 'reactivate', name })
      }
      if (state.pendingSince[name]) delete state.pendingSince[name]
    }
  }

  // 2) 处理缺失的在职人员：进入宽限期 → 达标后标记离职（抓取不健康或 force=false 时按规则）
  if (healthy || force) {
    for (const [name, e] of Object.entries(roster.entries)) {
      if (e.status !== 'active') continue
      if (curSet.has(name)) continue
      if (force) {
        e.status = 'left'
        e.leftAt = iso(now)
        changes.push({ type: 'remove', name })
        delete state.pendingSince[name]
      } else if (healthy) {
        if (!state.pendingSince[name]) state.pendingSince[name] = iso(now)
        const since = new Date(state.pendingSince[name]).getTime()
        if (now - since >= graceMs) {
          e.status = 'left'
          e.leftAt = iso(now)
          changes.push({ type: 'remove', name })
          delete state.pendingSince[name]
        }
      }
      // !healthy && !force：不推进宽限、不标记离职，等待抓取恢复正常
    }
  }

  // 3) 持久化
  roster.updatedAt = new Date().toISOString()
  saveRoster(roster)
  saveState(state)

  // 4) 变动记录
  for (const c of changes) {
    appendChangelog({
      ts: new Date().toISOString(),
      type: c.type,
      name: c.name,
      by: 'auto',
      note: c.type === 'remove'
        ? '自动检测（连续未出现在抓取数据中，宽限期达标）'
        : c.type === 'reactivate'
          ? '自动重新激活（重新出现在抓取数据中）'
          : '自动检测（抓取数据中出现新运营）',
    })
  }

  // 5) 广播（驱动前端实时刷新）
  const added = changes.filter(c => c.type === 'add').map(c => c.name)
  const removed = changes.filter(c => c.type === 'remove').map(c => c.name)
  const reactivated = changes.filter(c => c.type === 'reactivate').map(c => c.name)
  if (changes.length) {
    bus.emit('ops-team-changed', { at: new Date().toISOString(), added, removed, reactivated, source: 'auto' })
  }

  log(`[opsTeam] 同步完成：当前在册 ${curSet.size} 人，本次变动 ${changes.length} 项（add ${added.length}/remove ${removed.length}/reactivate ${reactivated.length}）`)
  return { ok: true, current: curSet.size, healthy, changes: changes.length, added, removed, reactivated }
}

/** 只读预览（供前端展示当前状态与宽限期候选项） */
export function previewOpsTeam() {
  const { set, source, count, healthy } = currentOperators()
  const roster = getRoster()
  const state = getState()
  const pending = Object.entries(state.pendingSince || {}).map(([name, since]) => ({
    name,
    since,
    elapsedMin: Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000)),
  }))
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    healthy,
    source,
    currentCount: set.size,
    graceMinutes: config.opsGraceMinutes || 60,
    minHealthyCount: config.opsMinHealthyCount || config.removedMinHealthyCount || 800,
    activeCount: Object.values(roster.entries || {}).filter(e => e.status === 'active').length,
    pending,
  }
}

/** 聚合输出：在职人数 / 团队结构 / 绩效汇总 / 变动记录 / 宽限期候选项 */
export function getOpsTeamSummary({ force = false } = {}) {
  const roster = getRoster()
  const entries = roster.entries || {}
  const metrics = computeTeamMetrics({ force })
  const m = currentMonth()
  const operators = Object.values(entries).map(e => ({
    name: e.name,
    status: e.status,
    joinedAt: e.joinedAt,
    leftAt: e.leftAt,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    reactivatedAt: e.reactivatedAt || null,
    note: e.note || '',
    metrics: metrics[e.name] || {
      totalFlow: 0, offlineFlow: 0, onlineFlow: 0, roomCount: 0,
      offlineRoomCount: 0, onlineRoomCount: 0,
      joined: { online: 0, offline: 0, unknown: 0, total: 0 },
    },
  }))
  // 在职在前、已离在后；同状态按姓名排序
  operators.sort((a, b) =>
    (a.status === 'left' ? 1 : 0) - (b.status === 'left' ? 1 : 0) || a.name.localeCompare(b.name))

  const active = operators.filter(o => o.status === 'active').length
  const left = operators.filter(o => o.status === 'left').length

  const state = getState()
  const pending = Object.entries(state.pendingSince || {}).map(([name, since]) => ({
    name,
    since,
    elapsedMin: Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000)),
  }))

  // 本月变动统计
  const clog = getChangelog()
  const all = clog.entries || []
  const thisMonth = all.filter(c => (c.ts || '').slice(0, 7) === m)
  const addedThisMonth = thisMonth.filter(c => c.type === 'add' || c.type === 'batch-add').length
  const removedThisMonth = thisMonth.filter(c => c.type === 'remove' || c.type === 'batch-remove').length

  // 绩效汇总（在职人员当月合计）
  let sumTotal = 0, sumOffline = 0, sumOnline = 0, sumRooms = 0, sumJoined = 0
  for (const o of operators) {
    if (o.status !== 'active') continue
    sumTotal += o.metrics.totalFlow
    sumOffline += o.metrics.offlineFlow
    sumOnline += o.metrics.onlineFlow
    sumRooms += o.metrics.roomCount
    sumJoined += o.metrics.joined.total
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    currentMonth: m,
    headcount: { active, left, total: operators.length },
    operators,
    pending,
    changes: { addedThisMonth, removedThisMonth },
    performanceSummary: {
      activeHeadcount: active,
      totalFlow: round2(sumTotal),
      offlineFlow: round2(sumOffline),
      onlineFlow: round2(sumOnline),
      roomCount: sumRooms,
      joined: sumJoined,
      avgFlowPerOperator: active ? round2(sumTotal / active) : 0,
    },
    changelog: all.slice(-60).reverse(),
    graceMinutes: config.opsGraceMinutes || 60,
    minHealthyCount: config.opsMinHealthyCount || config.removedMinHealthyCount || 800,
  }
}

// ---------------- 批量调整（管理员手动增删，绕过宽限期） ----------------
/**
 * 一次性增删多名运营人员（兼容批量调整场景）。
 * @param {{add?:string[]|string, remove?:string[]|string, by?:string}} opts
 */
export function batchAdjustOpsTeam({ add = [], remove = [], by = 'admin' } = {}) {
  const norm = (arr) => (Array.isArray(arr) ? arr : String(arr || '').split(/[\n,，]/))
    .map(s => String(s).trim()).filter(Boolean)
  const adds = [...new Set(norm(add))]
  const removes = [...new Set(norm(remove))]
  const now = new Date().toISOString()
  const roster = getRoster()
  if (!roster.entries || typeof roster.entries !== 'object') roster.entries = {}
  const state = getState()
  if (!state.pendingSince) state.pendingSince = {}
  const changes = []

  for (const name of adds) {
    const e = roster.entries[name]
    if (!e) {
      roster.entries[name] = { name, status: 'active', firstSeen: now, joinedAt: now, leftAt: null, lastSeen: now, note: '手动添加' }
      changes.push({ type: 'batch-add', name })
    } else if (e.status === 'left') {
      e.status = 'active'
      e.leftAt = null
      e.reactivatedAt = now
      e.note = '手动恢复'
      if (state.pendingSince[name]) delete state.pendingSince[name]
      changes.push({ type: 'batch-add', name, reactivated: true })
    } else {
      changes.push({ type: 'batch-add', name, noop: true })
    }
  }
  for (const name of removes) {
    const e = roster.entries[name]
    if (e && e.status === 'active') {
      e.status = 'left'
      e.leftAt = now
      e.note = '手动移除'
      if (state.pendingSince[name]) delete state.pendingSince[name]
      changes.push({ type: 'batch-remove', name })
    } else if (!e) {
      // 名册中无此人：补建一条已离记录，保留审计轨迹
      roster.entries[name] = { name, status: 'left', firstSeen: now, joinedAt: null, leftAt: now, lastSeen: now, note: '手动移除（原不在册）' }
      changes.push({ type: 'batch-remove', name, created: true })
    } else {
      changes.push({ type: 'batch-remove', name, noop: true })
    }
  }

  roster.updatedAt = now
  saveRoster(roster)
  saveState(state)

  const effective = changes.filter(c => !c.noop)
  for (const c of effective) {
    appendChangelog({
      ts: now,
      type: c.type,
      name: c.name,
      by,
      note: c.type === 'batch-add'
        ? (c.reactivated ? '批量调整：重新激活' : '批量调整：新增')
        : (c.created ? '批量调整：移除（原不在册）' : '批量调整：移除'),
    })
  }
  if (effective.length) {
    bus.emit('ops-team-changed', {
      at: now,
      added: effective.filter(c => c.type === 'batch-add').map(c => c.name),
      removed: effective.filter(c => c.type === 'batch-remove').map(c => c.name),
      batch: true,
    })
  }
  return { ok: true, added: adds.length, removed: removes.length, changes: effective }
}
