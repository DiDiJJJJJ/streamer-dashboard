import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'
import { loadRoster } from './roster.js'
import { readData } from './fetcher.js'
import { computeChallenge } from '../src/utils/challenge.js'

const SHARE_FILE = path.join(DATA_DIR, 'share_tokens.json')

/** Date → 本地 YYYY-MM-DD，用于与记录中的统计日期(字符串)做区间比较 */
function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 从参与本周榜单的真实记录中，取「统计结束日期 / 统计日期」的最小~最大区间，
 * 作为数据真正的统计周期（而非页面生成时刻）。
 */
function computeStatTime(enriched, weekStart, weekEnd) {
  const ws = ymd(weekStart)
  const we = ymd(weekEnd)
  const dates = enriched
    .filter(r => r['是否线下主播'] === true && r['在职状态'] !== '离职')
    .map(r => r['统计结束日期'] || r['统计日期'] || '')
    .filter(Boolean)
    .filter(d => d >= ws && d <= we)
    .sort()
  const start = dates[0] || ws
  const end = dates[dates.length - 1] || we
  return start === end ? start : `${start} ~ ${end}`
}

/**
 * 数据实际产生并统计完成的具体时间：
 * 取 latest.json 最后一次写入（数据合并 / 同步落盘完成）的本地文件时间，
 * 即"数据真正产生、统计完成"的真实时刻，精确到秒。
 */
function computeDataGeneratedAt() {
  try {
    const f = path.join(DATA_DIR, 'latest.json')
    const stat = fs.statSync(f)
    return stat.mtime.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function loadShares() {
  try {
    if (fs.existsSync(SHARE_FILE)) return JSON.parse(fs.readFileSync(SHARE_FILE, 'utf-8'))
  } catch { /* ignore */ }
  return []
}

function saveShares(arr) {
  try { atomicWriteSync(SHARE_FILE, JSON.stringify(arr, null, 2)) } catch { /* ignore */ }
}

/** 创建一条对外分享链接令牌（带有效期） */
export function createShare({ label = '', expiresInHours = 168 } = {}) {
  const token = crypto.randomBytes(24).toString('hex')
  const now = Date.now()
  const entry = {
    token,
    label: String(label || ''),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(1, Number(expiresInHours) || 168) * 3600_000).toISOString(),
    revoked: false,
  }
  const all = loadShares()
  all.push(entry)
  saveShares(all)
  return entry
}

/** 取有效令牌（未撤销且未过期），否则返回 null */
export function getValidShare(token) {
  if (!token) return null
  const e = loadShares().find(x => x.token === token)
  if (!e || e.revoked) return null
  if (new Date(e.expiresAt).getTime() <= Date.now()) return null
  return e
}

export function revokeShare(token) {
  const all = loadShares()
  const e = all.find(x => x.token === token)
  if (!e) return false
  e.revoked = true
  saveShares(all)
  return true
}

export function listShares() {
  const now = Date.now()
  return loadShares().map(e => ({
    token: e.token,
    tokenMask: e.token.slice(0, 8) + '…',
    label: e.label,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    active: !e.revoked && new Date(e.expiresAt).getTime() > now,
  }))
}

export function cleanupExpiredShares() {
  const now = Date.now()
  const all = loadShares()
  const next = all.filter(e => !(e.revoked || new Date(e.expiresAt).getTime() <= now))
  if (next.length !== all.length) saveShares(next)
  return all.length - next.length
}

/**
 * 将 latest.json 原始记录按名册补全 是否线下主播 / 在职状态
 * （与前端 src/hooks/useStreamerData.js 的 dailyRecords 逻辑保持一致，确保挑战赛过滤口径统一）
 */
function enrichRecords(records, roster) {
  const offline = new Set(Array.isArray(roster.offlineRooms) ? roster.offlineRooms : [])
  const status = roster.status || {}
  return records.map(r => {
    const room = String(r['房间号'] || '')
    const st = status[room] || { status: '在职' }
    return { ...r, '是否线下主播': offline.has(room), '在职状态': st.status || '在职' }
  })
}

/** 计算"本周"挑战赛榜单（当前自然周），返回对外分享用的精简结构 */
export function computeCurrentWeekBoard() {
  const records = readData('latest') || []
  const roster = loadRoster()
  const enriched = enrichRecords(records, roster)
  const weekStats = computeChallenge(enriched, {
    startDate: undefined,
    endDate: undefined,
    tracks: roster.tracks || {},
    overrideWeek: { start: '2026-08-03', end: '2026-08-09' },
    today: new Date(),
  })
  const now = new Date()
  const cur = weekStats.find(w => now >= w.weekStart && now <= w.weekEnd) || weekStats[weekStats.length - 1]
  if (!cur) return null

  const mapRow = (s) => ({
    排名: s.排名,
    主播昵称: s.主播昵称,
    房间号: s.房间号,
    开播分区: s.开播分区,
    赛道: s.赛道,
    晋级状态: s.晋级状态,
    总流水: s.总流水,
    是否获奖: s.是否获奖,
  })

  const top3 = cur.list
    .filter(s => s.赛道 === '排位赛' && s.总流水 >= 2000)
    .sort((a, b) => b.总流水 - a.总流水)
    .slice(0, 3)
    .map(mapRow)

  const counts = { 晋级赛: 0, 排位赛: 0 }
  cur.list.forEach(s => { if (counts[s.赛道] !== undefined) counts[s.赛道]++ })

  // 数据真正的统计周期：来自参与本周榜单的真实记录，而非页面生成时刻
  const statTime = computeStatTime(enriched, cur.weekStart, cur.weekEnd)

  return {
    weekLabel: cur.label,
    weekStart: cur.weekStart,
    weekEnd: cur.weekEnd,
    generatedAt: new Date().toISOString(),
    statTime,
    dataGeneratedAt: computeDataGeneratedAt(),
    rows: cur.list.map(mapRow),
    top3,
    totals: {
      参赛人数: cur.list.length,
      达标人数: cur.达标人数,
      总流水: cur.总流水,
      晋级赛人数: counts.晋级赛,
      排位赛人数: counts.排位赛,
    },
  }
}
