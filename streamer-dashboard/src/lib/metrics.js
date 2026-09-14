import {
  startOfMonth, endOfMonth, subMonths, subDays, isWithinInterval, parseISO,
} from 'date-fns'

// 数值型字段（在聚合时求和）
export const SUM_FIELDS = [
  '总流水（元）', '总收益（元）', '主播自提礼物收益', '语聊房嘉宾收益（元）',
  '专属互动礼物收益（元）', '新增粉丝数', '弹幕数', '开播天数', '开播时长（小时）',
  'pk次数', 'pk流水', 'pk付费人数', '违规次数', '峰值在线人数（pcu）',
  '平均在线人数（acu）', '付费人数',
]

// 时点快照型字段：累计值（如大航海/舰队数），取时间段内「最新一天」的值，不可跨日求和
export const SNAPSHOT_FIELDS = ['大航海人数']

// 文本型字段（聚合时保留首个非空值）
const TEXT_FIELDS = [
  '主播昵称', '主播id', '开播分区', '运营经纪人', '主播在会时间', '性别',
  '年龄分层', '渠道来源', '直播类型', '主播身份', '直播经验', 'TOPSTAR等级',
]

export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v || '').replace(/[^\d.\-]/g, ''))
  return isFinite(n) ? n : 0
}

export function parseStatDate(s) {
  if (!s) return null
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})/g)
  if (!m || !m.length) return null
  return parseISO(`${m[m.length - 1]}T00:00:00`)
}

// 周期范围
export function periodRange(kind) {
  const now = new Date()
  if (kind === '本月') return { label: '本月', start: startOfMonth(now), end: endOfMonth(now) }
  if (kind === '上月') {
    const s = startOfMonth(subMonths(now, 1))
    return { label: '上月', start: s, end: endOfMonth(s) }
  }
  if (kind === '近30天') {
    const e = endOfMonth(now)
    return { label: '近30天', start: subDays(e, 29), end: e }
  }
  return { label: '全部' }
}

export function inRange(r, range) {
  if (!range || range.label === '全部') return true
  const d = parseStatDate(r['统计时间'])
  if (!d) return false
  return isWithinInterval(d, { start: range.start, end: range.end })
}

// 按房间号聚合（数值求和，时点快照取最新一天，粉丝数取最大，文本保留首个非空）
export function aggByRoom(records, range) {
  const filtered = records.filter(r => inRange(r, range))
  const map = new Map()
  const snapLatest = new Map() // room -> { date: Date, value: number }
  for (const r of filtered) {
    const room = String(r['房间号'] || r['主播id'] || '')
    if (!room) continue
    const cur = map.get(room) || {}
    const merged = { ...cur, ...r }
    TEXT_FIELDS.forEach(k => {
      if (!merged[k] && cur[k]) merged[k] = cur[k]
      if (!merged[k] && r[k]) merged[k] = r[k]
    })
    SUM_FIELDS.forEach(k => { merged[k] = num(cur[k]) + num(r[k]) })
    // 时点快照：取统计时间最新的一条对应值（大航海人数为累计舰队数，跨日求和会严重虚高）
    for (const k of SNAPSHOT_FIELDS) {
      const rd = parseStatDate(r['统计时间'])
      const prev = snapLatest.get(room)
      if (rd && (!prev || rd >= prev.date)) {
        merged[k] = num(r[k])
        snapLatest.set(room, { date: rd, value: num(r[k]) })
      } else if (prev) {
        merged[k] = prev.value
      }
    }
    merged['粉丝数'] = Math.max(num(cur['粉丝数']), num(r['粉丝数']))
    map.set(room, merged)
  }
  return Array.from(map.values())
}

// 运营经纪人：取 "林夕|运营组|虚拟线下部" 的第一段
export function parseAgent(s) {
  if (!s) return '(未分配)'
  const p = String(s).split('|')
  return (p[0] || '').trim() || '(未分配)'
}

// 主播分层（按总流水阈值）
export function tierOf(rev) {
  const v = num(rev)
  if (v >= 20000) return 'S'
  if (v >= 8000) return 'A'
  if (v >= 2000) return 'B'
  if (v >= 1) return 'C'
  return 'D'
}

export function pct(n, d) {
  if (!d) return '0%'
  return ((n / d) * 100).toFixed(1) + '%'
}

export function money(n) {
  return '¥' + num(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function fmt(n, dp = 0) {
  return num(n).toLocaleString('zh-CN', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
