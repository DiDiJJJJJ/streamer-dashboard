// 一次性导入 2026-07 入退会数据到 union_recruit_archive.json（去重库）
// 仅解析本地文件、合并去重、再生统统计，不触碰 B站。
import { runUnionRecruitStats, aggregateRecruitStats } from './jobs/unionRecruitStats.js'

const FILE = 'server/downloads/recruit_1788857022_入会管理_2026-09-08 16_17_54.xlsx'
const MONTH = '2026-07'

const before = JSON.parse((await import('node:fs')).readFileSync('server/data/union_recruit_archive.json', 'utf-8'))
console.log(`[导入前] archive 共 ${before.records.length} 条`)

const res = await runUnionRecruitStats({ dryRun: true, localFile: FILE, range: 'all' })
if (!res.ok) {
  console.error('[导入失败]', res.error)
  process.exit(1)
}
console.log(`[导入结果] 本次新增 ${res.newlyAdded} 条，archive 现共 ${res.archiveTotal} 条（新增后应 = ${before.records.length} + ${res.newlyAdded}）`)

// 校验：7月按运营聚合
const july = aggregateRecruitStats('all', MONTH)
console.log('\n==== 2026-07 入会统计（按运营）====')
console.log('rangeLabel:', july.rangeLabel, '| totalJoined:', july.totalJoined, '| 线上:', july.onlineTotal, '| 线下:', july.offlineTotal, '| 未知:', july.unknownTotal)
for (const op of july.operators) {
  console.log(`  ${op.operator}: 总${op.total} (线上${op.online}/线下${op.offline}/未知${op.unknown})`)
}
console.log('\n==== 月度趋势（archive 全量）====')
for (const m of july.monthlyTrend) {
  console.log(`  ${m.month}: 总${m.total} (线上${m.online}/线下${m.offline}/未知${m.unknown})`)
}
console.log('\navailableMonths:', july.availableMonths.join(', '))
