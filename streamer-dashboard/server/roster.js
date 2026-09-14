import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

const ROSTER_PATH = path.join(DATA_DIR, 'roster.json')

const DEFAULT = {
  offlineRooms: [],
  status: {},   // { [room]: { status: '在职'|'离职', reason: '', leaveDate: '' } }
  extra: {},    // { [room]: { openDate: '', guarantee: '' } }
  tracks: {},   // { [room]: '晋级赛'|'排位赛' } 手动指定赛道（本周 / 指定周）
  updatedAt: null,
}

export function loadRoster() {
  try {
    const raw = fs.readFileSync(ROSTER_PATH, 'utf8')
    const j = JSON.parse(raw)
    return {
      offlineRooms: Array.isArray(j.offlineRooms) ? j.offlineRooms.map(String) : [],
      status: j.status && typeof j.status === 'object' ? j.status : {},
      extra: j.extra && typeof j.extra === 'object' ? j.extra : {},
      tracks: j.tracks && typeof j.tracks === 'object' ? j.tracks : {},
      updatedAt: j.updatedAt || null,
    }
  } catch {
    return { ...DEFAULT, offlineRooms: [], status: {}, extra: {}, tracks: {} }
  }
}

export function saveRoster(r) {
  const next = {
    offlineRooms: Array.isArray(r.offlineRooms) ? r.offlineRooms.map(String) : [],
    status: r.status || {},
    extra: r.extra || {},
    tracks: r.tracks || {},
    updatedAt: new Date().toISOString(),
  }
  const data = JSON.stringify(next, null, 2)
  // Windows 下偶发 EPERM（实时杀毒扫描 / readFileSync 与 writeFileSync 并发抢锁）：
  // 使用原子写入（rename + copyFile 降级 + 指数退避重试），避免一次 EPERM 直接 500。
  atomicWriteSync(ROSTER_PATH, data)
  return next
}

// 当前名册的纯数据快照（用于导入前备份 / 回滚来源）
export function snapshotRoster() {
  const r = loadRoster()
  return {
    offlineRooms: [...r.offlineRooms],
    status: { ...r.status },
    extra: { ...r.extra },
    tracks: { ...r.tracks },
  }
}

// 用快照整体还原名册（回滚时调用；覆盖写，单文件原子写入）
export function restoreRoster(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('快照无效')
  return saveRoster({
    offlineRooms: Array.isArray(snapshot.offlineRooms) ? snapshot.offlineRooms : [],
    status: snapshot.status || {},
    extra: snapshot.extra || {},
    tracks: snapshot.tracks || {},
  })
}

/**
 * 将一批已校验的导入行合并进当前名册（只新增/更新，从不做删除）。
 * 返回合并后的名册 + 影响摘要（新增/更新/受影响房间）。
 * @param {Array<{room:string, openDate:string, guarantee:number|string, status:string}>} rows
 */
export function mergeRosterImport(rows) {
  const cur = loadRoster()
  const prevRooms = new Set(cur.offlineRooms.map(String))
  const nextOffline = new Set(cur.offlineRooms.map(String))
  const nextStatus = { ...cur.status }
  const nextExtra = { ...cur.extra }
  const affected = []
  let added = 0
  let updated = 0

  rows.forEach((row) => {
    const room = String(row.room)
    const isNew = !prevRooms.has(room)
    if (isNew) {
      nextOffline.add(room)
      added++
      affected.push(room)
    }
    if (row.status === '在职' || row.status === '离职') {
      const before = nextStatus[room] || null
      nextStatus[room] = { status: row.status, reason: '', leaveDate: '', updatedAt: new Date().toISOString() }
      if (!isNew && before && before.status !== row.status) {
        updated++
        if (!affected.includes(room)) affected.push(room)
      }
    }
    const patch = {}
    let extraChanged = false
    if (row.openDate) {
      patch.openDate = row.openDate
      extraChanged = true
    }
    if (row.guarantee !== '' && row.guarantee != null) {
      patch.guarantee = Number(row.guarantee)
      extraChanged = true
    }
    if (extraChanged) {
      nextExtra[room] = { ...(nextExtra[room] || {}), ...patch }
      if (!isNew) {
        updated++
        if (!affected.includes(room)) affected.push(room)
      }
    }
  })

  const roster = saveRoster({
    offlineRooms: Array.from(nextOffline),
    status: nextStatus,
    extra: nextExtra,
    tracks: cur.tracks,
  })
  return {
    roster,
    summary: { added, updated, removed: 0, affectedRooms: affected },
  }
}

export { ROSTER_PATH }
