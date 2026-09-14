import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    // 不清空由 vite 自己完成：构建环境对 fs.rmSync 做了 safe-delete（trash）拦截，
    // vite 的 emptyDir 会逐文件调用 rmSync 并因 .nojekyll 等触发 trash 报错导致构建失败。
    // 改由构建脚本 scripts/clean-dist.mjs（走 PowerShell Remove-Item 安全清空）在 vite 之前清掉 dist，
    // 这样 dist 不会累积历史哈希产物（main-*.js / index-*.js），index.html 也只引用最新哈希。
    emptyOutDir: false,
    sourcemap: true,
    // 单 chunk 体积超过该值会告警；recharts/d3 体积较大，配合下方 manualChunks 分包后主包已显著缩小。
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        share: resolve(__dirname, 'share.html'),
      },
      output: {
        // 将体积较大的三方库单独分包：缩短主包体积、消除体积告警、提升浏览器缓存命中率。
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory') || id.includes('internmap')) return 'vendor-charts'
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('xlsx') || id.includes('exceljs')) return 'vendor-xlsx'
          return 'vendor'
        },
      },
    },
  },
})
