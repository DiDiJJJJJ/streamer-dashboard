import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ROOT, log } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'
import { parseWorkbook, mergeRecords } from './parser.js'
import { upsertSnapshot, getSnapshot, normalizeMonth, deleteSnapshot } from './monthlySnapshot.js'
import { resolveOperator, normOperator } from './operatorAssignment.js'

// ---------------- 月度数据导入 ----------------
// 两种来源自动分流：
//   A. 按日明细（统计开始日期 == 统计结束日期）→ 合并进 latest.json，键 房间号::日期，幂等覆盖
//   B. 整月区间（开始 != 结束）              → 写入 monthly_snapshot.json，整月覆盖
// 分流原因：latest.json 是按日明细的权威源，区间记录混进去会被统计的 isRange() 去重规则跳过，
//          同时会污染前端看板（今日数据里冒出上月的区间行）。
//
// 边界场景处理：
//   1) 运营变更：按日明细 → 记录自带当日归属，天然支持；区间数据 → 先查归属关系表按生效日期覆盖，
//      查不到才用记录里的运营字段（此时整月流水归给一个人，会在 warnings 里提示）。
//   2) 7月在职、8月离职：统计不读 roster.status，只看有没有流水记录，因此离职不影响 7 月统计。
//   3) 7月在后台、之后不在：同上。但要注意别对历史月份执行「强制移除」，那会真的删记录。

const LATEST_FILE = path.join(DATA_DIR, 'latest.json')
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json')

export const SNAPSHOT_FIELDS = ['统计月份', '归属运营（快照）', '是否线下（快照）']

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    log('[monthImport] 读取失败 ' + path.basename(file) + ': ' + e.message)
  }
  return fallback
}

