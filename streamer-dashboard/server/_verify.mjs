import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// 用 esbuild 无关方式：直接复制 computeChallenge 的纯逻辑验证较繁，这里改为调用已构建产物不可行；
// 改为用 vite 构建产物中的挑战逻辑也不便。转而用 node 直接加载 ESM：
import { computeChallenge } from './src/utils/challenge.js'

const raw = JSON.parse(fs.readFileSync('server/data/latest.json','utf8'))
const roster = JSON.parse(fs.readFileSync('server/data/roster.json','utf8'))
const offline = new Set(roster.offlineRooms)

// 极简 cleanRecord（仅取需要的字段）
function clean(r){
  return {
    主播id:String(r['主播id']??''), 主播昵称:r['主播昵称'], 房间号:String(r['房间号']??''),
    开播分区:r['开播分区'], 总流水:Number(r['总流水（元）']||0), 统计时间:r['统计时间'],
  }
}
const cleaned = raw.map(clean)
const records = cleaned.map(r=>{
  const room=String(r['房间号'])
  const st = roster.status[room]?.status || '在职'
  return { ...r, '是否线下主播': offline.has(room), '在职状态': st }
})

const ws = computeChallenge(records, { startDate:'2026-08-03', endDate:'2026-08-09', tracks: roster.tracks, overrideWeek:{start:'2026-08-03',end:'2026-08-09'} })
ws.forEach(w=>{
  console.log('周', w.label, '| 达标', w.达标人数, '| 总流水', w.总流水)
  ;(w.list||[]).forEach(s=>{
    console.log('   ', s.排名, s.主播昵称, '| 房间', s.房间号, '| 赛道', s.赛道, '| 晋级状态', s.晋级状态, '| 周流水', s.总流水, (roster.tracks[s.房间号]?'(附件赛道:'+roster.tracks[s.房间号]+')':''))
  })
})
