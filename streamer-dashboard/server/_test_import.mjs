// 端到端验证：整月区间导入 → 归属固化 → 统计融合 → 幂等 → 对账 → 清理
import XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { importMonth, verifyMonth, purgeMonth } from './monthImport.js'
import { aggregateOperatorMonthlyStats } from './operatorStats.js'
import * as assignment from './operatorAssignment.js'
import { listMonths } from './monthlySnapshot.js'

const TMP = path.join('data', '_july_test.xlsx')
const header = ['主播昵称', '主播id', '房间号', '开播分区', '运营经纪人', '运营经纪人UID', '粉丝数',
  '总流水（元）', '总收益（元）', '开播天数', '开播时长（小时）', '付费人数', '大航海人数', '统计时间']
const T = '2026-07-01 00:00:00 ~ 2026-07-31 23:59:59'

// 线下名册里的真实房间号（用于验证线下标记）
const roster = JSON.parse(fs.readFileSync('data/roster.json', 'utf-8'))
const off1 = roster.offlineRooms[0], off2 = roster.offlineRooms[1]

const rows = [
  ['主播A', '1', '1967349793', '虚拟主播', '林夕|运营组|虚拟线下部', '111', 100, 1000.5, 500.25, '31天', 120.5, 30, 5, T],
  ['主播B', '2', '1732562810', '虚拟主播', '轨迹|运营组|虚拟线下部', '112', 200, 2000.0, 1000.0, '28天', 90.0, 20, 3, T],
  ['线下C', '3', off1, '虚拟主播', '梧桐|运营组|虚拟线下部', '113', 300, 3000.0, 1500.0, '30天', 150.0, 40, 8, T],
  ['线下D', '4', off2, '虚拟主播', '予我|运营组|虚拟线下部', '114', 400, 4000.25, 2000.0, '31天', 200.0, 50, 10, T],
  ['跨月E', '5', '999888777', '虚拟主播', '林夕|运营组|虚拟线下部', '115', 500, 555.55, 277.7, '15天', 60.0, 10, 1, '2026-07-20 00:00:00 ~ 2026-08-05 23:59:59'],
  ['无运营F', '6', '555444333', '虚拟主播', '', '', 60, 600.0, 300.0, '20天', 70.0, 5, 0, T],
  ['负流水G', '7', '222333444', '虚拟主播', '小辫子|运营组|虚拟线下部', '117', 70, -100.0, -50.0, '10天', 30.0, 2, 0, T],
  ['无房间H', '8', '', '虚拟主播', '梧桐|运营组|虚拟线下部', '118', 80, 800.0, 400.0, '10天', 30.0, 2, 0, T],
  ['重复I-1', '9', '111222333', '虚拟主播', '予我|运营组|虚拟线下部', '119', 90, 100.0, 50.0, '5天', 10.0, 1, 0, T],
  ['重复I-2', '9', '111222333', '虚拟主播', '予我|运营组|虚拟线下部', '119', 90, 250.0, 125.0, '5天', 10.0, 1, 0, T],
]

const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, '主播数据')
XLSX.writeFile(wb, TMP)
console.log('已生成测试文件:', TMP)

// 先写一条归属覆盖：房间 1732562810 在 7 月整月归「小辫子」（模拟月内/跨月变更）
const a1 = assignment.setEntry({ room: '1732562810', operator: '小辫子', from: '2026-07-01', to: '2026-07-31', source: 'test' })
console.log('写入归属覆盖:', JSON.stringify(a1))

console.log('\n===== 1) 首次导入 2026-07 =====')
const r1 = importMonth({ filePath: TMP, month: '2026-07', statStart: '2026-07-01', statEnd: '2026-07-31' })
console.log('mode =', r1.mode, '| count =', r1.count, '| daily =', r1.dailyCount, '| range =', r1.rangeCount)
console.log('stats =', JSON.stringify(r1.stats))
console.log('warnings =', JSON.stringify(r1.warnings, null, 1))
console.log('errors =', JSON.stringify(r1.errors))
console.log('sourceTotals =', JSON.stringify(r1.sourceTotals, null, 1))

console.log('\n===== 2) 校验 2026-07 =====')
const v = verifyMonth('2026-07')
console.log('source =', v.source, '| records =', v.recordCount, '| rooms =', v.roomCount, '| total =', v.totalFlow)
console.log('byOperator =', JSON.stringify(v.byOperator))
console.log('checks:')
for (const c of v.checks) console.log(`  [${c.ok ? 'OK ' : 'FAIL'}] ${c.name}: ${c.value} vs ${c.expect} ${c.note}`)
console.log('verify.ok =', v.ok)

console.log('\n===== 3) 统计融合：运营月度统计是否出现 7 月 =====')
const st = aggregateOperatorMonthlyStats({ force: true })
console.log('months =', JSON.stringify(st.months))
console.log('monthSource =', JSON.stringify(st.monthSource))
const jul = st.rows.filter(r => r.month === '2026-07' && (r.totalFlow || r.roomCount))
console.log('7月行：')
for (const r of jul) {
  console.log(`  ${r.operator}: 总流水=${r.totalFlow} 线下=${r.offlineFlow} 线上=${r.onlineFlow} 主播=${r.roomCount} 付费=${r.payCount} 大航海=${r.seaCount}`)
}
// 对账：统计值 vs 明细逐条求和
let sum = 0
for (const r of jul) sum += r.totalFlow
console.log('统计口径合计 =', Math.round(sum * 100) / 100, '| verify 合计 =', v.totalFlow, '| 一致 =', Math.abs(sum - v.totalFlow) < 0.01)

console.log('\n===== 4) 幂等：重复导入同一文件 =====')
const r2 = importMonth({ filePath: TMP, month: '2026-07', statStart: '2026-07-01', statEnd: '2026-07-31' })
console.log('第二次 count =', r2.count, '| 快照 replaced =', r2.snapshot?.replaced, '| prevRecordCount =', r2.snapshot?.prevRecordCount)
const v2 = verifyMonth('2026-07')
console.log('第二次校验 total =', v2.totalFlow, '| records =', v2.recordCount, '| 与首次一致 =', v2.totalFlow === v.totalFlow && v2.recordCount === v.recordCount)

console.log('\n===== 5) 归属表覆盖是否生效 =====')
console.log('期望 1732562810(2000元) 归「小辫子」而非原「轨迹」：')
console.log('  小辫子 7月流水 =', v.byOperator['小辫子'], '(含负流水 -100 → 1900)')
console.log('  轨迹 7月流水 =', v.byOperator['轨迹'] ?? 0, '(应为 0 或不存在)')

console.log('\n===== 6) 清理测试数据 =====')
const p = purgeMonth('2026-07')
console.log('purge 2026-07 =', JSON.stringify(p))
const p2 = purgeMonth('2026-08')
console.log('purge 2026-08 =', JSON.stringify(p2))
assignment.removeEntry('1732562810', '2026-07-01')
try { fs.unlinkSync(TMP) } catch {}
console.log('剩余快照月份 =', JSON.stringify(listMonths()))
const st2 = aggregateOperatorMonthlyStats({ force: true })
console.log('清理后 months =', JSON.stringify(st2.months))
