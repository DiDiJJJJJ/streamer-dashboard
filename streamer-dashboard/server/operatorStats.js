import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, config, log } from './config.js'
import { listMonths as listSnapshotMonths, getSnapshotRecords } from './monthlySnapshot.js'

// ---------------- 运营月度数据统计与分析 ----------------
// 数据源：
//   - latest.json：按 房间号::统计日期 累积的每日抓取快照（权威数据源）
//   - union_recruit_archive.json：入会招募归档（含 date / operator / room / status）
//   - roster.json：线下主播房间号清单（用于区分线上 / 线下）
// 维度：每个运营 × 每个自然月 的完整统计，核心指标含线上线下总流水、线下总流水、
//       入会数（区分线上/线下），并补充开播天数、开播时长、大航海、付费人数、客单价、
//       日均流水等；自动计算环比（MoM）与「主要变化」标注，辅助运营复盘。

const LATEST_FILE = path.join(DATA_DIR, 'latest.json')
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json')
const ARCHIVE_FILE = path.join(DATA_DIR, 'union_recruit_archive.json')
const SNAPSHOT_FILE = path.join(DATA_DIR, 'monthly_snapshot.json')
const ASSIGN_FILE = path.join(DATA_DIR, 'operator_assignment.json')

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    log('[operatorStats] 读取失败 ' + path.basename(file) + ': ' + e.message)
  }
  return fallback
}

