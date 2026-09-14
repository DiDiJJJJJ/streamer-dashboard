# GitHub Pages 部署指南（免费公网 + 自动发布）

本仓库已配好自动化工作流：把 `main` 分支推送到 GitHub 后，GitHub Actions 会自动构建并发布到 `gh-pages` 分支，GitHub Pages 即提供永久免费公网访问。

> ⚠️ 功能边界：GitHub Pages 只托管静态文件，**自动抓取 / 立即抓取 / 同步数据 / 清空重导**这些需要本地 Node 服务（含 Playwright+Chrome）的功能在 Pages 上不可用。Pages 上可用的是：看板展示、筛选、日期范围、今日/本周/本月统计、手机端适配、版本徽章显示。
> 想要在公网也能「自动抓取」请用之前搭好的 localtunnel 隧道，或后续上云服务器。

## 一、首次推送（需要你的 GitHub 账号）

1. 打开 https://github.com/new 创建新仓库：
   - Repository name：`streamer-dashboard`（或任意）
   - 设为 **Public**
   - 不要勾选 "Add a README file" / "Add .gitignore"（仓库里已有）
   - 点 **Create repository**

2. 复制仓库地址（HTTPS），例如 `https://github.com/<你的用户名>/streamer-dashboard.git`

3. 在本机（已初始化好 git 的目录下）执行：

```bash
cd "E:/WorkBuddy/线下主播管理后台/streamer-dashboard"

# 把 <你的用户名> 和仓库名换成你刚创建的
git remote add origin https://github.com/<你的用户名>/streamer-dashboard.git

git push -u origin main
```

> 推送时会弹出 GitHub 登录（浏览器或 Personal Access Token）。若用 Token，需勾选 `repo` 权限。

## 二、开启 Pages

1. 推送成功后，进入仓库 **Settings → Pages**（左侧栏）。
2. **Build and deployment → Source** 选择 **Deploy from a branch**。
3. **Branch** 选择 **gh-pages** → **Save**。
4. 等待 1~2 分钟（Actions 首次运行会创建 gh-pages 分支），然后访问：

```
https://<你的用户名>.github.io/streamer-dashboard/
```

> 之后每次 `git push` 到 `main`，Actions 都会自动重新构建并发布，无需手动操作。

## 三、如何更新看板数据（Pages 版）

Pages 展示的是构建时 `public/streamer_data.json` 里那一份数据。要更新：

1. 在本机启动数据同步服务（`server\启动数据同步服务.bat`），点【同步数据】或【清空并重新导入 8.1~8.7 历史】，本地会把最新数据写入 `public/streamer_data.json`。
2. 提交并推送这份数据文件：

```bash
git add public/streamer_data.json
git commit -m "data: 更新主播数据 YYYY-MM-DD"
git push
```

3. Actions 自动重新发布，公网页刷新即可看到新数据。

## 四、本地验证（不推送也能看）

```bash
cd "E:/WorkBuddy/线下主播管理后台/streamer-dashboard"
npm run build
# 用任意静态服务器打开 dist/，例如：
npx --yes serve dist
```

## 五、工作流说明

文件：`.github/workflows/deploy.yml`

- 触发：`push` 到 `main`，或在 Actions 页手动 **Run workflow**。
- 步骤：checkout → 装 Node 22 → `npm ci` → `npm run build` → 确保 `dist/.nojekyll` → 用 `peaceiris/actions-gh-pages@v4` 发布 `dist/` 到 `gh-pages`（force_orphan）。
- `public/.nojekyll` 已存在，vite 构建时会复制到 `dist/`，避免 GitHub 用 Jekyll 处理导致 `_` 开头文件/目录被忽略。

## 六、已做的兼容性处理

- 前端数据请求从绝对路径 `/streamer_data.json` 改为相对路径 `./streamer_data.json`，确保在 `/<仓库名>/` 子路径下能正确加载。
- `vite.config.js` 的 `base: './'`（相对路径）保证资源在子路径下正常引用。
- `.gitignore` 已排除 `node_modules`、`dist`、`server/data`、`server/downloads`、`server/node_modules`、`venv`、`.chrome-profile` 等运行时产物，仓库只含源码与当前数据快照。
