// scripts/export-static.mjs
// 静态托管导出器：把 server/data 里的只读展示数据复制到 public/，让 vite 构建时打进 dist
// 用法：node scripts/export-static.mjs [--payload-only]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'server', 'data')
const PUBLIC_DIR = path.join(ROOT, 'public')

function log(s) { console.log('[export-static] ' + s) }

function copyIfExists(src, dst, label) {
  if (!fs.existsSync(src)) {
    log(`skip (not found): ${path.relative(ROOT, src)}`)
    return null
  }
  const payload = fs.readFileSync(src, 'utf-8')
  fs.writeFileSync(dst, payload, 'utf-8')
  const sz = payload.length
  log(`OK ${label}  ${(sz / 1024).toFixed(1)} KB  ->  ${path.relative(ROOT, dst)}`)
  return sz
}

const args = new Set(process.argv.slice(2))

const targets = [
  { src: path.join(DATA_DIR, 'roster.json'), dst: path.join(PUBLIC_DIR, 'roster.json'), label: 'roster.json' },
  { src: path.join(DATA_DIR, 'kpi.json'), dst: path.join(PUBLIC_DIR, 'kpi.json'), label: 'kpi.json' },
  { src: path.join(DATA_DIR, 'kpi_monthly.json'), dst: path.join(PUBLIC_DIR, 'kpi_monthly.json'), label: 'kpi_monthly.json' },
  { src: path.join(DATA_DIR, 'ops_team.json'), dst: path.join(PUBLIC_DIR, 'ops_team.json'), label: 'ops_team.json' },
  { src: path.join(DATA_DIR, 'ops_team_changelog.json'), dst: path.join(PUBLIC_DIR, 'ops_team_changelog.json'), label: 'ops_team_changelog.json' },
  { src: path.join(DATA_DIR, 'ops_team_state.json'), dst: path.join(PUBLIC_DIR, 'ops_team_state.json'), label: 'ops_team_state.json' },
  { src: path.join(DATA_DIR, 'union_recruit_stats.json'), dst: path.join(PUBLIC_DIR, 'union_recruit_stats.json'), label: 'union_recruit_stats.json' },
  { src: path.join(DATA_DIR, 'union_recruit_archive.json'), dst: path.join(PUBLIC_DIR, 'union_recruit_archive.json'), label: 'union_recruit_archive.json' },
  { src: path.join(DATA_DIR, 'streamer_first_broadcast.json'), dst: path.join(PUBLIC_DIR, 'streamer_first_broadcast.json'), label: 'streamer_first_broadcast.json' },
  { src: path.join(DATA_DIR, 'removed_rooms.json'), dst: path.join(PUBLIC_DIR, 'removed_rooms.json'), label: 'removed_rooms.json' },
  { src: path.join(DATA_DIR, 'monthly_snapshot.json'), dst: path.join(PUBLIC_DIR, 'monthly_snapshot.json'), label: 'monthly_snapshot.json' },
  { src: path.join(DATA_DIR, 'operator_assignment.json'), dst: path.join(PUBLIC_DIR, 'operator_assignment.json'), label: 'operator_assignment.json' },
]

// streamer_data.json: 优先用 fetcher 已生成的 public/streamer_data.json，否则用 server/data/latest.json
const streamDataSrc = fs.existsSync(path.join(PUBLIC_DIR, 'streamer_data.json'))
  ? path.join(PUBLIC_DIR, 'streamer_data.json')
  : path.join(DATA_DIR, 'latest.json')
const streamDataDst = path.join(PUBLIC_DIR, 'streamer_data.json')

log(`static export started (mode=${args.has('--payload-only') ? 'payload-only' : 'full'})`)
let totalBytes = 0
for (const t of targets) {
  const sz = copyIfExists(t.src, t.dst, t.label)
  if (sz !== null) totalBytes += sz
}
const streamSize = copyIfExists(streamDataSrc, streamDataDst, 'streamer_data.json')
if (streamSize !== null) totalBytes += streamSize

log(`total exported: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
log(`next:  VITE_STATIC=1 VITE_STATIC_PASSWORD=xxx npm run build:static`)
