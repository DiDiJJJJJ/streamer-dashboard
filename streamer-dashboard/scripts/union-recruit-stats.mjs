#!/usr/bin/env node
import { runUnionRecruitStats } from '../server/jobs/unionRecruitStats.js'

const args = process.argv.slice(2)
const opts = {
  dryRun: args.includes('--dry-run'),
  closeBrowser: args.includes('--close-browser'),
  localFile: '',
  range: '7days',
}

const localIdx = args.indexOf('--local-file')
if (localIdx !== -1 && args[localIdx + 1]) {
  opts.localFile = args[localIdx + 1]
}

const rangeIdx = args.indexOf('--range')
if (rangeIdx !== -1 && args[rangeIdx + 1]) {
  const v = args[rangeIdx + 1]
  if (['7days', '30days', 'thisMonth', 'all'].includes(v)) {
    opts.range = v
  } else {
    console.error(`用法: --range 应为 7days|30days|thisMonth|all 之一，收到: ${v}`)
    process.exit(1)
  }
}

if (opts.dryRun && !opts.localFile) {
  console.error('用法: node scripts/union-recruit-stats.mjs --dry-run --local-file <xxx.xlsx> [--range 7days|30days|thisMonth|all]')
  process.exit(1)
}

console.log('[cli] 开始入退会招募统计...')
const result = await runUnionRecruitStats(opts)

if (!result.ok) {
  console.error('[cli] 失败:', result.error)
  process.exit(1)
}

console.log(`\n========== 运营人员入会统计（${result.rangeLabel}） ==========`)
console.log(`总计已入会: ${result.totalJoined} 人`)
console.log(`线上入会: ${result.onlineTotal} 人 | 线下入会: ${result.offlineTotal} 人 | 未知: ${result.unknownTotal} 人`)
console.log(`\n数据范围: ${result.rangeLabel} | 历史归档共 ${result.archiveTotal} 条 | 本次新增 ${result.newlyAdded} 条`)
console.log('\n运营人员明细:')
for (const o of result.operators) {
  console.log(`  ${o.operator.padEnd(10)} 总入会 ${String(o.total).padStart(3)}  线上 ${String(o.online).padStart(3)}  线下 ${String(o.offline).padStart(3)}  未知 ${String(o.unknown).padStart(3)}`)
}
console.log(`\n结果已保存: server/data/union_recruit_stats.json`)
console.log('完整明细（含主播列表）:', result)
