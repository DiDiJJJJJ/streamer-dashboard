import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))

// 尝试读取 git commit
let gitCommit = ''
try {
  const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf-8').trim()
  if (head.startsWith('ref:')) {
    const refPath = path.join(ROOT, '.git', head.split(' ')[1])
    gitCommit = fs.readFileSync(refPath, 'utf-8').trim().slice(0, 8)
  } else {
    gitCommit = head.slice(0, 8)
  }
} catch { /* ignore */ }

const versionInfo = {
  version: pkg.version || '0.0.0',
  name: pkg.name || 'streamer-dashboard',
  buildTime: new Date().toISOString(),
  gitCommit,
}

const outFile = path.join(ROOT, 'public', 'version.json')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(versionInfo, null, 2), 'utf-8')
console.log(`[version] ${pkg.version} -> ${outFile}`)
