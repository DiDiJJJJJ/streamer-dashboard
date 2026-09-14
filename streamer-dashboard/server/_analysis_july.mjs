import fs from 'node:fs'
import { aggregateOperatorMonthlyStats } from './operatorStats.js'

const stats = aggregateOperatorMonthlyStats({ force: true })
const roster = JSON.parse(fs.readFileSync('data/roster.json', 'utf-8'))
const off = new Set((roster.offlineRooms || []).map(String))

const pick = (m) => {
  const o = {}
  for (const r of stats.rows) if (r.month === m) o[r.operator] = r
  return o
}
const J = pick('2026-07')
const A = pick('2026-08')
const ops = Object.keys(J).sort((a, b) => J[b].totalFlow - J[a].totalFlow)

const pct = (to, from) => (from === 0 ? (to > 0 ? 100 : 0) : ((to - from) / from) * 100)
const money = (n) => '¥' + Math.round(n).toLocaleString('zh-CN')

console.log('========== 2026-07 运营业绩总览 ==========\n')
console.log('运营 | 总流水 | 占比 | 线下流水 | 主播数 | 有流水主播 | 开播时长 | 付费人数 | 客单价 | 日均流水')
let total = 0, totalOff = 0
for (const op of ops) {
  const r = J[op]
  total += r.totalFlow; totalOff += r.offlineFlow
}
for (const op of ops) {
  const r = J[op]
  console.log([
    op.padEnd(6),
    money(r.totalFlow).padStart(11),
    ((r.totalFlow / total) * 100).toFixed(1).padStart(5) + '%',
    money(r.offlineFlow).padStart(10),
    String(r.roomCount).padStart(5),
    String(r.payingRoomCount).padStart(8),
    (Math.round(r.broadcastHours) + 'h').padStart(8),
    String(r.payCount).padStart(7),
    money(r.avgPrice).padStart(8),
    money(r.dailyAvg).padStart(9),
  ].join(' | '))
}
console.log(['合计'.padEnd(6), money(total).padStart(11), '100.0%', money(totalOff).padStart(10), '', '', '', '', '', ''].join(' | '))
console.log(`\n线下占比: ${(totalOff / total * 100).toFixed(1)}%（当前线下名册 49 人，覆盖有限，与 8 月口径一致）`)

console.log('\n========== 7 月 → 8 月环比 ==========\n')
console.log('运营 | 7月流水 | 8月流水 | 环比 | 差额 | 主播数变化 | 时长变化')
for (const op of ops) {
  const j = J[op], a = A[op]
  if (!a) { console.log(`${op.padEnd(6)} | ${money(j.totalFlow)} | 无 8 月数据`); continue }
  const p = pct(a.totalFlow, j.totalFlow)
  const sign = p >= 0 ? '+' : ''
  console.log([
    op.padEnd(6),
    money(j.totalFlow).padStart(10),
    money(a.totalFlow).padStart(10),
    (sign + p.toFixed(1) + '%').padStart(8),
    ((a.totalFlow - j.totalFlow >= 0 ? '+' : '') + money(a.totalFlow - j.totalFlow)).padStart(11),
    String(a.roomCount - j.roomCount).padStart(8),
    (Math.round(a.broadcastHours - j.broadcastHours) + 'h').padStart(9),
  ].join(' | '))
}
const tj = ops.reduce((s, o) => s + J[o].totalFlow, 0)
const ta = ops.reduce((s, o) => s + (A[o]?.totalFlow || 0), 0)
console.log(['合计'.padEnd(6), money(tj).padStart(10), money(ta).padStart(10), ((pct(ta, tj) >= 0 ? '+' : '') + pct(ta, tj).toFixed(1) + '%').padStart(8), ((ta - tj >= 0 ? '+' : '') + money(ta - tj)).padStart(11)].join(' | '))
console.log('注: 9 月仅 1-7 日，不参与环比')

// 头部主播
console.log('\n========== 7 月 TOP15 主播（按流水）==========\n')
const latest = JSON.parse(fs.readFileSync('data/latest.json', 'utf-8'))
const jul = latest.filter((r) => String(r['统计结束日期'] || '').slice(0, 7) === '2026-07'
  && !(r['统计开始日期'] && r['统计结束日期'] && r['统计开始日期'] !== r['统计结束日期']))
const byRoom = {}
for (const r of jul) {
  const rm = String(r['房间号'] || '').trim(); if (!rm) continue
  const b = byRoom[rm] || (byRoom[rm] = { room: rm, name: r['主播昵称'], op: r['归属运营（快照）'], flow: 0, hours: 0, days: 0, pay: 0, offline: off.has(rm) })
  b.flow += Number(r['总流水（元）']) || 0
  b.hours += Number(r['开播时长（小时）']) || 0
  b.days += (Number(r['总流水（元）']) || 0) > 0 ? 1 : 0
  b.pay += Number(r['付费人数']) || 0
}
const top = Object.values(byRoom).sort((a, b) => b.flow - a.flow).slice(0, 15)
console.log('排名 | 主播 | 房间号 | 运营 | 流水 | 有效天数 | 时长 | 付费 | 线下')
top.forEach((b, i) => {
  console.log([
    String(i + 1).padStart(3),
    String(b.name).slice(0, 18).padEnd(18),
    b.room,
    String(b.op).padEnd(6),
    money(b.flow).padStart(10),
    String(b.days).padStart(6),
    (Math.round(b.hours) + 'h').padStart(7),
    String(b.pay).padStart(6),
    b.offline ? '  是' : '  否',
  ].join(' | '))
})
const topSum = top.reduce((s, b) => s + b.flow, 0)
console.log(`\nTOP15 合计 ¥${Math.round(topSum)}，占 7 月总量 ${(topSum / total * 100).toFixed(1)}%（头部集中度高）`)
const active = Object.values(byRoom).filter((b) => b.flow > 0).length
console.log(`7 月有流水主播 ${active} 人 / 在册 ${Object.keys(byRoom).length} 人（${(active / Object.keys(byRoom).length * 100).toFixed(1)}%）`)
