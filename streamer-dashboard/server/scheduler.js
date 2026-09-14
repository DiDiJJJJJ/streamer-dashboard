import { config, log } from './config.js'

/**
 * 定时任务补跑（catch-up）
 *
 * 场景：服务器因关机 / 崩溃 / 手动停止而没有运行，导致 cron 计划时刻（例如每日 13:00
 * 的【昨日】抓取）被错过。node-cron 不会为"进程不在时"的时刻补触发，所以需要在服务
 * 启动时主动回溯：上一次本应触发的时刻是什么时候？那之后有没有成功抓过？没有就立即补跑。
 */

const formatterCache = new Map()

function getFormatter(timeZone) {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** 取某个时刻在指定时区下的 年/月/日/时/分/星期 */
function zonedParts(date, timeZone) {
  const parts = {}
  for (const p of getFormatter(timeZone).formatToParts(date)) parts[p.type] = p.value
  const hour = Number(parts.hour)
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // 部分环境 hour12:false 会把午夜输出成 24
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  }
}

/** 单个 cron 字段是否匹配当前值，支持 `*` `a` `a-b` `*​/n` `a-b/n` 以及逗号列表 */
function fieldMatches(field, value) {
  if (field === '*') return true
  for (const part of String(field).split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isFinite(step) || step <= 0) continue

    if (range === '*') {
      if (value % step === 0) return true
      continue
    }
    if (range.includes('-')) {
      const [lo, hi] = range.split('-').map(Number)
      if (Number.isNaN(lo) || Number.isNaN(hi)) continue
      if (value >= lo && value <= hi && (value - lo) % step === 0) return true
      continue
    }
    const n = Number(range)
    if (!Number.isNaN(n) && n === value) return true
  }
  return false
}

/** 判断某个时刻是否命中 cron 表达式（按指定时区解释） */
export function cronMatches(expr, date, timeZone = config.timezone) {
  const fields = String(expr || '').trim().split(/\s+/)
  if (fields.length !== 5) return false
  const p = zonedParts(date, timeZone)
  return (
    fieldMatches(fields[0], p.minute) &&
    fieldMatches(fields[1], p.hour) &&
    fieldMatches(fields[2], p.day) &&
    fieldMatches(fields[3], p.month) &&
    fieldMatches(fields[4], p.weekday)
  )
}

/**
 * 从 `from` 往回找「上一次本应触发」的时刻（逐分钟回溯）
 * @returns {Date|null} 找不到返回 null
 */
export function prevScheduledTime(expr, timeZone = config.timezone, from = new Date(), maxLookbackMinutes = 60 * 24 * 14) {
  if (!expr) return null
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  for (let i = 0; i <= maxLookbackMinutes; i++) {
    if (cronMatches(expr, cursor, timeZone)) return new Date(cursor.getTime())
    cursor.setTime(cursor.getTime() - 60_000)
  }
  return null
}

/** 从 `from` 往后找「下一次将要触发」的时刻 */
export function nextScheduledTime(expr, timeZone = config.timezone, from = new Date(), maxLookaheadMinutes = 60 * 24 * 14) {
  if (!expr) return null
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setTime(cursor.getTime() + 60_000)
  for (let i = 0; i <= maxLookaheadMinutes; i++) {
    if (cronMatches(expr, cursor, timeZone)) return new Date(cursor.getTime())
    cursor.setTime(cursor.getTime() + 60_000)
  }
  return null
}

function fmtLocal(date, timeZone = config.timezone) {
  if (!date) return '未知'
  return new Date(date).toLocaleString('zh-CN', { timeZone, hour12: false })
}

/**
 * 检查是否有错过的计划任务，并逐个补跑（串行执行，避免并发抢占浏览器）
 *
 * @param {(type:'today'|'yesterday') => Promise<any>} fetchData
 * @param {object} state fetcher 的运行状态对象
 * @param {object} [opts]
 * @param {boolean} [opts.force] 忽略"是否已跑过"的判断，强制补跑一次
 * @returns {Promise<{ checked: Array, ran: Array }>}
 */
