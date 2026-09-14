import fs from 'node:fs'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import { config, saveConfig, ROOT, DATA_DIR, log } from './config.js'
import { checkLogin, openLoginWindow, closeContext } from './browser.js'
import { fetchData, fetchDataByDate, readData, state, loadState, saveState, raiseAlert, clearAlerts } from './fetcher.js'
import { parseWorkbook, mergeRecords } from './parser.js'
import { runCatchUp, scheduleOverview } from './scheduler.js'
import XLSX from 'xlsx'
import { loadRoster, saveRoster, snapshotRoster, restoreRoster, mergeRosterImport } from './roster.js'
import { validateRosterTemplate } from './validateRosterImport.js'
import { appendBatch, findBatch, appendRollbackLog, genBatchId, genRollbackId, loadHistory, loadRollbackLog } from './rosterHistory.js'
import { createShare, getValidShare, revokeShare, listShares, cleanupExpiredShares, computeCurrentWeekBoard } from './share.js'
import { runUnionRecruitStats, aggregateRecruitStats } from './jobs/unionRecruitStats.js'
import { previewRemovedRooms, pruneRemovedRooms, restoreRemovedRooms, listRemovedRooms } from './removedRooms.js'
import { aggregateOperatorMonthlyStats, getOperatorStreamerCompare } from './operatorStats.js'
import { getStreamerCycleFlow, getOfflineStreamerRooms, getStreamerCycleFlowSummary, syncFirstBroadcast } from './streamerCycleFlow.js'
import { syncOpsTeam, previewOpsTeam, getOpsTeamSummary, batchAdjustOpsTeam } from './opsTeam.js'
import { settleKpiMonths, getKpiMonthlySummary } from './kpiMonthly.js'
import { importMonth, verifyMonth, purgeMonth } from './monthImport.js'
import * as assignment from './operatorAssignment.js'
import { listMonths as listSnapshotMonths, summary as snapshotSummary } from './monthlySnapshot.js'
import { bus } from './events.js'
import { atomicWriteSync, cleanStaleTmp } from './utils/atomicWrite.js'
import { FETCH_HARD_TIMEOUT_MS } from './utils/runGuard.js'
import { startTunnelWatch, stopTunnelWatch, getCurrentTunnel, getTunnelHistory, addManualEntry } from './tunnelWatcher.js'
import { getTailscaleStatus } from './tailscale.js'

// ---------------- KPI 持久化（2026-08-17 从浏览器 localStorage 迁移至服务端） ----------------
// 每个运营经纪人的双 KPI 目标（totalKpi / offlineKpi）+ 卡片布局（order / hidden）统一落服务端，
// 解决「清缓存 / 换浏览器 / 换域名」导致 KPI 丢失、且多端不同步的问题。
const KPI_FILE = path.join(DATA_DIR, 'kpi.json')
function loadKpi() {
  try {
    if (fs.existsSync(KPI_FILE)) {
      const obj = JSON.parse(fs.readFileSync(KPI_FILE, 'utf-8'))
      return {
        map: obj.map && typeof obj.map === 'object' ? obj.map : {},
        layout: {
          order: Array.isArray(obj.layout?.order) ? obj.layout.order : [],
          hidden: Array.isArray(obj.layout?.hidden) ? obj.layout.hidden : [],
        },
        updatedAt: obj.updatedAt || null,
      }
    }
  } catch { /* ignore */ }
  return { map: {}, layout: { order: [], hidden: [] }, updatedAt: null }
}
function saveKpi(kpi) {
  const payload = {
    map: kpi.map && typeof kpi.map === 'object' ? kpi.map : {},
    layout: {
      order: Array.isArray(kpi.layout?.order) ? kpi.layout.order : [],
      hidden: Array.isArray(kpi.layout?.hidden) ? kpi.layout.hidden : [],
    },
    updatedAt: new Date().toISOString(),
  }
  atomicWriteSync(KPI_FILE, JSON.stringify(payload, null, 2))
}

function readVersion() {
  try {
    const p = path.join(ROOT, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'))
    let buildTime = ''
    let gitCommit = ''
    try {
      const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'version.json'), 'utf-8'))
      buildTime = v.buildTime || ''
      gitCommit = v.gitCommit || ''
    } catch { /* ignore */ }
    return { version: pkg.version || '0.0.0', name: pkg.name || 'streamer-dashboard', buildTime, gitCommit }
  } catch {
    return { version: '0.0.0', name: 'streamer-dashboard', buildTime: '', gitCommit: '' }
  }
}

/**
 * 自我净化：剥离外部注入的 NODE_OPTIONS，再在干净环境里重启自身。
 *
 * 背景（2026-08-14 数据停更事故根因）：
 * 某些宿主（如 AI 编辑器的沙箱终端）会注入 `NODE_OPTIONS=--require=...safe-delete...`，
 * 该钩子会 hook fs 的写入/删除调用，并按「单会话累计操作次数」做阈值保护（超过约 50 次即全部拒绝）。
 * 本服务每 20 分钟抓一次、每次都要写 today.json / latest.json / state.json 并清理临时文件，
 * 运行数小时后必然击穿阈值，此后所有写盘一律返回 `EPERM: operation not permitted`，
 * 表现为「抓取正常、下载正常，但数据永远停在某个时间点」——正是本次故障现象。
 *
 * 因此：只要检测到这类注入，就用同样的参数在干净环境重新拉起自己，父进程退出码与子进程一致
 * （不影响任何外层看门狗语义）。
 */
if (!process.env.STREAMER_CLEAN_ENV && /safe-delete|genie-safe/i.test(process.env.NODE_OPTIONS || '')) {
  const cleanEnv = { ...process.env, STREAMER_CLEAN_ENV: '1' }
  delete cleanEnv.NODE_OPTIONS
  console.log('[server] 检测到外部注入的 NODE_OPTIONS 文件钩子（会拦截写盘并导致 EPERM 数据停更），正在干净环境中重启自身...')
  const r = spawnSync(process.execPath, process.argv.slice(1), { env: cleanEnv, stdio: 'inherit' })
  process.exit(typeof r.status === 'number' ? r.status : 0)
}

loadState()

// 清理上次异常退出遗留的原子写临时文件（多实例抢写时 rename/unlink 均被拒绝，会持续堆积大文件）
try {
  const cleaned = cleanStaleTmp(DATA_DIR)
  if (cleaned.count > 0) {
    log(`[启动清理] 清除 ${cleaned.count} 个遗留临时文件，释放 ${(cleaned.bytes / 1024 / 1024).toFixed(1)} MB`)
  }
} catch { /* ignore */ }

