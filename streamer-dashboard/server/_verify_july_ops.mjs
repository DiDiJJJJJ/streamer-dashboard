import { aggregateOperatorMonthlyStats } from './operatorStats.js'
const stats = aggregateOperatorMonthlyStats({ force: true })
const months = stats.months || []
console.log('运营月度统计覆盖月份:', months.join(', '))
const july = (stats.rows || []).filter(r => r.month === '2026-07')
console.log('\n==== 2026-07 各运营「入会数」（来自 operatorStats，读 union_recruit_archive.json）====')
let tot=0, on=0, off=0
for (const r of july.sort((a,b)=>b.joined-a.joined)) {
  console.log(`  ${r.operator}: 入会${r.joined} (线上${r.joinedOnline}/线下${r.joinedOffline}) | 总流水¥${r.totalFlow}`)
  tot+=r.joined; on+=r.joinedOnline; off+=r.joinedOffline
}
console.log(`\n7月合计: 入会${tot} (线上${on}/线下${off}), 覆盖运营数=${july.length}`)