export async function runCatchUp(fetchData, state, saveState, opts = {}) {
  const tz = config.timezone
  const now = new Date()
  const checked = []
  const ran = []

  if (config.catchUpMissed === false && !opts.force) {
    log('[catchup] 已在配置中关闭补跑（catchUpMissed=false），跳过')
    return { checked, ran, disabled: true }
  }

  const maxAgeHours = Number(config.catchUpMaxAgeHours) || 36
  const graceMs = (Number(config.catchUpGraceMinutes) || 2) * 60_000

  const jobs = [
    { type: 'yesterday', label: '昨日', expr: config.cronYesterday, lastAt: state.lastYesterday },
    { type: 'today', label: '今日', expr: config.cronToday, lastAt: state.lastToday },
  ]

  for (const job of jobs) {
    if (!job.expr) continue
    const due = prevScheduledTime(job.expr, tz, now)
    const last = job.lastAt ? new Date(job.lastAt) : null
    const info = {
      type: job.type,
      label: job.label,
      cron: job.expr,
      due: due ? due.toISOString() : null,
      lastSuccessAt: job.lastAt || null,
      action: 'skip',
      reason: '',
    }

    if (!due) {
      info.reason = 'cron 表达式无法解析出上一次触发时刻'
      checked.push(info)
      continue
    }

    const lateMs = now.getTime() - due.getTime()

    if (!opts.force && last && last.getTime() >= due.getTime()) {
      info.reason = `上次计划时刻 ${fmtLocal(due, tz)} 之后已成功抓取过，无需补跑`
      checked.push(info)
      continue
    }
    if (!opts.force && lateMs < graceMs) {
      info.reason = `距离计划时刻 ${fmtLocal(due, tz)} 仅 ${Math.round(lateMs / 1000)} 秒，等待正常 cron 触发即可`
      checked.push(info)
      continue
    }
    if (!opts.force && lateMs > maxAgeHours * 3600_000) {
      info.action = 'expired'
      info.reason = `计划时刻 ${fmtLocal(due, tz)} 已过去 ${(lateMs / 3600_000).toFixed(1)} 小时，超过 ${maxAgeHours} 小时上限，不再补跑（补跑只能抓到"当前的昨日"，太久远会导致数据错位）`
      log(`[catchup] 跳过【${job.label}】：${info.reason}`)
      checked.push(info)
      continue
    }

    log(`[catchup] 检测到【${job.label}】错过了 ${fmtLocal(due, tz)} 的计划抓取（服务当时未运行，已迟 ${(lateMs / 3600_000).toFixed(1)} 小时），现在立即补跑`)
    info.action = 'run'
    info.lateHours = Number((lateMs / 3600_000).toFixed(2))

    try {
      const result = await fetchData(job.type)
      info.ok = !!result?.ok
      info.result = result?.ok
        ? { count: result.count, seaCount: result.seaCount }
        : { error: result?.error || result?.message || '未知错误' }
      log(
        result?.ok
          ? `[catchup] 【${job.label}】补跑成功：${result.count} 条`
          : `[catchup] 【${job.label}】补跑失败：${info.result.error}`
      )
    } catch (e) {
      info.ok = false
      info.result = { error: e.message }
      log(`[catchup] 【${job.label}】补跑异常：${e.message}`)
    }

    checked.push(info)
    ran.push(info)
  }

  state.lastCatchUpAt = new Date().toISOString()
  state.lastCatchUp = checked
  try { saveState?.() } catch { /* ignore */ }

  if (!ran.length) log('[catchup] 检查完成：没有需要补跑的任务')
  return { checked, ran }
}

/** 给 /api/status 用的计划概览 */
export function scheduleOverview(state) {
  const tz = config.timezone
  const now = new Date()
  const build = (expr, lastAt) => {
    const prev = prevScheduledTime(expr, tz, now)
    const next = nextScheduledTime(expr, tz, now)
    const last = lastAt ? new Date(lastAt) : null
    return {
      cron: expr,
      prevDue: prev ? prev.toISOString() : null,
      nextDue: next ? next.toISOString() : null,
      lastSuccessAt: lastAt || null,
      missed: !!(prev && (!last || last.getTime() < prev.getTime())),
    }
  }
  return {
    timezone: tz,
    catchUpEnabled: config.catchUpMissed !== false,
    catchUpMaxAgeHours: Number(config.catchUpMaxAgeHours) || 36,
    lastCatchUpAt: state.lastCatchUpAt || null,
    today: build(config.cronToday, state.lastToday),
    yesterday: build(config.cronYesterday, state.lastYesterday),
  }
}