// 管理员口令：首次启动若未配置则自动生成随机值并持久化到 config.json，同时打印到启动日志
if (!config.adminToken) {
  config.adminToken = crypto.randomBytes(16).toString('hex')
  saveConfig({ adminToken: config.adminToken })
  log(`[admin] 管理员口令已生成并保存到 server/config.json：${config.adminToken}`)
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// gzip 压缩中间件：对 JSON 接口响应按需压缩，大幅降低经 Cloudflare 隧道传输 15MB 全量数据时的慢加载/卡顿。
// 浏览器 / fetch 默认带 Accept-Encoding: gzip 并自动解码；<1KB 的小响应不压缩以避免额外开销。
app.use((req, res, next) => {
  if (!(req.headers['accept-encoding'] || '').includes('gzip')) return next()
  const origJson = res.json.bind(res)
  res.json = (body) => {
    const raw = JSON.stringify(body)
    if (raw.length < 1024) return origJson(body)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Encoding', 'gzip')
    res.removeHeader('Content-Length')
    res.end(zlib.gzipSync(raw))
    return res
  }
  next()
})

// 看板数据接口 / 数据源禁用缓存：避免经 Cloudflare 隧道、手机浏览器或中间代理缓存，
// 导致多端（手机 / 电脑）数据不同步、必须手动刷新才能看到更新。
function setNoCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
}
app.use('/api', setNoCache)
app.use('/streamer_data.json', setNoCache)

// 管理员口令校验：所有写接口（POST）必须携带正确的 x-admin-token 头，否则返回 401
// 只读接口（/api/status、/api/data、/api/version）不受影响，分享链接的他人仍可查看数据
function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-token'] || req.query.token
  if (provided && provided === config.adminToken) return next()
  return res.status(401).json({ ok: false, error: '需要管理员口令', needAuth: true })
}

// ---------------- API ----------------

app.get('/api/version', (_req, res) => {
  res.json({ ok: true, ...readVersion() })
})

app.get('/api/status', async (req, res) => {
  let login = { loggedIn: state.loggedIn, uname: state.uname }
  if (req.query.check === '1') {
    login = await checkLogin()
    state.loggedIn = login.loggedIn
    state.uname = login.uname
  }
  res.json({
    ok: true,
    loggedIn: login.loggedIn,
    uname: login.uname,
    running: state.running,
    lastToday: state.lastToday,
    lastYesterday: state.lastYesterday,
    lastError: state.lastError,
    lastCount: state.lastCount,
    lastSyncAt: state.lastSyncAt,
    needsLogin: state.needsLogin,
    alert: state.alert,
    history: state.history.slice(0, 10),
    cronToday: config.cronToday,
    cronYesterday: config.cronYesterday,
    cronYesterdayFinal: config.cronYesterdayFinal,
    targetUrl: config.targetUrl,
    headless: config.headless,
    chromePath: config.chromePath,
    schedule: scheduleOverview(state),
    lastCatchUp: state.lastCatchUp || null,
    lastCatchUpAt: state.lastCatchUpAt || null,
    lastByDate: state.lastByDate || null,
  })
})

/** 当前告警（供前端横幅 / 外部监控读取） */
app.get('/api/alerts', (_req, res) => {
  const now = Date.now()
  const lastTodayMs = state.lastToday ? new Date(state.lastToday).getTime() : 0
  const staleHours = lastTodayMs ? Math.max(0, (now - lastTodayMs) / 3600_000) : null
  res.json({
    ok: true,
    alert: state.alert,
    needsLogin: state.needsLogin,
    lastToday: state.lastToday,
    staleHours: staleHours === null ? null : Number(staleHours.toFixed(2)),
  })
})