function parseOperator(raw) {
  const s = String(raw || '').trim()
  if (!s) return '未分配'
  const t = s.replace(/^运营经纪人[：:\s]+/i, '').replace(/^经纪人[：:\s]+/i, '').trim()
  return t.split('|')[0].trim() || '未分配'
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function daysOfMonth(m) {
  const [y, mm] = m.split('-').map(Number)
  if (!y || !mm) return 30
  return new Date(y, mm, 0).getDate()
}
/** 环比增长率（百分比数值，如 +12.5 表示 +12.5%） */
function momPct(to, from) {
  from = Number(from) || 0
  to = Number(to) || 0
  if (from === 0) return to > 0 ? 100 : 0
  return round2(((to - from) / from) * 100)
}
/** 是否为区间（连续多日）快照：start != end。区间总流水与每日快照重叠，求和会重复计算，故聚合时排除 */
function isRange(r) {
  const s = r['统计开始日期'] || ''
  const e = r['统计结束日期'] || r['统计日期'] || ''
  return !!s && !!e && s !== e
}
function monthOf(r) {
  const d = r['统计结束日期'] || r['统计日期'] || ''
  const m = String(d || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(m) ? m : ''
}

// 缓存：数据源 mtime 变化才重算（月度快照、归属关系表也要纳入，否则导入后页面看不到新月份）
let _cache = { key: null, data: null }
function cacheKey() {
  const m = (f) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }
  return [m(LATEST_FILE), m(ROSTER_FILE), m(ARCHIVE_FILE), m(SNAPSHOT_FILE), m(ASSIGN_FILE)].join('|')
}

export function aggregateOperatorMonthlyStats({ force = false } = {}) {
  const key = cacheKey()
  if (!force && _cache.key === key && _cache.data) return _cache.data

  const latest = readJSON(LATEST_FILE, [])
  const offlineRooms = readOfflineRooms()
  const archive = readJSON(ARCHIVE_FILE, { version: 2, records: [] })

  // 1) 流水 / 开播指标：按 运营 + 月 聚合
  //    双通道数据源：
  //      A. latest.json 的按日明细（排除区间快照，避免与每日数据重复计数）
  //      B. monthly_snapshot.json 的整月快照 —— 只用于「该月完全没有按日明细」的历史月份
  //         （例如导入的 2026-07 整月区间数据）。同一月份两者不会同时生效，因此不会重复累加。
  const flow = {}
  const monthsSet = new Set()
  const monthSource = {}          // 月份 -> 'daily' | 'snapshot' | 'mixed'
  const monthsWithDaily = new Set()
  const monthDailyRooms = {}      // 月份 -> Set(房间号)，用于混合模式去重
  const mixedDetail = {}          // 月份 -> { dailyRooms, fromSnapshot }
  // 大航海「无数据」标记：B站按日导出不含该字段（恒为 '-'），导入时打上 大航海数据缺失='是'。
  // 某月全部记录都被标记 → 该月大航海视为「无数据」而非真 0，避免环比显示 -100% 被误读为暴跌。
  const monthSeaStat = {}         // 月份 -> { total, missing }

  function bucketOf(op, m) {
    if (!flow[op]) flow[op] = {}
    if (!flow[op][m]) {
      flow[op][m] = { totalFlow: 0, offlineFlow: 0, onlineFlow: 0, broadcastHours: 0, seaCount: 0, payCount: 0, openDays: 0, rooms: new Set(), payingRooms: new Set() }
    }
    return flow[op][m]
  }

  /**
   * 大航海统计口径：取「当月最后一天（最新一天）」的时点快照，不跨日累加。
   * 逐日抓取时 大航海人数 是每日的时点值（某天有多少舰长/提督），跨日求和会变成
   * 「人数 × 天数」的伪指标；与「主播数据」页 SNAPSHOT_FIELDS（取最新一天、不跨日求和）
   * 保持同一口径。因此每个房间只取其在当月「统计结束日期」最大那一行的 大航海人数，再按运营求和。
   * 实现：accumulate 里只记录每房间每月的「最后一天快照」，循环结束后再按运营求和（见下方 Post）。
   */
  const roomSeaLast = {} // 房间号 -> { 月份: { date, sea, op } }

  /**
   * 归属与线下判定优先读「导入时固化的快照字段」，读不到才回退实时口径：
   *   - 归属运营（快照）：解决主播在月内/跨月换运营后，历史月份被算给新运营的问题
   *   - 是否线下（快照）：解决 7 月在职、8 月离职被移出线下名册后，7 月流水被算成线上的问题
   */
  function accumulate(r, m) {
    const op = String(r['归属运营（快照）'] || '').trim() || parseOperator(r['运营经纪人'])
    const a = bucketOf(op, m)
    const room = String(r['房间号'] || '').trim()
    const offlineFlag = String(r['是否线下（快照）'] || '').trim()
    const isOffline = offlineFlag ? offlineFlag === '是' : !!(room && offlineRooms.has(room))
    const f = Number(r['总流水（元）']) || 0
    a.totalFlow += f
    if (isOffline) a.offlineFlow += f
    else a.onlineFlow += f
    a.broadcastHours += Number(r['开播时长（小时）']) || 0
    // 大航海：遗漏的记录（B站按日导出不含该字段，已标记缺失）不参与「最后一天快照」统计
    const seaMissing = String(r['大航海数据缺失'] || '').trim() === '是'
    const seaStat = monthSeaStat[m] || (monthSeaStat[m] = { total: 0, missing: 0 })
    seaStat.total++
    if (seaMissing) seaStat.missing++
    const pay = Number(r['付费人数']) || 0
    a.payCount += pay
    a.openDays += Number(r['开播天数']) || 0
    if (room) {
      a.rooms.add(room)
      if (f > 0) a.payingRooms.add(room)
    }
    // 大航海最后一天快照：仅对未标记缺失、有房间号的记录生效
    if (room && !seaMissing) {
      const d = String(r['统计结束日期'] || r['统计日期'] || '').slice(0, 10)
      const sea = Number(r['大航海人数']) || 0
      const mm = (roomSeaLast[room] || (roomSeaLast[room] = {}))
      const cur = mm[m]
      if (!cur || d > cur.date) mm[m] = { date: d, sea, op }
    }
  }

  // 1A) 按日明细
  for (const r of latest) {
    if (isRange(r)) continue
    const m = monthOf(r)
    if (!m) continue
    monthsSet.add(m)
    monthsWithDaily.add(m)
    monthSource[m] = 'daily'
    const room = String(r['房间号'] || '').trim()
    if (room) {
      if (!monthDailyRooms[m]) monthDailyRooms[m] = new Set()
      monthDailyRooms[m].add(room)
    }
    accumulate(r, m)
  }

  // 1B) 整月快照
  //   情形一：该月完全没有按日明细（如只导入了 7 月整月区间数据）→ 整月用快照。
  //   情形二：该月已有部分按日明细（如又补抓了几天）→ 按日明细优先，
  //           快照里「未被按日覆盖的房间」补进来。按房间去重，所以不会重复计数、也不会漏房间。
  for (const sm of listSnapshotMonths()) {
    monthsSet.add(sm)
    const snapRecs = getSnapshotRecords(sm)
    const monthOfSnap = (r) => String(r['统计月份'] || monthOf(r) || sm).slice(0, 7)

    if (!monthsWithDaily.has(sm)) {
      monthSource[sm] = 'snapshot'
      for (const r of snapRecs) {
        if (monthOfSnap(r) !== sm) continue
        accumulate(r, sm)
      }
      continue
    }

    const dailyRooms = monthDailyRooms[sm] || new Set()
    let added = 0
    for (const r of snapRecs) {
      if (monthOfSnap(r) !== sm) continue
      const room = String(r['房间号'] || '').trim()
      if (room && dailyRooms.has(room)) continue
      accumulate(r, sm)
      added++
    }
    if (added) {
      monthSource[sm] = 'mixed'
      mixedDetail[sm] = { dailyRooms: dailyRooms.size, fromSnapshot: added }
    }
  }

  // 大航海 Post：把每个房间「当月最后一天」的快照值按运营求和（不跨日累加）
  // 注意：roomSeaLast 仅由未标记缺失的按日明细记录填充；整月区间快照（大航海恒缺失）不会进入，
  // 这类月份由 seaMissingMonths 统一标记为「无数据」，不参与求和。
  for (const room of Object.keys(roomSeaLast)) {
    for (const m of Object.keys(roomSeaLast[room])) {
      const { sea, op } = roomSeaLast[room][m]
      bucketOf(op, m).seaCount += sea
    }
  }

  // 2) 入会数：按 运营 + 月 + 线上/线下 聚合
  const joined = {}
  const joinedStatus = new Set(config.selectors.statusJoined || ['已入会'])
  for (const rec of (archive.records || [])) {
    if (!joinedStatus.has(rec.status)) continue
    const m = String(rec.date || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(m)) continue
    const op = rec.operator || '未分配'
    monthsSet.add(m)
    if (!joined[op]) joined[op] = {}
    if (!joined[op][m]) joined[op][m] = { online: 0, offline: 0, unknown: 0, total: 0 }
    const bucket = rec.room ? (offlineRooms.has(rec.room) ? 'offline' : 'online') : 'unknown'
    joined[op][m][bucket] += 1
    joined[op][m].total += 1
  }

  // 3) 组装逐行数据（每个 运营 × 月 一行）
  const operators = new Set([...Object.keys(flow), ...Object.keys(joined)])
  const months = [...monthsSet].sort() // 升序
  // 该月所有记录都标记为「大航海数据缺失」→ 视为无数据（不是真 0）
  const seaMissingMonths = months.filter((m) => {
    const s = monthSeaStat[m]
    return s && s.total > 0 && s.missing === s.total
  })
  const isSeaMissing = (m) => seaMissingMonths.includes(m)
  const rows = []
  const byOperator = {}
  for (const op of operators) {
    byOperator[op] = {}
    for (const m of months) {
      const a = flow[op]?.[m]
      const j = joined[op]?.[m]
      const roomCount = a ? a.rooms.size : 0
      const payingRoomCount = a ? a.payingRooms.size : 0
      const totalFlow = a ? a.totalFlow : 0
      const offlineFlow = a ? a.offlineFlow : 0
      const onlineFlow = a ? a.onlineFlow : 0
      const payCount = a ? a.payCount : 0
      const dailyAvg = daysOfMonth(m) > 0 ? totalFlow / daysOfMonth(m) : 0 // 日均流水
      const row = {
        operator: op,
        month: m,
        totalFlow: round2(totalFlow),
        offlineFlow: round2(offlineFlow),
        onlineFlow: round2(onlineFlow),
        roomCount,
        payingRoomCount,
        openDays: a ? a.openDays : 0,
        broadcastHours: round2(a ? a.broadcastHours : 0),
        seaCount: a ? a.seaCount : 0,
        payCount,
        dailyAvg: round2(dailyAvg),
        joined: j ? j.total : 0,
        joinedOnline: j ? j.online : 0,
        joinedOffline: j ? j.offline : 0,
        joinedUnknown: j ? j.unknown : 0,
      }
      rows.push(row)
      byOperator[op][m] = row
    }
  }

  // 4) 环比（MoM）：每月相对上一月
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1]
    for (const op of operators) {
      const cur = byOperator[op]?.[months[i]]
      const pre = byOperator[op]?.[prev]
      if (!cur) continue
      cur.mom = {
        totalFlow: momPct(cur.totalFlow, pre?.totalFlow),
        offlineFlow: momPct(cur.offlineFlow, pre?.offlineFlow),
        onlineFlow: momPct(cur.onlineFlow, pre?.onlineFlow),
        joined: momPct(cur.joined, pre?.joined),
        joinedOnline: momPct(cur.joinedOnline, pre?.joinedOnline),
        joinedOffline: momPct(cur.joinedOffline, pre?.joinedOffline),
        // 任一侧为「无数据」时不做大航海环比，避免把缺失显示成 -100% 暴跌
        seaCount: (isSeaMissing(months[i]) || isSeaMissing(prev)) ? null : momPct(cur.seaCount, pre?.seaCount),
        payCount: momPct(cur.payCount, pre?.payCount),
        broadcastHours: momPct(cur.broadcastHours, pre?.broadcastHours),
        roomCount: momPct(cur.roomCount, pre?.roomCount),
      }
    }
  }

  // 5) 主要变化标注：最新月 vs 上一月，列出波动最大的数据项
  const latestMonth = months[months.length - 1] || null
  const prevMonth = months[months.length - 2] || null
  const changes = []
  if (latestMonth && prevMonth) {
    const metrics = [
      ['totalFlow', '线上线下总流水'], ['offlineFlow', '线下总流水'], ['onlineFlow', '线上总流水'],
      ['joined', '入会数'], ['joinedOnline', '线上入会'], ['joinedOffline', '线下入会'],
      ['seaCount', '大航海人数'], ['payCount', '付费人数'], ['broadcastHours', '开播时长(小时)'],
      ['roomCount', '主播数'], ['openDays', '开播天数'],
    ]
    for (const op of operators) {
      const cur = byOperator[op]?.[latestMonth]
      const pre = byOperator[op]?.[prevMonth]
      if (!cur || !pre) continue
      for (const [key, label] of metrics) {
        // 大航海缺数据的月份不参与「主要变化」排名，否则会被当成断崖式下跌
        if (key === 'seaCount' && (isSeaMissing(latestMonth) || isSeaMissing(prevMonth))) continue
        const from = pre[key] || 0
        const to = cur[key] || 0
        if (from === 0 && to === 0) continue
        const delta = to - from
        changes.push({
          operator: op,
          month: latestMonth,
          prevMonth,
          metric: key,
          label,
          from: round2(from),
          to: round2(to),
          delta: round2(delta),
          pct: momPct(to, from),
          absDelta: Math.abs(delta),
        })
      }
    }
    changes.sort((a, b) => b.absDelta - a.absDelta)
  }

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    currentMonth,
    months,            // 升序
    monthSource,       // 月份 -> 'daily'(按日明细) | 'snapshot'(整月快照) | 'mixed'(明细+快照补房间)
    mixedDetail,       // 混合月份的去重详情 { 月份: { dailyRooms, fromSnapshot } }
    seaMissingMonths,  // 大航海「无数据」的月份（B站按日导出不含该字段），展示为「无数据」而非 0
    operators: [...operators].sort(),
    rows,
    byOperator,
    latestMonth,
    prevMonth,
    changes: changes.slice(0, 80),
    monthCount: months.length,
    operatorCount: operators.size,
  }
  _cache = { key, data }
  return data
}

