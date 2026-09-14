# 线下主播看板 — 静态站（GitHub Pages）部署指南

本目录（`streamer-dashboard/`）的主看板 **Dashboard 已支持静态托管**，可将 `dist-static/` 发布到任意静态托管（GitHub Pages / Vercel / Netlify），让**任意人、任意网络、任意设备直接打开链接**即可看板数据，无需安装客户端或登录账号。

> ⚠️ 当前为 **MVP**：仅保证 **主播数据（Dashboard）** 与 **主播数据对比（StreamerDataPage）** 两个页面在静态站下完整可用，其他页（运营总览/挑战赛/招募/周期流水等）会显示"此功能需本地后端"占位。二期逐步扩展。

---

## 一、做了什么

| 改动 | 文件 / 路径 | 说明 |
|---|---|---|
| 源机聚合导出器 | `streamer-dashboard/scripts/export-static.mjs` | 把 `server/data/*.json` 复制到 `public/`，vite 构建时打进 `dist/` |
| 前端静态模式 | `src/hooks/useStreamerData.js`、`src/App.jsx`、`src/components/Sidebar.jsx`、`src/components/StaticGate.jsx` | `VITE_STATIC=1` 时：名册读 `./roster.json`、跳过 SSE/轮询、写操作 no-op、菜单按 `requiresBackend` 过滤、非白名单路由显示占位卡片 |
| 访问口令 | `StaticGate.jsx`（构建时由 `VITE_STATIC_PASSWORD` 注入） | 首屏口令门，会话级 sessionStorage 记忆，关闭浏览器失效 |
| 部署 workflow | `.github/workflows/deploy-static.yml` | push 到 main 自动构建并部署到 GitHub Pages |
| 双击构建入口 | 根目录 `构建静态站.bat` | 管理员双击即可完成 export + vite build |
| 源机同步入口 | 根目录 `同步数据到GitHub.bat` | 提交 `server/data` + 源码变更并 push 触发 CI |

---

## 二、本地构建（源机操作）

### 命令行
```bash
cd streamer-dashboard
node scripts/export-static.mjs
VITE_STATIC=1 VITE_STATIC_PASSWORD=你的口令 node node_modules/vite/bin/vite.js build .
```
产物在 `streamer-dashboard/dist/`。

### 双击（Windows）
双击根目录 **`构建静态站.bat`**，会按顺序执行 export → clean → vite build。  
口令默认 `change-me-please`，构建前请用 `set VITE_STATIC_PASSWORD=xxx` 覆盖，或直接编辑 bat 中的默认值。

---

## 三、部署到 GitHub Pages

### 1. 准备仓库
1. 把 `线下主播管理后台/` 整个目录作为仓库根（或作为子目录 mono-repo）。
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：
   - `STATIC_PASSWORD`：静态站访问口令（即 `VITE_STATIC_PASSWORD` 的值）。
3. 在 **Settings → Pages → Build and deployment** 选择 **Source: GitHub Actions**。

### 2. 推送
```bash
git init && git remote add origin https://github.com/<owner>/<repo>.git
git add .
git commit -m "init: 静态站部署"
git push -u origin main
```
或直接双击根目录 **`同步数据到GitHub.bat`**。

### 3. 等待部署
Actions 工作流 `Deploy static dashboard to GitHub Pages` 会自动运行，约 1-2 分钟。完成后访问：
```
https://<owner>.github.io/<repo>/
```
（若仓库名为 `<owner>.github.io` 则访问 `https://<owner>.github.io/`）

---

## 四、数据更新流水线

每次源机抓取新数据后，重新构建并 push：

1. **方式 A（推荐）**：双击 `同步数据到GitHub.bat`，自动 `git push`，CI 重新构建并部署（1-2 分钟生效）。
2. **方式 B**：本地命令行 `vite build` 后手动上传 `dist/`（不走 CI）。可在 GitHub Pages 设置 Pages source 为 `gh-pages` 分支并手动推。

> `streamer_data.json` 来自 `server/data/latest.json`，由 fetcher 每次抓取后自动同步到 `public/streamer_data.json`，构建时打进 `dist/streamer_data.json`。所以 **更新只需触发抓取 + 重新构建**。

---

## 五、已知限制与优化路线

### 已知限制
| 项 | 现状 | 影响 |
|---|---|---|
| `streamer_data.json` 体积 | **~88 MB**（全量流水明细） | 首次访问需下载 + 解析，桌面浏览器约 10-20s，手机更慢甚至 OOM。GitHub Pages 默认 gzip 后传输约 15-20 MB |
| Git push 仓库体积 | ~88 MB 单文件 + 历史 | 单文件接近 GitHub 100MB 警告线（不会报错但很慢） |
| 静态站页面覆盖 | 仅 Dashboard + StreamerDataPage | 其他统计页显示占位 |
| 访问口令强度 | 前端明文存储 | 仅为防误入，不防逆向，请勿传播链接 |

### 优化路线（二期）
- **数据精简**：导出器裁剪 `streamer_data.json` 非展示字段 + 仅保留近期 90 天明细，目标 < 10 MB。
- **预聚合**：把 `aggregateByRoom` 等前端聚合逻辑搬到 Node 导出器，前端改读聚合快照。
- **多页静态化**：复用 `operatorStats.js` / `kpiMonthly.js` 等后端聚合模块，为运营月度/周期流水/入退会/KPI 等页生成静态 JSON。
- **按月分片**：`streamer_data_YYYY-MM.json`，前端按需加载。
- **强鉴权**：用 Cloudflare Access / Auth0 等在前置网关层加认证，而非前端口令。

---

## 六、故障排查

| 现象 | 原因 / 处理 |
|---|---|
| Actions 部署失败：`npm ci` 找不到 lock | 仓库缺 `package-lock.json`，把本地的 lock 文件提交；或工作流用 `npm install`（已兼容） |
| Actions 部署失败：Pages 未启用 | Settings → Pages → Source 选 "GitHub Actions" |
| 部署后打开是 404 | 检查仓库名与 Pages 设置，路径前缀是否 `<owner>.github.io/<repo>/`，必要时设置 `base` |
| 打开链接空白 | 看浏览器控制台；通常是 `roster.json` 或 `streamer_data.json` 缺失，确认 `dist-static/` 里有它们 |
| 首次打开很慢 | 88 MB 下载/解析所致，见"已知限制"。可用 `curl -o /dev/null -w "%{size_download}\n" https://.../streamer_data.json` 实测下载大小 |
| Git push 超时 | 88 MB 大文件慢，先 `git config http.postBuffer 524288000` 调大 buffer |
| `localhost:8787` 只剩两个菜单 | 误把静态构建产物 `dist/` 覆盖了日常 dist。运行不带 `VITE_STATIC` 的 `vite build` 即可恢复；静态站已改输出到 `dist-static/` 避免再覆盖 |

---

## 七、回退

如果不想用静态站，回到本地/隧道模式，只需：
- 不再跑 `构建静态站.bat`，恢复正常本地服务。
- 任何 VITE_STATIC 未设置时，前端行为完全等同未改造前的版本（兼容）。