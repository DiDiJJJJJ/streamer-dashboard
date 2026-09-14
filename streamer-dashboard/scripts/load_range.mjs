// 把指定的 B站导出 xlsx 解析并写入数据集（清空后整体载入）
// 用法: node scripts/load_range.mjs "C:\path\to\file.xlsx"
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, DATA_DIR } from '../server/config.js'
import { parseWorkbook } from '../server/parser.js'

const file = process.argv[2] || 'C:\\Users\\Administrator\\Desktop\\线下主播看板\\主播数据_2026-08-08 14_05_45.xlsx'

if (!fs.existsSync(file)) {
  console.error('找不到文件:', file)
  process.exit(1)
}

const { records, headerMap } = parseWorkbook(file)
if (!records.length) {
  console.error('解析结果为空，请检查文件内容')
  process.exit(1)
}

function writeDataset(rows) {
  const latestFile = path.join(DATA_DIR, 'latest.json')
  fs.writeFileSync(latestFile, JSON.stringify(rows, null, 2), 'utf-8')
  const publicFile = path.join(ROOT, 'public', 'streamer_data.json')
  fs.writeFileSync(publicFile, JSON.stringify(rows, null, 2), 'utf-8')
  const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
  if (fs.existsSync(distFile)) {
    fs.writeFileSync(distFile, JSON.stringify(rows, null, 2), 'utf-8')
  }
  console.log('已写入:', latestFile)
  console.log('已写入:', publicFile)
  if (fs.existsSync(distFile)) console.log('已写入:', distFile)
}

writeDataset(records)

// 统计信息
const rooms = new Set(records.map(r => String(r['房间号'] || '')))
const statTimes = new Set(records.map(r => String(r['统计时间'] || '')))
const totalRevenue = records.reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)
console.log('总记录数:', records.length)
console.log('去重房间数:', rooms.size)
console.log('统计时间取值:', [...statTimes].slice(0, 3), statTimes.size > 3 ? `... 共 ${statTimes.size} 种` : '')
console.log('总流水合计:', totalRevenue)
console.log('字段映射示例(大航海人数):', headerMap && Object.entries(headerMap).find(([, v]) => v === '大航海人数'))