/** 取单个运营全月明细（供前端按需展示） */
export function getOperatorMonthly(operator) {
  const data = aggregateOperatorMonthlyStats()
  return {
    ok: true,
    operator,
    months: data.months,
    rows: data.rows.filter(r => r.operator === operator),
  }
}

/**
 * 单运营 × 两月的主播级（房间号）环比拆解。
 * 用于【运营月度统计】对比页：当用户锁定单个运营并对比两个月份时，
 * 自动筛出「环比变化幅度 > 阈值(默认20%)」的具体主播，便于快速定位波动来源。
 * 口径与 aggregateOperatorMonthlyStats 完全一致：
 *   - 归属运营（快照）优先，回退 parseOperator(运营经纪人)
 *   - 是否线下（快照）优先，回退 房间号∈线下名册
 *   - 大航海取当月最后一天时点值（不跨日累加）；整月缺数据月份标记「无数据」不参与环比
 *   - 双源：该月有按日明细用按日；无则用整月快照；混合时按房间去重补未覆盖房间
 * 返回：rooms（所有参与对比的房间号）、changes（>阈值 的扁平变化项，按 |pct| 降序）、
 *       byRoom（按房间号归并的 changes，供前端直接渲染）。
 */
export function getOperatorStreamerCompare(operator, monthA, monthB, threshold = 10) {
  operator = String(operator || '').trim()
  monthA = String(monthA || '').trim()
  monthB = String(monthB || '').trim()
  if (!operator || !monthA || !monthB) {
    return { ok: false, error: '缺少 operator / monthA / monthB 参数' }
  }

  const latest = readJSON(LATEST_FILE, [])
  const offlineRooms = readOfflineRooms()
  const archive = readJSON(ARCHIVE_FILE, { version: 2, records: [] })
  const joinedStatus = new Set(config.selectors.statusJoined || ['已入会'])
  const main = aggregateOperatorMonthlyStats() // 缓存命中；取 seaMissingMonths 保持口径一致
  const roster = readJSON(ROSTER_FILE, {})
  const seaMissingMonths = main.seaMissingMonths || []

  const recOp = (r) => String(r['归属运营（快照）'] || '').trim() || parseOperator(r['运营经纪人'])
  const recOffline = (r) => {
    const off = String(r['是否线下（快照）'] || '').trim()
    const room = String(r['房间号'] || '').trim()
    return off ? off === '是' : !!(room && offlineRooms.has(room))
  }

  const monthsWithDaily = new Set(latest.filter(r => !isRange(r)).map(r => monthOf(r)).filter(Boolean))
  const snapMonths = new Set(listSnapshotMonths())
  const targetMonths = [monthA, monthB]

  const roomAgg = {} // month -> Map(room -> bucket)
  for (const m of targetMonths) {
    const map = new Map()
    if (monthsWithDaily.has(m)) {
      for (const r of latest) {
        if (isRange(r)) continue
        if (monthOf(r) !== m) continue
        if (recOp(r) !== operator) continue
        const room = String(r['房间号'] || '').trim()
        if (!room) continue
        let b = map.get(room)
        if (!b) { b = { room, totalFlow: 0, offlineFlow: 0, onlineFlow: 0, broadcastHours: 0, payCount: 0, openDays: 0, seaDate: '', seaCount: 0 }; map.set(room, b) }
        const f = Number(r['总流水（元）']) || 0
        b.totalFlow += f
        if (recOffline(r)) b.offlineFlow += f; else b.onlineFlow += f
        b.broadcastHours += Number(r['开播时长（小时）']) || 0
        b.payCount += Number(r['付费人数']) || 0
        b.openDays += Number(r['开播天数']) || 0
        const seaMissing = String(r['大航海数据缺失'] || '').trim() === '是'
        if (!seaMissing) {
          const d = String(r['统计结束日期'] || r['统计日期'] || '').slice(0, 10)
          const sea = Number(r['大航海人数']) || 0
          if (d > b.seaDate) { b.seaDate = d; b.seaCount = sea }
        }
      }
    }

    if (snapMonths.has(m)) {
      const snapRecs = getSnapshotRecords(m)
      const dailyRooms = new Set([...map.keys()])
      for (const r of snapRecs) {
        if (String(r['统计月份'] || monthOf(r) || m).slice(0, 7) !== m) continue
        if (recOp(r) !== operator) continue
        const room = String(r['房间号'] || '').trim()
        if (!room) continue
        if (monthsWithDaily.has(m) && dailyRooms.has(room)) continue // 已有按日明细，不重复
        let b = map.get(room)
        if (!b) { b = { room, totalFlow: 0, offlineFlow: 0, onlineFlow: 0, broadcastHours: 0, payCount: 0, openDays: 0, seaDate: '', seaCount: 0 }; map.set(room, b) }
        const f = Number(r['总流水（元）']) || 0
        b.totalFlow += f
        if (recOffline(r)) b.offlineFlow += f; else b.onlineFlow += f
        b.broadcastHours += Number(r['开播时长（小时）']) || 0
        b.payCount += Number(r['付费人数']) || 0
        b.openDays += Number(r['开播天数']) || 0
        // 整月快照的大航海恒缺失，由上方的 seaMissingMonths 统一控制，此处不写 seaCount
      }
    }

    roomAgg[m] = map
  }

  // 入会数：按 房间 × 月 聚合（与 operator 级同源）
  const joinedByMonth = {} // month -> Map(room -> {online, offline, total})
  for (const rec of (archive.records || [])) {
    if (!joinedStatus.has(rec.status)) continue
    const m = String(rec.date || '').slice(0, 7)
    if (!targetMonths.includes(m)) continue
    if ((rec.operator || '未分配') !== operator) continue
    const room = String(rec.room || '').trim()
    if (!room) continue
    if (!joinedByMonth[m]) joinedByMonth[m] = new Map()
    let b = joinedByMonth[m].get(room)
    if (!b) { b = { online: 0, offline: 0, unknown: 0, total: 0 }; joinedByMonth[m].set(room, b) }
    const bucket = offlineRooms.has(room) ? 'offline' : 'online'
    b[bucket] += 1; b.total += 1
  }

  const roomVal = (bucket, key, month, joinedMap, room) => {
    if (key === 'joined') return joinedMap?.get(room)?.total || 0
    if (key === 'joinedOnline') return joinedMap?.get(room)?.online || 0
    if (key === 'joinedOffline') return joinedMap?.get(room)?.offline || 0
    if (key === 'dailyAvg') return bucket ? round2(bucket.totalFlow / daysOfMonth(month)) : 0
    return bucket ? (Number(bucket[key]) || 0) : 0
  }

  // 波动主播清单仅统计并展示三项指标：总流水 / 开播时长 / 开播天数
  const METRICS = [
    ['totalFlow', '总流水'],
    ['broadcastHours', '开播时长'],
    ['openDays', '开播天数'],
  ]

  const roomsSet = new Set([
    ...(roomAgg[monthA] ? roomAgg[monthA].keys() : []),
    ...(roomAgg[monthB] ? roomAgg[monthB].keys() : []),
  ])

  let byRoom = {}
  const changes = []
  for (const room of roomsSet) {
    const a = roomAgg[monthA]?.get(room)
    const b = roomAgg[monthB]?.get(room)
    if (!a && !b) continue
    const itemChanges = []
    for (const [key, label] of METRICS) {
      // 大航海：任一侧月份为「无数据」时跳过，避免把缺失误读为暴跌
      if (key === 'seaCount' && (seaMissingMonths.includes(monthA) || seaMissingMonths.includes(monthB))) continue
      const va = roomVal(a, key, monthA, joinedByMonth[monthA], room)
      const vb = roomVal(b, key, monthB, joinedByMonth[monthB], room)
      if (va === 0 && vb === 0) continue
      const pct = momPct(va, vb)
      if (Math.abs(pct) > threshold) {
        const change = {
          metricKey: key,
          metricLabel: label,
          from: round2(vb), // 旧月（monthB）值
          to: round2(va),   // 新月（monthA）值；pct 已为 (新月-旧月)/旧月，方向一致
          delta: round2(va - vb),
          pct,
          direction: pct > 0 ? 'up' : 'down',
        }
        itemChanges.push(change)
        changes.push({ room, ...change })
      }
    }
    if (itemChanges.length) byRoom[room] = itemChanges
  }

  changes.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct))

  // 仅保留三项指标均超过门槛的主播：总流水>1000、开播时长>15h、开播天数>3天（以基准月 monthB 为准）
  const KEEP_FLOW = 1000, KEEP_HOURS = 15, KEEP_DAYS = 3
  for (const room of Object.keys(byRoom)) {
    const b = roomAgg[monthB] && roomAgg[monthB].get(room)
    if (!b || !(b.totalFlow > KEEP_FLOW && b.broadcastHours > KEEP_HOURS && b.openDays > KEEP_DAYS)) {
      delete byRoom[room]
    }
  }
  // 主播列表按【总流水】浮动幅度（|环比|）从大到小降序排列：总流水为首要权重，其余维度依次其后
  const tfScores = {}
  for (const room of Object.keys(byRoom)) {
    const it = byRoom[room] && byRoom[room].find((c) => c.metricKey === 'totalFlow')
    tfScores[room] = it ? Math.abs(it.pct) : -1
  }
  const sortedRooms = Object.keys(byRoom).sort((x, y) => tfScores[y] - tfScores[x])
  const sortedByRoom = {}
  for (const room of sortedRooms) sortedByRoom[room] = byRoom[room]
  byRoom = sortedByRoom
  const filteredChanges = []
  for (const room of sortedRooms) {
    for (const ch of byRoom[room]) filteredChanges.push({ room, ...ch })
  }

  // 房间号 -> 用工状态（线上 / 线下在职 / 线下离职）
  const empStatusMap = {}
  for (const room of roomsSet) {
    const st = (roster.status && roster.status[String(room)]) || {}
    if (!offlineRooms.has(String(room))) empStatusMap[room] = '线上'
    else empStatusMap[room] = st.status === '离职' ? '线下离职' : '线下在职'
  }

  // 房间号 -> 主播昵称（用于波动主播清单展示昵称）；按日明细优先，整月快照兜底
  const nickMap = {}
  for (const r of latest) {
    const room = String(r['房间号'] || '').trim()
    if (room && r['主播昵称'] && !nickMap[room]) nickMap[room] = r['主播昵称']
  }
  for (const m of targetMonths) {
    if (snapMonths.has(m)) {
      for (const r of getSnapshotRecords(m)) {
        const room = String(r['房间号'] || '').trim()
        if (room && r['主播昵称'] && !nickMap[room]) nickMap[room] = r['主播昵称']
      }
    }
  }

  return {
    ok: true,
    operator,
    monthA,
    monthB,
    threshold,
    seaMissingA: seaMissingMonths.includes(monthA),
    seaMissingB: seaMissingMonths.includes(monthB),
    roomCount: roomsSet.size,
    changedRoomCount: Object.keys(byRoom).length,
    // 按房间号汇总的总流水（用于与 operator-level 合计对账，应完全一致）
    sumByMonth: {
      [monthA]: [...(roomAgg[monthA]?.values() || [])].reduce((s, b) => s + b.totalFlow, 0),
      [monthB]: [...(roomAgg[monthB]?.values() || [])].reduce((s, b) => s + b.totalFlow, 0),
    },
    rooms: [...roomsSet],
    changes: filteredChanges,
    // 主播列表顺序：按【总流水】浮动幅度（|环比|）从大到小降序（总流水为首要权重）
    roomOrder: sortedRooms,
    byRoom,
    nickMap,
    empStatusMap,
  }
}