app.post('/api/login', requireAdmin, async (_req, res) => {
  try {
    await openLoginWindow()
    res.json({ ok: true, message: '已打开浏览器窗口，请扫码登录，登录成功后可关闭该窗口' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/login/done', requireAdmin, async (_req, res) => {
  await closeContext()
  const login = await checkLogin()
  state.loggedIn = login.loggedIn
  state.uname = login.uname
  if (login.loggedIn) {
    // 登录恢复 → 清除登录类告警，并立即触发一次补跑，让榜单尽快刷新（无需等下一个 cron 周期）
    clearAlerts()
    log('[login] 登录恢复，立即触发补跑以刷新数据')
    runCatchUp(fetchWrapper, state, saveState).catch(e => log(`[login] 补跑异常: ${e.message}`))
  } else {
    raiseAlert('login', 'B站登录会话已失效，数据抓取已暂停。请在「数据自动同步」页点击【扫码登录B站】重新登录，登录成功后系统会自动恢复抓取与榜单更新。')
  }
  res.json({ ok: true, ...login })
})

app.post('/api/fetch', requireAdmin, async (req, res) => {
  const type = req.query.type === 'yesterday' ? 'yesterday' : 'today'
  try {
    // 昨日统一走「按日期精确补抓」，绕过 B站「昨日」页签（文案匹配不稳定，点不到会静默降级成"今日"周期）
    const result = type === 'yesterday' ? await fetchYesterdayFinal() : await fetchData(type)
    res.json(result)
  } catch (e) {
    log(`[api/fetch] 未捕获异常: ${e.message}`)
    res.status(500).json({ ok: false, type, error: e.message || '抓取服务异常' })
  }
})

/** 手动触发一次「错过任务」检查与补跑（服务启动时会自动执行一次） */
app.post('/api/catchup', requireAdmin, async (req, res) => {
  try {
    const result = await runCatchUp(fetchWrapper, state, saveState, { force: req.query.force === '1' })
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/**
 * 补抓「指定日期」的历史数据（B站后台数据窗口通常为近 7 天）。
 * 仅覆盖该日记录（按 房间号::日期 键合并），不影响其他日期数据。
 */
app.post('/api/fetch-date', requireAdmin, async (req, res) => {
  const dateStr = req.body?.date || req.query.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
    return res.status(400).json({ ok: false, error: '请提供 date 参数，格式 YYYY-MM-DD' })
  }
  try {
    const result = await fetchDataByDate(dateStr)
    res.json(result)
  } catch (e) {
    log(`[api/fetch-date] 未捕获异常: ${e.message}`)
    res.status(500).json({ ok: false, date: dateStr, error: e.message || '补抓服务异常' })
  }
})

app.get('/api/data', (req, res) => {
  const type = ['today', 'yesterday', 'latest'].includes(req.query.type) ? req.query.type : 'latest'
  const data = readData(type)
  if (!data) return res.status(404).json({ ok: false, error: `暂无 ${type} 数据，请先执行一次抓取` })
  res.json(data)
})

// ---------------- 主播名册（线下主播 / 在职状态 / 赛道等持久化） ----------------
// 只读：看板前端加载名册，作为 在职状态 / 赛道 / 线下主播 标记的权威来源（覆盖浏览器 localStorage）
app.get('/api/roster', (_req, res) => {
  res.json({ ok: true, ...loadRoster() })
})

// 写：合并补丁（offlineRooms / status / extra / tracks）。仅管理员可写。
app.post('/api/roster', requireAdmin, (req, res) => {
  try {
    const cur = loadRoster()
    const patch = req.body || {}
    if (Array.isArray(patch.offlineRooms)) {
      cur.offlineRooms = Array.from(new Set(patch.offlineRooms.map(String)))
    }
    if (patch.status && typeof patch.status === 'object') {
      for (const [room, v] of Object.entries(patch.status)) {
        cur.status[String(room)] = {
          status: v.status === '离职' ? '离职' : '在职',
          reason: v.reason != null ? String(v.reason) : '',
          leaveDate: v.leaveDate != null ? String(v.leaveDate) : '',
        }
      }
    }
    if (patch.extra && typeof patch.extra === 'object') {
      for (const [room, v] of Object.entries(patch.extra)) {
        cur.extra[String(room)] = { ...(cur.extra[String(room)] || {}), ...v }
      }
    }
    if (patch.tracks && typeof patch.tracks === 'object') {
      for (const [room, v] of Object.entries(patch.tracks)) {
        cur.tracks[String(room)] = v
      }
    }
    const saved = saveRoster(cur)
    res.json({ ok: true, updatedAt: saved.updatedAt, roster: saved })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 线下主播名册 · 导入 + 模板强校验 + 回滚 ----------------
// 批量导入（带模板强校验与批次快照）。任一校验不通过则整表拒绝、零写入。
app.post('/api/roster/import', requireAdmin, async (req, res) => {
  try {
    let headers = req.body?.headers
    let rows = req.body?.rows
    // 兼容：直接传 base64 文件，由服务端解析为 headers+rows 后再校验
    if (req.body?.fileBase64 && (!Array.isArray(headers) || !Array.isArray(rows))) {
      const tmp = path.join(DATA_DIR, `import-${Date.now()}.xlsx`)
      fs.writeFileSync(tmp, Buffer.from(req.body.fileBase64, 'base64'))
      try {
        const wb = XLSX.read(tmp, { type: 'buffer' })
        const sheetName = wb.SheetNames.find((n) => /主播|anchor|数据|导入|模板/i.test(n)) || wb.SheetNames[0]
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false })
        headers = (aoa[0] || []).map((h) => String(h ?? '').trim())
        rows = aoa.slice(1).map((arr) => {
          const obj = {}
          headers.forEach((h, i) => { obj[h] = arr[i] ?? '' })
          return obj
        })
      } finally {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      }
    }
    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      return res.status(400).json({ ok: false, error: '缺少 headers/rows 或 fileBase64' })
    }
    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: '文件中没有数据行' })
    }

    const v = validateRosterTemplate(headers, rows)
    if (!v.ok) {
      return res.status(422).json({
        ok: false,
        message: `模板校验未通过（共 ${v.errors.length} 处问题），已整表拒绝，未写入任何数据`,
        errors: v.errors,
      })
    }

    // 导入前快照（回滚来源）
    const prev = snapshotRoster()
    const { roster, summary } = mergeRosterImport(v.normalized)
    const batch = {
      batchId: genBatchId(),
      at: new Date().toISOString(),
      operator: 'admin',
      fileName: String(req.body?.fileName || '线下主播导入.xlsx'),
      rowCount: v.normalized.length,
      summary,
      prev,
    }
    appendBatch(batch)
    log(`[roster/import] 批次 ${batch.batchId} 导入成功：新增 ${summary.added} / 更新 ${summary.updated} / 影响房间 ${summary.affectedRooms.length}`)
    res.json({ ok: true, batchId: batch.batchId, summary, roster })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 列出导入批次（含回滚快照标记）与回滚日志，供管理端回滚入口
app.get('/api/roster/batches', requireAdmin, (_req, res) => {
  try {
    const batches = loadHistory()
      .slice()
      .reverse()
      .map((b) => ({
        batchId: b.batchId,
        at: b.at,
        operator: b.operator,
        fileName: b.fileName,
        rowCount: b.rowCount,
        summary: b.summary,
        canRollback: !!b.prev,
      }))
    const rollbacks = loadRollbackLog().slice().reverse()
    res.json({ ok: true, batches, rollbacks })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 按批次号回滚：用导入前快照整体还原名册（覆盖写，单次原子），并记录回滚日志
app.post('/api/roster/rollback', requireAdmin, (req, res) => {
  try {
    const batchId = req.body?.batchId
    if (!batchId) return res.status(400).json({ ok: false, error: '缺少 batchId' })
    const batch = findBatch(batchId)
    if (!batch) return res.status(404).json({ ok: false, error: '未找到该导入批次' })
    if (!batch.prev) return res.status(409).json({ ok: false, error: '该批次无导入前快照，无法回滚' })

    const before = loadRoster()
    // 失败回退保障：还原失败（写盘异常）时，before 即当前名册未被改动，可重试
    const restored = restoreRoster(batch.prev)
    const after = loadRoster()

    // 回滚前后条数校验
    const beforeCount = before.offlineRooms.length
    const afterCount = after.offlineRooms.length
    const entry = {
      rollbackId: genRollbackId(),
      batchId,
      at: new Date().toISOString(),
      operator: 'admin',
      revertedTo: batch.at,
      before: { rooms: beforeCount },
      after: { rooms: afterCount },
    }
    appendRollbackLog(entry)
    log(`[roster/rollback] 已回滚批次 ${batchId}：房间数 ${beforeCount} -> ${afterCount}`)
    res.json({ ok: true, rollback: entry, before: { rooms: beforeCount }, after: { rooms: afterCount }, roster: restored })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 暑期挑战赛 · 对外分享链接 ----------------
// 创建分享链接（管理员）：返回带 token 的公网链接与有效期
app.post('/api/challenge/share', requireAdmin, (req, res) => {
  try {
    const hours = Number(req.body?.expiresInHours) || 168
    const label = String(req.body?.label || '')
    const entry = createShare({ label, expiresInHours: hours })
    const base = `${req.protocol}://${req.get('host')}`
    res.json({
      ok: true,
      token: entry.token,
      url: `${base}/share.html?token=${entry.token}`,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 查看已创建的分享链接（管理员）
app.get('/api/challenge/shares', requireAdmin, (_req, res) => {
  res.json({ ok: true, shares: listShares() })
})

// 撤销分享链接（管理员）
app.delete('/api/challenge/share', requireAdmin, (req, res) => {
  const token = req.query.token || req.body?.token
  const ok = revokeShare(token)
  res.json({ ok, revoked: ok })
})

// 对外分享榜单（公开，仅需有效 token；数据范围仅限本周）
app.get('/api/challenge/board', (req, res) => {
  const token = req.query.token
  const share = getValidShare(token)
  if (!share) return res.status(401).json({ ok: false, error: '链接无效或已过期' })
  try {
    const board = computeCurrentWeekBoard()
    if (!board) return res.status(404).json({ ok: false, error: '暂无本周榜单数据' })
    const now = Date.now()
    const lastTodayMs = state.lastToday ? new Date(state.lastToday).getTime() : 0
    const staleHours = lastTodayMs ? (now - lastTodayMs) / 3600_000 : null
    // 元信息：供分享页 / 看板判断数据是否过期或抓取是否已暂停，及时给出可见提示
    const meta = {
      needsLogin: state.needsLogin,
      alert: state.alert,
      lastToday: state.lastToday,
      dataGeneratedAt: board.dataGeneratedAt,
      staleHours: staleHours === null ? null : Number(staleHours.toFixed(2)),
      paused: state.needsLogin || (staleHours !== null && staleHours >= 3),
    }
    res.json({ ok: true, share: { label: share.label, expiresAt: share.expiresAt }, board, meta })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 实时推送（SSE）：数据变更时主动推送给所有连接的看板 / 分享页 ----------------
// 解决多端不同步问题：手机端 / 电脑端无需手动刷新，数据一变更即刻收到推送并刷新。
const sseClients = new Set()

function broadcastDataChanged(meta = {}) {
  const payload = `event: data-updated\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...meta })}\n\n`
  for (const res of sseClients) {
    try { res.write(payload) } catch { sseClients.delete(res) }
  }
}

// 数据变更（抓取 / 导入 / 清空）→ 触发推送
bus.on('data-changed', (meta) => broadcastDataChanged(meta || {}))

// 告警变更（登录失效 / 抓取异常 / 数据过期）→ 触发推送，前端据此展示横幅
function broadcastAlert(alert) {
  const payload = `event: alert\ndata: ${JSON.stringify(alert || null)}\n\n`
  for (const res of sseClients) {
    try { res.write(payload) } catch { sseClients.delete(res) }
  }
}
bus.on('alert', (alert) => broadcastAlert(alert || null))

// 运营团队变动（新增 / 减少 / 批量调整）→ 触发精准推送，前端「运营团队变动」页据此即时刷新
function broadcastOpsTeam(meta = {}) {
  const payload = `event: ops-team\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...meta })}\n\n`
  for (const res of sseClients) {
    try { res.write(payload) } catch { sseClients.delete(res) }
  }
}
bus.on('ops-team-changed', (meta) => broadcastOpsTeam(meta || {}))

// 外网隧道地址更新（地址变更 → 前端弹窗提示最新外网地址）
function broadcastTunnel(meta = {}) {
  const payload = `event: tunnel-updated\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...meta })}\n\n`
  for (const res of sseClients) {
    try { res.write(payload) } catch { sseClients.delete(res) }
  }
}
bus.on('tunnel-updated', (meta) => broadcastTunnel(meta || {}))

// 变更记录更新（手动登记密码 / 其他；前端历史页据此刷新）
function broadcastChangelog(meta = {}) {
  const payload = `event: changelog-updated\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...meta })}\n\n`
  for (const res of sseClients) {
    try { res.write(payload) } catch { sseClients.delete(res) }
  }
}
bus.on('changelog-updated', (meta) => broadcastChangelog(meta || {}))

// KPI（运营经纪人双 KPI 目标 + 卡片布局）：服务端持久化，跨设备 / 清缓存不丢
app.get('/api/kpi', (_req, res) => {
  res.json({ ok: true, ...loadKpi() })
})
app.post('/api/kpi', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const map = {}
    if (body.map && typeof body.map === 'object') {
      for (const [agent, cfg] of Object.entries(body.map)) {
        map[agent] = {
          totalKpi: Number(cfg?.totalKpi) || 0,
          offlineKpi: Number(cfg?.offlineKpi) || 0,
        }
      }
    }
    const layout = {
      order: Array.isArray(body.layout?.order) ? body.layout.order : [],
      hidden: Array.isArray(body.layout?.hidden) ? body.layout.hidden : [],
    }
    saveKpi({ map, layout })
    res.json({ ok: true, map, layout, updatedAt: loadKpi().updatedAt })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 入退会招募统计（B站后台「主播管理-入退会管理-入会管理-近7日」）
// GET 支持 ?range=7days|30days|thisMonth|all（默认 thisMonth），基于 archive 实时聚合，无需重新抓取
app.get('/api/union-recruit-stats', (req, res) => {
  const range = ['7days', '30days', 'thisMonth', 'all'].includes(req.query.range) ? req.query.range : 'thisMonth'
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null
  try {
    const result = aggregateRecruitStats(range, month)
    // 如果 archive 为空，给出友好提示但返回 ok:false，方便前端引导同步
    if (result.totalJoined === 0 && result.archiveTotal === 0) {
      return res.json({ ok: false, error: '暂无统计结果，请先执行抓取', ...result })
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// POST 触发 B站 抓取并合并到 archive；body 可传 { range: '7days'|'30days'|'thisMonth'|'all' }
app.post('/api/union-recruit-stats', requireAdmin, async (req, res) => {
  const range = ['7days', '30days', 'thisMonth', 'all'].includes(req.body?.range) ? req.body.range : '7days'
  const result = await runUnionRecruitStats({ closeBrowser: false, range })
  res.json(result)
})

// ---------------- 主播数据同步移除 ----------------
// 预览：返回疑似已移除房间清单与可立即移除清单（只读，无需鉴权）
app.get('/api/removed-rooms', (req, res) => {
  try {
    res.json(previewRemovedRooms())
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// 执行移除：body { force?, rooms? }。force=忽略宽限期；rooms=仅移除指定房间（定向/遗留清理）
app.post('/api/removed-rooms', requireAdmin, (req, res) => {
  try {
    const { force, rooms } = req.body || {}
    const result = pruneRemovedRooms({ force: !!force, rooms: Array.isArray(rooms) ? rooms : null })
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// 从备份恢复指定房间数据
app.post('/api/removed-rooms/restore', requireAdmin, (req, res) => {
  try {
    const { rooms } = req.body || {}
    if (!Array.isArray(rooms) || !rooms.length) {
      return res.status(400).json({ ok: false, error: '请指定要恢复的房间号数组' })
    }
    res.json(restoreRemovedRooms(rooms))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// 已移除备份列表（供前端移除同步面板展示）
app.get('/api/removed-rooms/backup', (req, res) => {
  try {
    res.json(listRemovedRooms())
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 运营月度数据统计与分析 ----------------
// GET 返回每个运营 × 每个自然月的完整统计、环比与主要变化标注
app.get('/api/operator-monthly-stats', (req, res) => {
  try {
    const force = req.query.force === '1'
    res.json(aggregateOperatorMonthlyStats({ force }))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET 单运营 × 两月的主播级环比拆解：筛出环比变化 > 阈值(默认20%) 的具体主播
app.get('/api/operator-monthly-streamers', (req, res) => {
  try {
    const { operator, monthA, monthB, threshold } = req.query
    const result = getOperatorStreamerCompare(operator, monthA, monthB, threshold ? Number(threshold) : 10)
    if (!result.ok) { res.status(400).json(result); return }
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 主播周期流水 ----------------
// GET 线下主播房间号 + 昵称列表（供前端选择器）
app.get('/api/streamer-cycle-flow/rooms', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.json(getOfflineStreamerRooms())
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET 单个主播按「首次开播日」划分的 30 天周期流水（第一/二/三周期）
app.get('/api/streamer-cycle-flow', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    const { room, refDate } = req.query
    if (!room) { res.status(400).json({ ok: false, error: '缺少 room 参数' }); return }
    res.json(getStreamerCycleFlow(room, refDate))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})


// GET 所有线下主播周期流水一览（总览表用），含在职/离职状态与离职日期
app.get('/api/streamer-cycle-flow/summary', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    const { refDate } = req.query
    res.json(getStreamerCycleFlowSummary(refDate))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 运营团队变动实时同步 ----------------
// GET 返回花名册聚合：在职人数 / 团队结构 / 绩效汇总 / 变动记录 / 宽限期候选
app.get('/api/ops-team', (req, res) => {
  try {
    const force = req.query.force === '1'
    res.json(getOpsTeamSummary({ force }))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// GET 返回完整变动记录（只读）
app.get('/api/ops-team/changelog', (req, res) => {
  try {
    const data = getOpsTeamSummary()
    res.json({ ok: true, entries: data.changelog, headcount: data.headcount, changes: data.changes })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// POST 立即触发一次自动同步检测（管理员；?force=1 忽略宽限期，把当前不在册在职人员立即标记离职）
app.post('/api/ops-team/sync', requireAdmin, (req, res) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true
    res.json(syncOpsTeam({ force }))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// POST 批量调整运营人员（管理员；body { add:[...], remove:[...] } 支持数组或逗号/换行分隔字符串）
app.post('/api/ops-team/batch', requireAdmin, (req, res) => {
  try {
    const { add, remove } = req.body || {}
    const result = batchAdjustOpsTeam({ add, remove, by: 'admin' })
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 运营 KPI 月度结算 ----------------
// 每个自然月过完后，按 kpi.json 中设置的目标自动汇总每位运营的完成情况。
// GET  返回已归档月份（冻结快照）+ 当月实时预览
app.get('/api/kpi-monthly', (req, res) => {
  try {
    res.json(getKpiMonthlySummary())
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
// POST 手动触发结算（管理员；body { month?: '2026-08', months?: [...], force?: true }）
// force=true 会重算已冻结的历史月份；不带 month/months 则结算所有已过完且未冻结的月份。
app.post('/api/kpi-monthly/settle', requireAdmin, (req, res) => {
  try {
    const { month, months, force } = req.body || {}
    const target = month ? [month] : (Array.isArray(months) ? months : null)
    res.json(settleKpiMonths({ force: force === true, months: target }))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 外网地址变更记录 ----------------
// 当前最新外网地址（隧道地址变更后实时可用，不再需要去 tunnel.log 里 grep）
app.get('/api/tunnel/current', (_req, res) => {
  res.json({ ok: true, ...getCurrentTunnel() })
})

// 变更历史（支持 ?from=ISO&to=ISO&limit=N 按时间查询）
app.get('/api/tunnel/history', (req, res) => {
  const { from, to, limit } = req.query
  res.json({
    ok: true,
    list: getTunnelHistory({ from: from || undefined, to: to || undefined, limit: limit ? Number(limit) : undefined }),
  })
})

// 手动登记关键信息变更（管理员密码 / 其他），需管理员口令
app.post('/api/tunnel/note', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const allowed = ['tunnel', 'password', 'other']
    const type = allowed.includes(body.type) ? body.type : 'other'
    const entry = addManualEntry({ type, value: body.value || '', note: body.note || '' })
    res.json({ ok: true, entry })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Tailscale 虚拟组网访问状态（手机登录同一账号后直接访问 8787）
app.get('/api/tailscale', (_req, res) => {
  try {
    res.json({ ok: true, ...getTailscaleStatus() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 关闭代理缓冲，保证 SSE 实时（Cloudflare / NGINX）
  res.flushHeaders?.()
  res.write('retry: 3000\n\n')
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25000)
  sseClients.add(res)
  req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res) })
})

app.post('/api/config', requireAdmin, (req, res) => {
  try {
    const allow = [
      'targetUrl', 'recruitUrl', 'headless', 'cronToday', 'cronYesterday', 'cronYesterdayFinal', 'cronRecruit7Days', 'chromePath', 'selectors',
      'catchUpMissed', 'catchUpMaxAgeHours', 'catchUpGraceMinutes',
    ]
    const patch = {}
    allow.forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k] })
    saveConfig(patch)
    setupCron()
    startCatchUpWatchdog()
    res.json({ ok: true, config: { ...config } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 把 records 写入 latest.json 并同步到 public/dist */
function writeDataset(records) {
  const payload = JSON.stringify(records, null, 2)
  const latestFile = path.join(DATA_DIR, 'latest.json')
  atomicWriteSync(latestFile, payload)
  const publicFile = path.join(ROOT, 'public', 'streamer_data.json')
  atomicWriteSync(publicFile, payload)
  const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
  if (fs.existsSync(distFile)) {
    atomicWriteSync(distFile, payload)
  }
  try { syncFirstBroadcast() } catch (e) { log('[firstBroadcast] sync failed: ' + e.message) }
  state.lastCount = records.length
  state.lastSyncAt = new Date().toISOString()
  saveState()
  bus.emit('data-changed', { type: 'import' })
}

function checkRecords(records) {
  const rooms = new Set(records.map(r => String(r['房间号'] || '')).filter(Boolean))
  const revenue = records.reduce((s, r) => {
    const v = Number(r['总流水（元）'])
    return s + (Number.isNaN(v) ? 0 : v)
  }, 0)
  const seaCount = records.reduce((s, r) => {
    const v = Number(r['大航海人数'])
    return s + (Number.isNaN(v) ? 0 : v)
  }, 0)
  const dates = records.map(r => r['统计结束日期'] || r['统计日期'] || '').filter(Boolean).sort()
  const dateRange = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '未知'
  const warnings = []
  const badRevenue = records.filter(r => Number(r['总流水（元）']) < 0).length
  const missingRoom = records.filter(r => !String(r['房间号'] || '').trim()).length
  if (badRevenue) warnings.push(`${badRevenue} 条记录流水为负`)
  if (missingRoom) warnings.push(`${missingRoom} 条记录缺少房间号`)
  return {
    summary: `${records.length} 条 / ${rooms.size} 房间 / 统计 ${dateRange} / 流水 ¥${revenue.toFixed(2)} / 大航海 ${seaCount}`,
    count: records.length,
    roomCount: rooms.size,
    revenue,
    seaCount,
    dateRange,
    warnings,
  }
}

/** 导入 Excel（完整替换旧数据）。前端传 base64，由服务端解析器归一化，保证字段映射/统计日期与抓取数据一致 */
app.post('/api/import', requireAdmin, (req, res) => {
  try {
    let records = []
    if (req.body.fileBase64) {
      const tmp = path.join(DATA_DIR, `import-${Date.now()}.xlsx`)
      fs.writeFileSync(tmp, Buffer.from(req.body.fileBase64, 'base64'))
      try {
        records = parseWorkbook(tmp).records
      } finally {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      }
    } else if (Array.isArray(req.body.records)) {
      records = req.body.records
    }
    if (!records.length) throw new Error('未解析到任何记录（请确认上传的是 B站导出的主播数据 xlsx）')
    writeDataset(records)
    log(`[import] 已清空并完整替换导入 ${records.length} 条记录`)
    res.json({ ok: true, count: records.length, check: checkRecords(records) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 清空并重新导入 8月1日~8月7日历史数据（读取桌面固定文件） */
app.post('/api/reimport-history', requireAdmin, (req, res) => {
  try {
    const filePath = req.body.filePath || 'C:\\Users\\Administrator\\Desktop\\线下主播看板\\主播数据_2026.8.1-2026.8.7.xlsx'
    if (!fs.existsSync(filePath)) throw new Error('找不到历史数据文件：' + filePath)
    const { records } = parseWorkbook(filePath)
    if (!records.length) throw new Error('历史数据文件解析结果为空')
    writeDataset(records)
    log(`[reimport] 已清空并重新导入历史数据 ${records.length} 条，来自 ${filePath}`)
    res.json({ ok: true, count: records.length, check: checkRecords(records) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 历史月份导入（2026-09-07 新增） ----------------
// 系统最早的数据是 8/10，7 月完全缺失。历史数据有两种形态，导入器自动识别并分流：
//   A. 按日明细（一天一条）  → 合并进 latest.json，键 房间号::日期，能还原月内运营变更
//   B. 整月区间（一行一主播）→ 写入 monthly_snapshot.json，运营取导出时刻的归属
// 两种都不会与现有数据重复计数：同一月份若已有按日明细，统计时就不会再叠加快照。

/** 已导入的月度快照概览 */
app.get('/api/month-import/snapshots', requireAdmin, (_req, res) => {
  res.json({ ok: true, months: snapshotSummary(), snapshotMonths: listSnapshotMonths() })
})

/** 导入某月数据：支持服务器路径 / base64 上传 / dryRun 预检 */
app.post('/api/month-import', requireAdmin, (req, res) => {
  try {
    const r = importMonth({
      filePath: req.body.filePath,
      fileBase64: req.body.fileBase64,
      fileName: req.body.fileName,
      month: req.body.month,
      statStart: req.body.statStart,
      statEnd: req.body.statEnd,
      useAssignment: req.body.useAssignment !== false,
      markSeaMissing: req.body.markSeaMissing === undefined ? 'auto' : req.body.markSeaMissing,
      offlineRooms: req.body.offlineRooms,
      dryRun: !!req.body.dryRun,
      note: req.body.note || '',
    })
    if (!r.dryRun) bus.emit('data-updated', { type: 'month-import', month: r.month })
    res.json(r)
  } catch (e) {
    log(`[api/month-import] ${e.message}`)
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 校验某月：系统内汇总 vs 源导入合计 vs 明细逐条求和，三者必须一致 */
app.get('/api/month-import/verify', requireAdmin, (req, res) => {
  try {
    res.json(verifyMonth(req.query.month || req.query.m))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 删除某月数据（includeDaily=1 时连 latest 里的按日记录一起删） */
app.delete('/api/month-import', requireAdmin, (req, res) => {
  try {
    const r = purgeMonth(req.body.month || req.query.month, {
      includeDaily: !!(req.body.includeDaily || req.query.includeDaily === '1'),
    })
    bus.emit('data-updated', { type: 'month-purge', month: r.month })
    res.json({ ok: true, ...r })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 主播 × 运营 归属关系表（带生效 / 失效时间） ----------------
// 用于「整月区间导入」无法还原月内变更时的兜底：按 房间号 + 生效区间 覆盖归属。
app.get('/api/operator-assignment', requireAdmin, (_req, res) => {
  res.json({ ok: true, entries: assignment.listEntries() })
})
app.post('/api/operator-assignment', requireAdmin, (req, res) => {
  try {
    const entry = assignment.setEntry(req.body || {})
    bus.emit('data-updated', { type: 'operator-assignment' })
    res.json({ ok: true, entry })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})
app.delete('/api/operator-assignment', requireAdmin, (req, res) => {
  try {
    const r = assignment.removeEntry(req.body.room || req.query.room, req.body.from || req.query.from)
    bus.emit('data-updated', { type: 'operator-assignment' })
    res.json({ ok: true, ...r })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})
/** 批量导入归属（整表替换）：rows = [{房间号, 运营, 生效日期, 失效日期, 备注}] */
app.post('/api/operator-assignment/bulk', requireAdmin, (req, res) => {
  try {
    const r = assignment.bulkReplace(req.body.rows || req.body.entries || [])
    bus.emit('data-updated', { type: 'operator-assignment' })
    res.json({ ok: true, ...r })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

/** 按月逐日补抓：B站后台仍可查到该月时可用，能完整还原归属变更（长任务，异步执行） */
app.post('/api/backfill-month', requireAdmin, (req, res) => {
  const month = String(req.body.month || req.query.month || '')
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ ok: false, error: 'month 应为 YYYY-MM' })
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  res.json({ ok: true, started: true, month, days, note: '已开始逐日补抓，进度见服务端日志 [backfill]' })
  ;(async () => {
    const results = []
    for (let d = 1; d <= days; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`
      try {
        const r = await fetchDataByDate(dateStr)
        results.push({ date: dateStr, ok: !!r?.ok, count: r?.count || 0, error: r?.error || '' })
        log(`[backfill] ${month} ${d}/${days} ${dateStr} ${r?.ok ? '成功 ' + (r.count || 0) + ' 条' : '失败 ' + (r?.error || '')}`)
      } catch (e) {
        results.push({ date: dateStr, ok: false, error: e.message })
        log(`[backfill] ${month} ${d}/${days} ${dateStr} 异常 ${e.message}`)
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    const okCount = results.filter(x => x.ok).length
    log(`[backfill] ${month} 完成：成功 ${okCount}/${days} 天，失败 ${results.filter(x => !x.ok).map(x => x.date).join(',') || '无'}`)
  })()
})

/** 清空全部数据（仅清数据，绝不触碰登录态 / 浏览器上下文 / 本地 profile） */
app.post('/api/clear', requireAdmin, (_req, res) => {
  try {
    const latestFile = path.join(DATA_DIR, 'latest.json')
    atomicWriteSync(latestFile, '[]')
    const publicFile = path.join(ROOT, 'public', 'streamer_data.json')
    atomicWriteSync(publicFile, '[]')
    const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
    if (fs.existsSync(distFile)) atomicWriteSync(distFile, '[]')
    // 同时清空按日抓取产物，确保系统中不再残留任何主播记录
    for (const t of ['today', 'yesterday']) {
      const f = path.join(DATA_DIR, `${t}.json`)
      if (fs.existsSync(f)) atomicWriteSync(f, '[]')
    }
    // 仅重置数据相关计数；loggedIn / uname 等登录态一律保留
    state.lastCount = 0
    state.lastToday = null
    state.lastYesterday = null
    state.lastError = null
    state.lastSyncAt = new Date().toISOString()
    saveState()
    log('[clear] 已清空全部主播数据（登录态保持不变）')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ---------------- 静态站点 ----------------
const distDir = path.join(ROOT, 'dist')
if (fs.existsSync(distDir)) {
  // 全量数据文件单独走 gzip：15MB 经隧道传输 gzip 后约 1.5MB，避免主界面加载缓慢/卡顿。
  // 浏览器 / fetch 默认带 Accept-Encoding: gzip 并自动解码，无需前端改动。
  app.get('/streamer_data.json', (req, res, next) => {
    const file = path.join(distDir, 'streamer_data.json')
    if (!fs.existsSync(file)) return next()
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    if (!(req.headers['accept-encoding'] || '').includes('gzip')) {
      return res.sendFile(file)
    }
    try {
      const buf = fs.readFileSync(file)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Encoding', 'gzip')
      res.removeHeader('Content-Length')
      res.end(zlib.gzipSync(buf))
    } catch {
      res.sendFile(file)
    }
  })

  app.use(express.static(distDir, {
    maxAge: 0,
    setHeaders(res, filePath) {
      // streamer_data.json 是看板核心数据源，严禁被浏览器 / 代理缓存，否则多端不同步
      if (filePath.endsWith('streamer_data.json')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
    },
  }))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

// ---------------- 定时任务 ----------------
let jobToday = null
let jobYesterday = null
let jobYesterdayFinal = null
let jobRecruit = null
let jobKpiMonthly = null

// 计算「昨日」日期字符串（本地时区，与服务其余逻辑一致）
function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 「昨日」统一走「按日期精确补抓」(fetchDataByDate)，绕过 B站「昨日」页签
// （文案匹配不稳定，点不到会静默降级成"今日"周期，导致昨日桶被今日数据污染、总流水对不上后台）。
// 成功后再更新 state.lastYesterday，确保状态/补跑判定一致。
async function fetchYesterdayFinal() {
  const res = await fetchDataByDate(yesterdayStr())
  if (res?.ok) { state.lastYesterday = new Date().toISOString(); saveState() }
  return res
}

// 供 runCatchUp 使用：昨日→按日期精确补抓，今日→原逻辑
const fetchWrapper = async (type) => {
  if (type === 'yesterday') return fetchYesterdayFinal()
  return fetchData(type)
}

function setupCron() {
  if (jobToday) jobToday.stop()
  if (jobYesterday) jobYesterday.stop()
  if (jobYesterdayFinal) jobYesterdayFinal.stop()
  if (jobRecruit) jobRecruit.stop()
  if (jobKpiMonthly) jobKpiMonthly.stop()

  jobToday = cron.schedule(config.cronToday, async () => {
    log('[cron] 触发【今日】数据抓取')
    await fetchData('today')
  }, { timezone: config.timezone })

  jobYesterday = cron.schedule(config.cronYesterday, async () => {
    log('[cron] 触发【昨日】早盘快照（按日期精确补抓，避免页签失效）')
    await fetchYesterdayFinal()
  }, { timezone: config.timezone })

  // 收盘补抓：B站 礼物/大航海等流水存在 T+N 延迟结算，早盘快照可能偏小；
  // 14:30 再用「按日期精确」覆盖成最终结算值，对齐后台对账口径。
  jobYesterdayFinal = cron.schedule(config.cronYesterdayFinal, async () => {
    log('[cron] 触发【昨日】收盘补抓（按日期精确，最终结算覆盖）')
    await fetchYesterdayFinal()
  }, { timezone: config.timezone })

  // 招募统计：每日自动抓取近7天数据并合并去重，避免重复统计
  jobRecruit = cron.schedule(config.cronRecruit7Days, async () => {
    log('[cron] 触发【入退会招募统计】近7日抓取')
    try {
      await runUnionRecruitStats({ closeBrowser: false, range: '7days' })
    } catch (e) {
      log('[cron] 招募统计抓取失败:', e.message)
    }
  }, { timezone: config.timezone })

  // 运营 KPI 月度结算：每日自动归档「已过完的自然月」的 KPI 完成情况
  // 未到冻结窗口的月份每次都重算刷新（兼容 T+N 延迟结算），冻结后不再自动改写历史
  jobKpiMonthly = cron.schedule(config.cronKpiMonthly, async () => {
    log('[cron] 触发【运营 KPI 月度结算】')
    try {
      const r = settleKpiMonths()
      if (r.settled?.length) log(`[cron] KPI 月度结算新增归档月份: ${r.settled.join(', ')}`)
    } catch (e) {
      log('[cron] KPI 月度结算失败: ' + e.message)
    }
  }, { timezone: config.timezone })

  log(`[cron] 已启动定时任务 今日=${config.cronToday} 昨日早盘=${config.cronYesterday} 昨日终值=${config.cronYesterdayFinal} 招募=${config.cronRecruit7Days} KPI月结=${config.cronKpiMonthly} (${config.timezone})`)
}

setupCron()

/**
 * 守护检查：每 10 分钟回溯一次「上一次本应触发的时刻」是否已成功抓取。
 * 覆盖两类漏跑场景：
 *   1. 服务在计划时刻未运行（关机 / 崩溃 / 手动停止）——启动时补一次
 *   2. 服务在跑但系统休眠、进程被挂起导致 cron 未触发——运行期定期补
 */
let catchUpTimer = null
function startCatchUpWatchdog() {
  if (catchUpTimer) clearInterval(catchUpTimer)
  if (config.catchUpMissed === false) return
  catchUpTimer = setInterval(() => {
    // 兜底探测：登录有效但数据已超过阈值未更新 → 告警（防止任何原因导致的静默停更）
    if (!state.needsLogin && state.lastToday) {
      const staleHours = (Date.now() - new Date(state.lastToday).getTime()) / 3600_000
      if (staleHours >= 3) {
        raiseAlert('stale', `数据已超过 ${staleHours.toFixed(1)} 小时未更新（上次成功：${state.lastToday}）。请检查抓取是否异常或服务是否存活；若登录已失效请重新扫码。`)
      }
    }
    if (state.running) return
    runCatchUp(fetchWrapper, state, saveState).catch(e => log(`[catchup] 守护检查异常: ${e.message}`))
  }, 10 * 60 * 1000)
  catchUpTimer.unref?.()
}

/**
 * 单实例互斥：Windows 下 libuv 默认带 SO_REUSEADDR，两个服务实例有可能同时绑定同一端口，
 * 结果是两份 cron 同时抓取、同时覆盖 latest.json / today.json，
 * 触发 EPERM（互相抢占文件）并遗留大量临时文件 —— 历史上曾因此导致数据长时间停更。
 * 因此监听前先探测端口：已有实例在服务，就直接退出，绝不并存。
 */
function probePortInUse(port, timeout = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (inUse) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

const portBusy = await probePortInUse(config.port)
if (portBusy) {
  log('='.repeat(58))
  log(`  检测到 http://localhost:${config.port} 已有服务实例在运行，本次启动自动退出。`)
  log('  （避免多实例并发写 latest.json 造成 EPERM 与数据停更）')
  log('  如需重启，请先结束已有的 node 服务进程，再重新启动。')
  log('='.repeat(58))
  process.exit(0)
}

app.listen(config.port, () => {
  log('='.repeat(58))
  try { cleanupExpiredShares() } catch { /* ignore */ }
  log(`  线下主播看板 · 数据自动同步服务已启动`)
  log(`  访问地址: http://localhost:${config.port}`)
  log(`  数据目录: ${DATA_DIR}`)
  log(`  今日数据: 每 20 分钟自动抓取 (${config.cronToday})`)
  log(`  昨日数据: 每日 ${config.cronYesterday} 按日期精确补抓（早盘，绕过易失效的「昨日」页签）`)
  log(`  昨日终值补抓: 每日 ${config.cronYesterdayFinal} 最终结算覆盖 (byDate，对齐后台对账)`)
  log(`  招募统计: 每日 ${config.cronRecruit7Days} 自动抓取【近7日】入退会记录并去重合并`)
  log(`  KPI月结:  每日 ${config.cronKpiMonthly} 结算已过完的自然月（次月 ${Number(config.kpiSettleDelayDays) || 0} 天内持续刷新，之后冻结快照）`)
  log(`  漏跑补偿: ${config.catchUpMissed === false ? '已关闭' : `已开启（错过 ${Number(config.catchUpMaxAgeHours) || 36} 小时内的计划任务，启动后自动补抓）`}`)
  log(`  卡死保护: 单次抓取硬超时 ${Math.round(FETCH_HARD_TIMEOUT_MS / 60000)} 分钟（超时自动关浏览器并释放抓取锁，防止数据永久停更）`)
  log(`  首次使用请在页面「数据自动同步」中点击【扫码登录B站】`)
  try { startTunnelWatch() } catch (e) { log('[tunnel] start failed: ' + e.message) }
  log('='.repeat(58))

  // 服务就绪后延迟几秒再补跑，避免与启动阶段的初始化抢资源
  setTimeout(() => {
    runCatchUp(fetchWrapper, state, saveState).catch(e => log(`[catchup] 启动补跑异常: ${e.message}`))
  }, 5000)
  // 启动即结算一次：覆盖「跨月期间服务未运行」导致的历史月份漏归档
  setTimeout(() => {
    try {
      const r = settleKpiMonths()
      if (r.settled?.length) log(`[kpiMonthly] 启动补结算月份: ${r.settled.join(', ')}`)
    } catch (e) {
      log('[kpiMonthly] 启动补结算失败: ' + e.message)
    }
  }, 12000)
  startCatchUpWatchdog()
})

process.on('SIGINT', async () => {
  log('[server] 正在退出...')
  await closeContext()
  process.exit(0)
})
