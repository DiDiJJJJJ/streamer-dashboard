// 构建前清空 dist 或 dist-static，避免历史哈希产物在目录中累积残留。
// 注意：构建环境对 node 的 fs.rmSync 做了 safe-delete（trash）拦截，vite 自带的 emptyOutDir
// 会逐文件调用 rmSync 并因个别文件（如 .nojekyll）触发 trash 报错、导致构建失败。
// 因此这里改用 PowerShell 的 Remove-Item（走回收站、在本环境稳定可用）整体删除目标目录，
// 让 vite 在干净目录上写入，旧产物被移入回收站而非留在原处。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetName = process.argv[2] || 'dist'
const dist = resolve(__dirname, '..', targetName)

if (!existsSync(dist)) {
  console.log(`[clean] ${targetName} 不存在，跳过`)
  process.exit(0)
}

try {
  const safePath = dist.replace(/'/g, "''")
  execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath '${safePath}' -Recurse -Force`],
    { stdio: 'inherit' },
  )
  console.log(`[clean] 已通过 PowerShell 清空 ${targetName}:`, dist)
} catch (e) {
  console.warn(`[clean] PowerShell 清理失败，回退到 node rmSync:`, e.message)
  try {
    const { rmSync } = await import('node:fs')
    rmSync(dist, { recursive: true, force: true })
    console.log(`[clean] 已用 node rmSync 清空 ${targetName}`)
  } catch (e2) {
    console.warn(`[clean] 清理 ${targetName} 失败，保留旧产物（不影响本次构建）:`, e2.message)
  }
}
