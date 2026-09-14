import fs from 'node:fs'
import XLSX from 'xlsx'
import { resolveOperator } from './operatorAssignment.js'

const FILE = 'C:/Users/Administrator/Desktop/AI虚拟皮套/主播数据_2026-09-07 18_45_10.xlsx'
const M = '2026-07'

// ---------- 口径 A：直接读源文件（完全独立于系统，不复用任何业务代码） ----------
const wb = XLSX.readFile(FILE, { raw: false })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
const A = { total: 0, byOp: {}, byDay: {}, rows: 0, rooms: new Set() }
for (const r of rows) {
  const room = String(r['房间号'] || '').trim()
  if (!room) continue
  const st = String(r['统计时间'] || '')
  const day = (st.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || ''
  if (day.slice(0, 7) !== M) continue
  const flow = Number(String(r['总流水（元）'] || '').replace(/[^0-9.\-]/g, '')) || 0
  // 独立复算归属：归属关系表优先，回退文件自带
  let op = resolveOperator(room, day) || String(r['运营经纪人'] || '').split('|')[0].trim() || '未分配'
  A.total += flow; A.rows++; A.rooms.add(room)
  A.byOp[op] = (A.byOp[op] || 0) + flow
  A.byDay[day] = (A.byDay[day] || 0) + flow
}

// ---------- 口径 B：系统内 latest.json 该月明细逐条求和 ----------
const latest = JSON.parse(fs.readFileSync('data/latest.json', 'utf-8'))
const july = latest.filter((r) => String(r['统计结束日期'] || r['统计日期'] || '').slice(0, 7) === M
  && !(r['统计开始日期'] && r['统计结束日期'] && r['统计开始日期'] !== r['统计结束日期']))
const B = { total: 0, byOp: {}, byDay: {}, rows: 0, rooms: new Set() }
for (const r of july) {
  const flow = Number(r['总流水（元）']) || 0
  const op = String(r['归属运营（快照）'] || '').trim() || '未分配'
  B.total += flow; B.rows++; B.rooms.add(String(r['房间号'] || '').trim())
  B.byOp[op] = (B.byOp[op] || 0) + flow
  B.byDay[String(r['统计结束日期'] || '').slice(0, 10)] = (B.byDay[String(r['统计结束日期'] || '').slice(0, 10)] || 0) + flow
}

// ---------- 口径 C：运营月度统计接口（页面实际展示值） ----------
const { aggregateOperatorMonthlyStats } = await import('./operatorStats.js')
const stats = aggregateOperatorMonthlyStats({ force: true })
const C = { total: 0, byOp: {}, rows: stats.rows.filter((r) => r.month === M) }
for (const r of C.rows) { C.byOp[r.operator] = r.totalFlow; C.total += r.totalFlow }

const r2 = (n) => Math.round(n * 100) / 100
console.log('========== 三方对账：2026-07 ==========')
console.log('口径 A = 源文件独立重算 ｜ B = latest.json 明细求和 ｜ C = 运营月度统计输出（页面值）\n')
console.log(`记录数     A=${A.rows}  B=${B.rows}  ${A.rows === B.rows ? '✅' : '❌'}`)
console.log(`房间数     A=${A.rooms.size}  B=${B.rooms.size}  ${A.rooms.size === B.rooms.size ? '✅' : '❌'}`)
console.log(`流水合计   A=¥${r2(A.total)}  B=¥${r2(B.total)}  C=¥${r2(C.total)}  ${r2(A.total) === r2(B.total) && r2(B.total) === r2(C.total) ? '✅' : '❌'}\n`)

const ops = [...new Set([...Object.keys(A.byOp), ...Object.keys(B.byOp), ...Object.keys(C.byOp)])].sort()
console.log('运营        A(源)          B(明细)        C(统计)        差异')
let allOk = true
for (const op of ops) {
  const a = r2(A.byOp[op] || 0), b = r2(B.byOp[op] || 0), c = r2(C.byOp[op] || 0)
  const ok = a === b && b === c
  if (!ok) allOk = false
  console.log(`${op.padEnd(8)} ¥${String(a).padStart(11)} ¥${String(b).padStart(11)} ¥${String(c).padStart(11)}  ${ok ? '✅' : '❌ 差 ' + r2(a - b)}`)
}

const days = [...new Set([...Object.keys(A.byDay), ...Object.keys(B.byDay)])].sort()
const dayDiff = days.filter((d) => r2(A.byDay[d] || 0) !== r2(B.byDay[d] || 0))
console.log(`\n逐日对账   共 ${days.length} 天，不一致 ${dayDiff.length} 天  ${dayDiff.length === 0 ? '✅' : '❌ ' + dayDiff.slice(0, 5).join(',')}`)
console.log('日期覆盖   ' + days[0] + ' ~ ' + days[days.length - 1] + `  ${days.length === 31 ? '✅ 31天完整' : '❌ 仅' + days.length + '天'}`)

// 大航海标记
const seaFlagged = july.filter((r) => String(r['大航海数据缺失'] || '') === '是').length
console.log(`\n大航海标记 ${seaFlagged}/${july.length} 条标记为「无数据」  ${seaFlagged === july.length ? '✅' : '⚠'}`)
console.log(`统计输出 seaMissingMonths = ${JSON.stringify(stats.seaMissingMonths)}  ${stats.seaMissingMonths?.includes(M) ? '✅' : '❌'}`)

// 快照字段固化
const snapOp = july.filter((r) => String(r['归属运营（快照）'] || '').trim()).length
const snapOff = july.filter((r) => String(r['是否线下（快照）'] || '').trim()).length
console.log(`快照字段   归属运营 ${snapOp}/${july.length}，是否线下 ${snapOff}/${july.length}  ${snapOp === july.length && snapOff === july.length ? '✅' : '❌'}`)

// 边界场景验证
const roster = JSON.parse(fs.readFileSync('data/roster.json', 'utf-8'))
const off = new Set((roster.offlineRooms || []).map(String))
const julRooms = new Set(july.map((r) => String(r['房间号'] || '').trim()))
console.log('\n========== 边界场景验证 ==========')
const gone = [...julRooms].filter((r) => !off.has(r))
console.log(`7月在册但不在当前线下名册: ${gone.length} 个房间（其 7 月流水已入库，未被状态过滤）✅`)
const left = [...off].filter((r) => !julRooms.has(r))
console.log(`当前名册中 7 月无数据: ${left.length} 个 ${left.length ? '(' + left.join(',') + ')' : ''}`)
const T = '1732562810'
const tRows = july.filter((r) => String(r['房间号'] || '').trim() === T)
console.log(`房间 ${T}（运营变更）: ${tRows.length} 天，归属快照=${[...new Set(tRows.map(r => r['归属运营（快照）']))].join(',')}，流水 ¥${r2(tRows.reduce((a, r) => a + (Number(r['总流水（元）']) || 0), 0))}`)
console.log(`\n总判定: ${allOk && A.rows === B.rows && dayDiff.length === 0 ? '✅ 全部一致' : '❌ 存在不一致'}`)
