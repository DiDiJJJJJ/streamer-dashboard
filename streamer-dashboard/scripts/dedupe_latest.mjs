import fs from 'node:fs'
import path from 'node:path'
import { ROOT, DATA_DIR } from '../server/config.js'

const latestFile = path.join(DATA_DIR, 'latest.json')
if (!fs.existsSync(latestFile)) {
  console.log('latest.json 不存在')
  process.exit(0)
}

const rows = JSON.parse(fs.readFileSync(latestFile, 'utf-8'))

// 保留每个房间号「统计结束日期」最新的一条（区间快照 vs 单日记录冲突时，取结束更晚者）
const byRoom = new Map()
rows.forEach(r => {
  const room = String(r['房间号'] || r['主播id'] || '')
  const existing = byRoom.get(room)
  if (!existing) { byRoom.set(room, r); return }
  const eEnd = existing['统计结束日期'] || existing['统计日期'] || ''
  const nEnd = r['统计结束日期'] || r['统计日期'] || ''
  if (nEnd > eEnd || (nEnd === eEnd && (r['统计开始日期'] || '') > (existing['统计开始日期'] || ''))) {
    byRoom.set(room, r)
  }
})
const deduped = Array.from(byRoom.values())
console.log(`去重前 ${rows.length} 条 -> 去重后 ${deduped.length} 条`)

function writeDataset(records) {
  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify(records, null, 2), 'utf-8')
  fs.writeFileSync(path.join(ROOT, 'public', 'streamer_data.json'), JSON.stringify(records, null, 2), 'utf-8')
  const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
  if (fs.existsSync(distFile)) {
    fs.writeFileSync(distFile, JSON.stringify(records, null, 2), 'utf-8')
  }
}

writeDataset(deduped)
console.log('已同步到 public/streamer_data.json 和 dist/streamer_data.json')