function readOfflineRooms(explicit) {
  if (Array.isArray(explicit) && explicit.length) return new Set(explicit.map(String))
  try {
    const roster = readJSON(ROSTER_FILE, {})
    return new Set((roster.offlineRooms || []).map(String))
  } catch {
    return new Set()
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 同步 latest.json 到 public/dist，保证前端能立刻读到 */
function syncDataset(records) {
  const payload = JSON.stringify(records, null, 2)
  atomicWriteSync(LATEST_FILE, payload)
  atomicWriteSync(path.join(ROOT, 'public', 'streamer_data.json'), payload)
  const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
  if (fs.existsSync(distFile)) atomicWriteSync(distFile, payload)
}

/**
 * 导入某月数据
 * @param {Object} opts
 * @param {string} opts.filePath   已存在于服务器上的 xlsx 路径（与 fileBase64 二选一）
 * @param {string} opts.fileBase64 xlsx 的 base64（前端上传）
 * @param {string} opts.month      目标月份 YYYY-MM（用于兜底与校验）
 * @param {string} [opts.statStart] 统计开始日期兜底 YYYY-MM-DD
 * @param {string} [opts.statEnd]   统计结束日期兜底 YYYY-MM-DD
 * @param {boolean} [opts.useAssignment=true] 是否用归属关系表覆盖运营
 * @param {string[]} [opts.offlineRooms] 线下名册（默认取 roster.json）
 * @param {boolean} [opts.dryRun=false] 只解析校验不落盘
 * @param {boolean|'auto'} [opts.markSeaMissing='auto'] 给记录打上「大航海数据缺失=是」
 *        （B站按日导出不含大航海字段，恒为 '-'；打标后统计页显示「无数据」而非 0，环比也不再显示 -100%）
 *        'auto' = 当解析出的记录数 >= 100 且大航海人数全为 0 时自动打标（0 视为该导出未含此字段）
 */
export function importMonth(opts = {}) {
  const {
    filePath, fileBase64, month,
    statStart = '', statEnd = '',
    useAssignment = true,
    offlineRooms, dryRun = false,
    markSeaMissing = 'auto',
    note = '',
  } = opts

  const targetMonth = normalizeMonth(month)
  if (!targetMonth) throw new Error('缺少或非法的 month 参数（应为 YYYY-MM）')

  // 1) 落临时文件后解析
  let tmp = null
  let fileLabel = filePath || 'upload.xlsx'
  try {
    if (fileBase64) {
      tmp = path.join(DATA_DIR, `month-import-${Date.now()}.xlsx`)
      fs.writeFileSync(tmp, Buffer.from(fileBase64, 'base64'))
      fileLabel = opts.fileName || 'upload.xlsx'
    } else if (filePath) {
      if (!fs.existsSync(filePath)) throw new Error('找不到文件：' + filePath)
      fileLabel = path.basename(filePath)
    } else {
      throw new Error('需要提供 filePath 或 fileBase64')
    }
    const src = tmp || filePath

    // 统计时间兜底：文件里没有「统计时间」列时用它；有的话以行内为准（支持一个文件含多天）
    let statTime = ''
    if (statStart && statEnd) statTime = `${statStart} ~ ${statEnd}`
    else if (statEnd) statTime = `${statEnd} ~ ${statEnd}`
    else if (statStart) statTime = `${statStart} ~ ${statStart}`

    const { records: raw, headerMap, sheetName, rawHeaders } = parseWorkbook(src, statTime)
    if (!raw.length) throw new Error('未解析到任何记录，请确认是 B站导出的主播数据表')

    // 大航海缺失自动判定：B站按日导出恒为 '-'（解析成 0），整份文件无一非零即视为该导出不含此字段
    const seaMissing = markSeaMissing === 'auto'
      ? (raw.length >= 100 && raw.every((r) => !(Number(r['大航海人数']) > 0)))
      : !!markSeaMissing
    if (seaMissing) log(`[monthImport] 检测到导出文件不含大航海字段（${raw.length} 条全为 0/'-'），将标记为「无数据」`)

    // 2) 逐条归因 + 快照固化
    const offlineSet = readOfflineRooms(offlineRooms)
    const warnings = []
    const errors = []
    let missingRoom = 0, missingDate = 0, missingOperator = 0, negativeFlow = 0, crossMonth = 0
    let assignmentApplied = 0, rangeCount = 0, dailyCount = 0

    const processed = []
    const seenDaily = new Map()   // 房间号::日期 -> index（按日去重，后者覆盖）
    const seenMonthly = new Map() // 房间号 -> index（整月去重，后者覆盖）

    raw.forEach((r, i) => {
      const room = String(r['房间号'] || r['主播id'] || '').trim()
      if (!room) { missingRoom++; errors.push(`第 ${i + 2} 行缺少房间号，已丢弃`); return }

      // 日期归因：行内统计时间优先，否则用参数兜底，再否则用目标月最后一天
      let start = String(r['统计开始日期'] || '').trim()
      let end = String(r['统计结束日期'] || r['统计日期'] || '').trim()
      if (!end) {
        if (statEnd) { end = statEnd; if (!start) start = statStart || statEnd }
        else {
          const [y, m] = targetMonth.split('-')
          const last = new Date(Number(y), Number(m), 0).getDate()
          end = `${targetMonth}-${String(last).padStart(2, '0')}`
          start = start || `${targetMonth}-01`
          missingDate++
        }
      }
      if (!start) start = end

      const recMonth = String(end).slice(0, 7)
      if (recMonth !== targetMonth) {
        crossMonth++
        if (crossMonth <= 5) warnings.push(`房间 ${room} 统计日期 ${start}~${end} 跨出目标月 ${targetMonth}，已按结束日期归入 ${recMonth}`)
      }

      // 运营归属：归属表（按生效日期）优先，回退记录自带字段
      let op = normOperator(r['运营经纪人']) || ''
      if (useAssignment) {
        const hit = resolveOperator(room, end)
        if (hit) { if (hit !== op) assignmentApplied++; op = hit }
      }
      if (!op) { op = '未分配'; missingOperator++ }

      const flow = num(r['总流水（元）'])
      if (flow < 0) { negativeFlow++; warnings.push(`房间 ${room} 流水为负（${flow}），已按原值保留`) }

      const isOffline = offlineSet.has(room)
      const out = {
        ...r,
        房间号: room,
        '统计开始日期': start,
        '统计结束日期': end,
        '统计日期': end,
        '统计月份': recMonth,
        '归属运营（快照）': op,
        '是否线下（快照）': isOffline ? '是' : '否',
        ...(seaMissing ? { '大航海数据缺失': '是' } : null),
      }

      const isRange = start && end && start !== end
      if (isRange) {
        rangeCount++
        const key = `${room}::${recMonth}`
        const prevIdx = seenMonthly.get(key)
        if (prevIdx !== undefined) processed[prevIdx] = out
        else { seenMonthly.set(key, processed.length); processed.push(out) }
      } else {
        dailyCount++
        const key = `${room}::${end}`
        const prevIdx = seenDaily.get(key)
        if (prevIdx !== undefined) {
          const old = processed[prevIdx]
          // 大航海为 0 时保留旧的非零值（byDate 导出常缺该字段，避免把已结算数据清零）
          if (!(Number(out['大航海人数']) > 0) && Number(old['大航海人数']) > 0) {
            out['大航海人数'] = old['大航海人数']
          }
          processed[prevIdx] = out
        } else { seenDaily.set(key, processed.length); processed.push(out) }
      }
    })

    if (!processed.length) throw new Error('解析结果为空（可能全部缺少房间号）')

    // 3) 分流落盘
    const mode = dailyCount > 0 && rangeCount === 0 ? 'daily' : (rangeCount > 0 && dailyCount === 0 ? 'range' : 'mixed')
    let dailyRecords = []
    let monthlyRecords = []
    if (mode === 'daily') dailyRecords = processed
    else if (mode === 'range') monthlyRecords = processed
    else {
      // 混合：按日部分进 latest，区间部分进快照（罕见，但保证不丢数据）
      dailyRecords = processed.filter(r => r['统计开始日期'] === r['统计结束日期'])
      monthlyRecords = processed.filter(r => r['统计开始日期'] !== r['统计结束日期'])
      warnings.push(`文件同时含按日与区间记录：按日 ${dailyRecords.length} 条进明细，区间 ${monthlyRecords.length} 条进月快照`)
    }

    // 源文件合计：按每条记录的「实际归属月份」分组统计，作为对账基准（未经任何统计规则过滤）
    const sourceTotalsByMonth = {}
    for (const [m, recs] of (() => {
      const g = new Map()
      for (const r of processed) {
        const k = String(r['统计月份'] || targetMonth)
        if (!g.has(k)) g.set(k, [])
        g.get(k).push(r)
      }
      return g
    })()) {
      const st = { totalFlow: 0, byOperator: {}, recordCount: recs.length, roomCount: new Set(recs.map(r => r['房间号'])).size }
      for (const r of recs) {
        const f = num(r['总流水（元）'])
        st.totalFlow += f
        const op = r['归属运营（快照）'] || '未分配'
        st.byOperator[op] = (st.byOperator[op] || 0) + f
      }
      st.totalFlow = Math.round(st.totalFlow * 100) / 100
      for (const k of Object.keys(st.byOperator)) st.byOperator[k] = Math.round(st.byOperator[k] * 100) / 100
      sourceTotalsByMonth[m] = st
    }
    const sourceTotals = sourceTotalsByMonth[targetMonth] || { totalFlow: 0, byOperator: {}, recordCount: 0, roomCount: 0 }

    if (dryRun) {
      return {
        ok: true, dryRun: true, month: targetMonth, mode, file: fileLabel, sheetName,
        count: processed.length, dailyCount, rangeCount,
        headerMap, rawHeaders, sourceTotals, sourceTotalsByMonth,
        warnings: warnings.slice(0, 30),
        errors: errors.slice(0, 30),
        stats: { missingRoom, missingDate, missingOperator, negativeFlow, crossMonth, assignmentApplied, seaMissing },
      }
    }

    if (dailyRecords.length) {
      const base = readJSON(LATEST_FILE, [])
      const merged = mergeRecords(base, dailyRecords)
      syncDataset(merged)
      log(`[monthImport] ${targetMonth} 按日明细合并：${dailyRecords.length} 条，latest 共 ${merged.length} 条`)
    }

    // 区间记录按「各自归属月份」分别写快照：
    // 这样跨月记录（如 7/20~8/05）会进 8 月快照而不是 7 月，既不会丢数据，也不会被错记到目标月。
    const monthlyByMonth = new Map()
    for (const r of processed) {
      if (r['统计开始日期'] === r['统计结束日期']) continue
      const m = String(r['统计月份'] || targetMonth)
      if (!monthlyByMonth.has(m)) monthlyByMonth.set(m, [])
      monthlyByMonth.get(m).push(r)
    }
    const snapshots = []
    for (const [m, recs] of monthlyByMonth) {
      snapshots.push(upsertSnapshot(m, recs, {
        source: 'range-import',
        file: fileLabel,
        range: [statStart || recs[0]?.['统计开始日期'] || '', statEnd || recs[0]?.['统计结束日期'] || ''],
        sourceTotals: sourceTotalsByMonth[m],
        note,
      }))
    }

    return {
      ok: true,
      month: targetMonth,
      mode,
      file: fileLabel,
      sheetName,
      count: processed.length,
      dailyCount,
      rangeCount,
      latestTotal: dailyRecords.length ? readJSON(LATEST_FILE, []).length : undefined,
      snapshot: snapshots.find(s => s.month === targetMonth) || null,
      snapshots,
      sourceTotals,
      sourceTotalsByMonth,
      warnings: warnings.slice(0, 30),
      errors: errors.slice(0, 30),
      stats: { missingRoom, missingDate, missingOperator, negativeFlow, crossMonth, assignmentApplied, seaMissing },
    }
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }
  }
}

/**
 * 校验：某月在「系统内」的流水合计 vs「源导入」合计 vs「明细逐条求和」是否一致
 * 三个口径应当完全相等，任何差异都说明有记录被统计规则悄悄跳过或归属错了运营。
 */
export function verifyMonth(month) {
  const m = normalizeMonth(month)
  if (!m) throw new Error('month 非法，应为 YYYY-MM')

  const latest = readJSON(LATEST_FILE, [])
  const snap = getSnapshot(m)

  // 明细：按日（来自 latest）+ 快照（来自 monthly_snapshot）
  const daily = latest.filter(r => String(r['统计结束日期'] || r['统计日期'] || '').slice(0, 7) === m
    && !(r['统计开始日期'] && r['统计结束日期'] && r['统计开始日期'] !== r['统计结束日期']))
  const snapRecords = Array.isArray(snap?.records) ? snap.records : []

  const detail = [...daily, ...snapRecords]
  const byOperator = {}
  let total = 0
  const roomSet = new Set()
  for (const r of detail) {
    const f = num(r['总流水（元）'])
    const op = r['归属运营（快照）'] || normOperator(r['运营经纪人']) || '未分配'
    byOperator[op] = (byOperator[op] || 0) + f
    total += f
    if (r['房间号']) roomSet.add(String(r['房间号']))
  }
  total = Math.round(total * 100) / 100
  for (const k of Object.keys(byOperator)) byOperator[k] = Math.round(byOperator[k] * 100) / 100

  // 源导入基准
  const src = snap?.sourceTotals || null
  const checks = []
  checks.push({
    name: '明细记录数',
    value: detail.length,
    expect: src?.recordCount ?? detail.length,
    ok: src ? detail.length === src.recordCount : true,
    note: src ? `源导入 ${src.recordCount} 条` : '无源导入基准（按日明细模式）',
  })
  checks.push({
    name: '流水合计',
    value: total,
    expect: src ? src.totalFlow : total,
    ok: src ? Math.abs(total - src.totalFlow) < 0.01 : true,
    note: src ? `源导入 ¥${src.totalFlow}` : '无源导入基准',
  })
  if (src) {
    for (const op of Object.keys(src.byOperator)) {
      const v = byOperator[op] || 0
      checks.push({
        name: `运营「${op}」流水`,
        value: v,
        expect: src.byOperator[op],
        ok: Math.abs(v - src.byOperator[op]) < 0.01,
        note: '',
      })
    }
  }

  return {
    ok: checks.every(c => c.ok),
    month: m,
    source: snap ? 'snapshot' : (daily.length ? 'daily' : 'none'),
    recordCount: detail.length,
    dailyCount: daily.length,
    snapshotCount: snapRecords.length,
    roomCount: roomSet.size,
    totalFlow: total,
    byOperator,
    checks,
    snapshotMeta: snap ? {
      source: snap.source, file: snap.file, importedAt: snap.importedAt,
      range: snap.range, prevRecordCount: snap.prevRecordCount,
    } : null,
  }
}

/** 删除某月数据（快照 + latest 中的该月按日记录） */
export function purgeMonth(month, { includeDaily = false } = {}) {
  const m = normalizeMonth(month)
  if (!m) throw new Error('month 非法，应为 YYYY-MM')
  const res = { month: m, snapshot: deleteSnapshot(m), latestRemoved: 0 }
  if (includeDaily) {
    const base = readJSON(LATEST_FILE, [])
    const kept = base.filter(r => String(r['统计结束日期'] || r['统计日期'] || '').slice(0, 7) !== m)
    res.latestRemoved = base.length - kept.length
    if (res.latestRemoved) syncDataset(kept)
  }
  log(`[monthImport] 清除 ${m}：快照 ${res.snapshot.deleted ? '已删' : '无'}，按日记录 ${res.latestRemoved} 条`)
  return res
}
