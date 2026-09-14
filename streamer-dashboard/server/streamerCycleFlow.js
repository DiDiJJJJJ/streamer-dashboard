// 主播周期流水：以每个线下主播「首次开播当天」为周期起点，每 30 天为一个周期。
// 第一周期 = 第 1~30 天；第二周期 = 第 31~60 天；第三周期 = 第 61~90 天。
// 每个周期仅统计该窗口内的流水；页面展示当前周期标识与距离下个周期的剩余天数，
// 并提供对前三个周期流水（含每日明细）的查询。
//
// 首次开播日期判定规则：以 B站后台首次产生【开播时长】数据（开播时长（小时）> 0）的日期为准。
// - 7月之前的首次开播日期由附件 Excel（7月份之前首次开播日期.xlsx）提供，固化在
//   streamer_first_broadcast.json 中作为权威覆盖项；由于抓取数据最早从 7 月开始，
//   推导出的日期只会更晚，因此这些覆盖项永远不会被后续抓取覆盖。
// - 其余主播以 latest.json 中首次 开播时长>0 的日期为准；每日抓取后由 syncFirstBroadcast() 同步更新。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { atomicWriteSync } from './utils/atomicWrite.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const LATEST_FILE = path.join(DATA_DIR, 'latest.json')
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json')
const FIRST_BROADCAST_FILE = path.join(DATA_DIR, 'streamer_first_broadcast.json')

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return fallback
  }
  return fallback
}

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fmtDate(dt) {
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function addDays(dt, n) {
  return new Date(dt.getTime() + n * 86400000)
}
function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function todayInShanghai() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function isRange(r) {
  const s = r['统计开始日期'] || ''
  const e = r['统计结束日期'] || r['统计日期'] || ''
  return !!s && !!e && s !== e
}

function readOfflineRooms() {
  const roster = readJSON(ROSTER_FILE, {})
  const list = Array.isArray(roster.offlineRooms) ? roster.offlineRooms : []
  return new Set(list.map(String))
}

let _latestCache = { mtime: 0, data: null }
function loadLatest() {
  try {
    const mtime = fs.statSync(LATEST_FILE).mtimeMs
    if (_latestCache.data && _latestCache.mtime === mtime) return _latestCache.data
    const data = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf-8'))
    _latestCache = { mtime, data }
    return data
  } catch {
    return []
  }
}

let _fbStoreCache = { mtime: 0, data: null }
function loadFirstBroadcastStore() {
  try {
    const mtime = fs.existsSync(FIRST_BROADCAST_FILE) ? fs.statSync(FIRST_BROADCAST_FILE).mtimeMs : -1
    if (_fbStoreCache.data && _fbStoreCache.mtime === mtime) return _fbStoreCache.data
    const data = fs.existsSync(FIRST_BROADCAST_FILE)
      ? JSON.parse(fs.readFileSync(FIRST_BROADCAST_FILE, 'utf-8'))
      : {}
    _fbStoreCache = { mtime, data }
    return data
  } catch {
    return {}
  }
}

let _fbCalcCache = { mtime: 0, map: null }
function computeFirstBroadcastMap() {
  const mtime = fs.existsSync(LATEST_FILE) ? fs.statSync(LATEST_FILE).mtimeMs : 0
  if (_fbCalcCache.map && _fbCalcCache.mtime === mtime) return _fbCalcCache.map
  const latest = loadLatest()
  const map = {}
  for (const r of latest) {
    const room = String(r['房间号'] || '').trim()
    if (!room) continue
    if (isRange(r)) continue
    const d = parseDate(r['统计日期'])
    if (!d) continue
    const dur = Number(r['开播时长（小时）'] || 0)
    if (dur > 0) {
      const key = fmtDate(d)
      if (!map[room] || key < map[room]) map[room] = key
    }
  }
  _fbCalcCache = { mtime, map }
  return map
}

export function getFirstBroadcast(room) {
  room = String(room || '').trim()
  const store = loadFirstBroadcastStore()
  if (store[room]) return store[room]
  const map = computeFirstBroadcastMap()
  return map[room] || null
}

export function syncFirstBroadcast() {
  const map = computeFirstBroadcastMap()
  const store = loadFirstBroadcastStore()
  let changed = false
  const offline = readOfflineRooms()
  for (const room of Object.keys(map)) {
    if (!offline.has(room)) continue
    const cand = map[room]
    if (!store[room] || cand < store[room]) {
      store[room] = cand
      changed = true
    }
  }
  // 仅保留线下主播，清理任何非线下房号（防止历史写入污染 store）
  for (const k of Object.keys(store)) {
    if (!offline.has(k)) { delete store[k]; changed = true }
  }
  if (changed) {
    const sorted = Object.keys(store)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
      .reduce((o, k) => { o[k] = store[k]; return o }, {})
    atomicWriteSync(FIRST_BROADCAST_FILE, JSON.stringify(sorted, null, 2))
    _fbStoreCache = { mtime: fs.statSync(FIRST_BROADCAST_FILE).mtimeMs, data: sorted }
  }
  return { ok: true, updated: changed, count: Object.keys(store).length }
}

export function getOfflineStreamerRooms() {
  const latest = loadLatest()
  const offline = readOfflineRooms()
  const nickMap = {}
  for (const r of latest) {
    const room = String(r['房间号'] || '').trim()
    if (!room) continue
    if (offline.has(room) && r['主播昵称'] && !nickMap[room]) nickMap[room] = r['主播昵称']
  }
  const list = [...offline].map((room) => ({ room, nickname: nickMap[room] || '' }))
  list.sort((a, b) => (a.nickname || a.room).localeCompare(b.nickname || b.room, 'zh'))
  return { ok: true, count: list.length, rooms: list }
}

export function getStreamerCycleFlow(room, refDate) {
  room = String(room || '').trim()
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(refDate || '') ? refDate : todayInShanghai()
  const refDt = parseDate(ref)
  const latest = loadLatest()
  const recs = latest.filter((r) => String(r['房间号'] || '').trim() === room && !isRange(r))
  const st = getRoomStatus(room)
  const nickname = (recs.find((r) => r['主播昵称']) || {})['主播昵称'] || ''
  const firstBroadcast = getFirstBroadcast(room)

  if (!recs.length || !firstBroadcast) {
    return {
      ok: true,
      room,
      nickname,
      firstBroadcast: firstBroadcast,
      refDate: ref,
      currentCycle: 0,
      daysRemaining: null,
      beyondThree: false,
      hasData: recs.length > 0,
      noFirstBroadcast: !firstBroadcast,
      cycles: [],
      status: st.status,
      statusLabel: st.statusLabel,
      leaveDate: st.leaveDate,
    }
  }

  const firstDt = parseDate(firstBroadcast)
  const cycles = []
  for (let c = 1; c <= 3; c++) {
    const startDt = addDays(firstDt, (c - 1) * 30)
    const endDt = addDays(firstDt, c * 30 - 1)
    const start = fmtDate(startDt)
    const end = fmtDate(endDt)
    const inWindow = recs.filter((r) => {
      const d = parseDate(r['统计日期'])
      return d && d >= startDt && d <= endDt
    })
    let totalFlow = 0
    const dailyMap = {}
    for (const r of inWindow) {
      const f = Number(r['总流水（元）']) || 0
      totalFlow += f
      const d = r['统计日期']
      dailyMap[d] = round2((dailyMap[d] || 0) + f)
    }
    const daily = Object.keys(dailyMap)
      .sort()
      .map((d) => ({ date: d, flow: dailyMap[d] }))
    const days = daily.length
    cycles.push({
      cycle: c,
      start,
      end,
      totalFlow: round2(totalFlow),
      days,
      dailyAvg: days ? round2(totalFlow / days) : 0,
      isCurrent: false,
      daily,
    })
  }

  const dayIndex = diffDays(refDt, firstDt) + 1
  let currentCycle = dayIndex > 0 ? Math.ceil(dayIndex / 30) : 0
  let daysRemaining = null
  let beyondThree = false
  if (currentCycle >= 1) {
    if (currentCycle > 3) beyondThree = true
    const nextStartDt = addDays(firstDt, currentCycle * 30)
    daysRemaining = diffDays(nextStartDt, refDt)
    for (const cy of cycles) if (cy.cycle === currentCycle) cy.isCurrent = true
  } else {
    daysRemaining = diffDays(firstDt, refDt)
  }

  return {
    ok: true,
    room,
    nickname,
    firstBroadcast,
    refDate: ref,
    currentCycle,
    daysRemaining,
    beyondThree,
    hasData: true,
    noFirstBroadcast: false,
    cycles,
    status: st.status,
    statusLabel: st.statusLabel,
    leaveDate: st.leaveDate,
  }
}

function getRoomStatus(room) {
  const roster = readJSON(ROSTER_FILE, {})
  const st = (roster.status && roster.status[room]) || {}
  const label = st.status === '离职' ? '离职' : '在职'
  return {
    status: label === '离职' ? 'inactive' : 'active',
    statusLabel: label,
    leaveDate: st.leaveDate || '',
  }
}

export function getStreamerCycleFlowSummary(refDate) {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(refDate || '') ? refDate : todayInShanghai()
  const refDt = parseDate(ref)
  const latest = loadLatest()
  const offline = readOfflineRooms()
  const nickMap = {}
  for (const r of latest) {
    const room = String(r['房间号'] || '').trim()
    if (offline.has(room) && r['主播昵称'] && !nickMap[room]) nickMap[room] = r['主播昵称']
  }
  const rows = []
  for (const room of offline) {
    const recs = latest.filter((r) => String(r['房间号'] || '').trim() === room && !isRange(r))
    const st = getRoomStatus(room)
    const firstBroadcast = getFirstBroadcast(room)
    let currentCycle = 0, daysRemaining = null, beyondThree = false
    const cyclesMeta = []
    if (firstBroadcast) {
      const firstDt = parseDate(firstBroadcast)
      for (let c = 1; c <= 3; c++) {
        const startDt = addDays(firstDt, (c - 1) * 30)
        const endDt = addDays(firstDt, c * 30 - 1)
        const inWindow = recs.filter((r) => {
          const d = parseDate(r['统计日期'])
          return d && d >= startDt && d <= endDt
        })
        let totalFlow = 0
        for (const r of inWindow) totalFlow += Number(r['总流水（元）']) || 0
        cyclesMeta.push({ cycle: c, start: fmtDate(startDt), end: fmtDate(endDt), totalFlow: round2(totalFlow), days: inWindow.length })
      }
      const dayIndex = diffDays(refDt, firstDt) + 1
      currentCycle = dayIndex > 0 ? Math.ceil(dayIndex / 30) : 0
      if (currentCycle >= 1) {
        if (currentCycle > 3) beyondThree = true
        daysRemaining = diffDays(addDays(firstDt, currentCycle * 30), refDt)
      } else {
        daysRemaining = diffDays(firstDt, refDt)
      }
    }
    const threeTotal = round2(cyclesMeta.reduce((s, c) => s + c.totalFlow, 0))
    rows.push({
      room,
      nickname: nickMap[room] || '',
      status: st.status,
      statusLabel: st.statusLabel,
      leaveDate: st.leaveDate,
      firstBroadcast,
      refDate: ref,
      currentCycle,
      daysRemaining,
      beyondThree,
      hasData: recs.length > 0,
      noFirstBroadcast: !firstBroadcast,
      cycles: cyclesMeta,
      threeTotal,
    })
  }
  // 排序三档：在职(未结束) → 新主播周期已结束(中间) → 离职(未结束)
  // 满足「三个周期已结束的主播排在职与离职两个分组的中间区域」需求。
  rows.sort((a, b) => {
    const tier = (r) => (r.beyondThree ? 2 : (r.status === 'active' ? 1 : 3))
    const ta = tier(a), tb = tier(b)
    if (ta !== tb) return ta - tb
    if (b.currentCycle !== a.currentCycle) return b.currentCycle - a.currentCycle
    return b.threeTotal - a.threeTotal
  })
  return { ok: true, refDate: ref, count: rows.length, rows }
}
