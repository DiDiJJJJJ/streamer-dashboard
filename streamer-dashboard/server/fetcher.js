import fs from 'node:fs'
import path from 'node:path'
import { config, DATA_DIR, DOWNLOAD_DIR, LOG_DIR, ROOT, log } from './config.js'
import { getContext, checkLogin, closeContext } from './browser.js'
import { parseWorkbook, mergeRecords } from './parser.js'
import { bus } from './events.js'
import { pruneRemovedRooms } from './removedRooms.js'
import { syncOpsTeam } from './opsTeam.js'
import { atomicWriteSync } from './utils/atomicWrite.js'
import { syncFirstBroadcast } from './streamerCycleFlow.js'
import {
  FETCH_HARD_TIMEOUT_MS,
  acquireRun,
  isRunLocked,
  isTimeoutError,
  releaseRun,
  withHardTimeout,
} from './utils/runGuard.js'

export const state = {
  running: false,
  lastRunType: null,
  lastToday: null,
  lastYesterday: null,
  lastError: null,
  lastCount: 0,
  loggedIn: false,
  uname: '',
  // —— 告警状态（2026-08-16 新增：登录失效/抓取异常不再静默，便于第一时间发现停更）——
  // alert: { level: 'login'|'fetch'|'stale', msg, at } | null
  alert: null,
  needsLogin: false,
  history: [],
}

/**
 * 记录并广播一条告警。
 * - level='login'：B站登录失效（权限失效），抓取已暂停，必须人工重新扫码才能恢复；
 * - level='fetch'：瞬时抓取失败（页面改版/网络/下载超时等），下一个周期自动重试；
 * - level='stale'：登录有效但数据已超过阈值未更新（兜底探测，防止任何原因导致的静默停更）。
 * 去重：10 分钟内同 level+同 msg 不重复广播，避免 SSE/日志刷屏。
 */
export function raiseAlert(level, msg) {
  const now = Date.now()
  const prev = state.alert
  if (prev && prev.level === level && prev.msg === msg && now - new Date(prev.at).getTime() < 10 * 60 * 1000) {
    return // 与上一条相同且未超 10 分钟，跳过重复广播
  }
  state.alert = { level, msg, at: new Date().toISOString() }
  state.needsLogin = level === 'login'
  log(`[alert] (${level}) ${msg}`)
  saveState()
  bus.emit('alert', state.alert)
}

/** 清除告警（登录恢复 / 抓取成功后调用），并广播 null 让前端收起横幅 */
export function clearAlerts() {
  if (state.alert || state.needsLogin) {
    state.alert = null
    state.needsLogin = false
    saveState()
    bus.emit('alert', null)
  }
}

const STATE_FILE = path.join(DATA_DIR, 'state.json')

export function saveState() {
  try {
    atomicWriteSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch { /* ignore */ }
}

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')))
  } catch { /* ignore */ }
  state.running = false
}

function pushHistory(entry) {
  state.history.unshift({ ...entry, at: new Date().toISOString() })
  state.history = state.history.slice(0, 30)
}

/** 纯定时等待，不依赖任何浏览器对象（避免 page 已释放时抛 TypeError） */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 按文本尝试点击元素（支持多个候选词、多种角色） */
async function clickByText(page, texts, { timeout = 6000 } = {}) {
  for (const t of texts) {
    const candidates = [
      page.getByRole('tab', { name: t, exact: false }),
      page.getByRole('button', { name: t, exact: false }),
      page.getByRole('radio', { name: t, exact: false }),
      page.locator(`text="${t}"`),
      page.locator(`//*[not(self::script)][normalize-space(text())="${t}"]`),
    ]
    for (const loc of candidates) {
      try {
        const el = loc.first()
        if (await el.isVisible({ timeout: 1200 })) {
          await el.click({ timeout })
          log(`[fetch] 已点击: ${t}`)
          return t
        }
      } catch { /* try next */ }
    }
  }
  return null
}

// B站后台在 2026-09 改版：点击"下载"后先弹出"正在下载"对话框，
// 要求选择【按日汇总下载】/【按日明细下载】；点击"按日汇总下载"后再弹出
// "请选择需要下载的主播范围"对话框，需要点击"确定"才真正开始下载。
/**
 * 稳健点击：优先 Playwright 真实点击（含可见/稳定/命中检测），
 * 失败则退回「元素几何中心 + 真实鼠标坐标点击」。
 * 返回 'native' | 'mouse' | null。
 */
async function robustClick(page, locator, { timeout = 6000 } = {}) {
  const el = locator.first()
  try {
    if (await el.isVisible({ timeout: 2500 })) {
      await el.click({ timeout })
      return 'native'
    }
  } catch (e) { /* fall through */ }
  const box = await el.boundingBox().catch(() => null)
  if (!box || box.width <= 0 || box.height <= 0) return null
  try {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    return 'mouse'
  } catch (e) { /* fall through */ }
  return null
}

/**
 * 驱动 B站「正在下载」多步骤导出对话框，直到下载开始。
 *
 * ⚠️ 2026-09-15 实测：步骤顺序与直觉**相反**，且两级对话框标题完全相同（都叫「正在下载」），
 * 不能用标题区分，只能按 **对话框正文内容** 分派动作：
 *   步骤①「请选择需要下载的主播范围」（全部主播 / 仅有开播时长主播 / 仅有流水主播）+「确定」
 *   步骤②「您可以选择【按日汇总下载】或者【按日明细下载】哦！」→ 点「按日汇总下载」
 *   之后才真正开始下载。
 * 历史教训（务必保留）：
 *   - 写死"先点类型、再点范围"的顺序会导致第一步空等、第二步只推进到下一级就结束（下载永不触发）；
 *   - Element UI 关闭 dialog 不销毁 DOM 只 display:none，页面会残留隐藏 wrapper，
 *     而 evaluate(el => el.click()) 不校验可见性，会静默点到隐藏按钮（表现为"点击成功但零请求"），
 *     所以必须用 `.el-dialog__wrapper:visible` 过滤。
 * 返回：{ scope: 是否完成步骤①, type: 是否完成步骤② }
 */
async function driveExportFlow(page, timeout = 60000) {
  const deadline = Date.now() + timeout
  const done = { scope: 0, type: 0 }
  let bothDoneAt = 0
  try {
    while (Date.now() < deadline) {
      const dialogs = page.locator('.el-dialog__wrapper:visible')
      const n = await dialogs.count().catch(() => 0)
      let acted = false

      for (let i = 0; i < n; i++) {
        const d = dialogs.nth(i)
        const txt = (await d.innerText({ timeout: 2000 }).catch(() => '')) || ''
        if (!txt) continue

        // 步骤①：选择主播范围（默认已选「全部主播」，仍显式点一次圆心确保状态）
        if (txt.indexOf('主播范围') !== -1 && done.scope < 3) {
          const radio = d.locator('.el-radio:visible').filter({ hasText: /全部主播/ }).first()
          if ((await radio.count().catch(() => 0)) > 0) {
            const rb = await radio.boundingBox().catch(() => null)
            if (rb && rb.width > 0 && rb.height > 0) {
              await page.mouse.click(rb.x + 8, rb.y + rb.height / 2).catch(() => {})
              await page.waitForTimeout(400)
            }
          }
          const btn = d.locator('button:visible').filter({ hasText: /确\s*定/ }).first()
          if ((await btn.count().catch(() => 0)) > 0) {
            const how = await robustClick(page, btn)
            if (how) {
              done.scope++
              acted = true
              log('[fetch] 导出① 已选「全部主播」并点击「确定」(' + how + ')')
              await page.waitForTimeout(1800)
              break
            }
          }
        }

        // 步骤②：选择下载类型
        if (txt.indexOf('按日汇总下载') !== -1 && done.type < 3) {
          const btn = d.locator('button:visible').filter({ hasText: /按日汇总下载/ }).first()
          if ((await btn.count().catch(() => 0)) > 0) {
            const how = await robustClick(page, btn)
            if (how) {
              done.type++
              acted = true
              log('[fetch] 导出② 已点击「按日汇总下载」(' + how + ')')
              await page.waitForTimeout(1800)
              break
            }
          }
        }
      }

      if (done.scope > 0 && done.type > 0) {
        if (!acted) {
          if (!bothDoneAt) bothDoneAt = Date.now()
          if (Date.now() - bothDoneAt > 4000) break
        } else {
          bothDoneAt = 0
        }
      }

      if (!acted) {
        const vis = await page.locator('.el-dialog__wrapper:visible').count().catch(() => 0)
        if (vis === 0 && (done.scope > 0 || done.type > 0)) break
        await page.waitForTimeout(400)
      }
    }
  } catch (e) {
    log('[fetch] driveExportFlow 异常: ' + (e && e.message))
  }

  if (!(done.scope > 0 && done.type > 0)) {
    const texts = await page.locator('.el-dialog__wrapper:visible').allInnerTexts().catch(() => [])
    log('[fetch] 诊断: 导出流程未走完 scope=' + done.scope + ' type=' + done.type +
      ' | 剩余可见对话框=' +
      JSON.stringify(texts.map((t) => String(t || '').replace(/\s+/g, ' ').slice(0, 90))))
  }
  return { scope: done.scope > 0, type: done.type > 0 }
}

/**
 * 取得用于抓取的页面。
 *
 * ⚠️ 2026-09-15 血泪教训（务必保留）：**必须优先复用 context 中已存在的页面**
 * （Chrome 启动时的初始标签页），不要用 ctx.newPage()。
 * 实测：用 newPage() 创建的标签页，在 B站 导出下载触发后约 0.2 秒会被关闭，
 * 紧接着 context 也关闭，导致 Playwright 的 download.saveAs() 抛
 * "Target page, context or browser has been closed"，下载文件随之丢失，
 * 表现为「导出未产生下载文件」——数据永久停更。
 * 而复用初始标签页时，页面能正常存活到文件保存完成。
 *
 * 复用页面时必须清掉上一轮抓取注册的 response 监听，避免多次重试后监听器累积。
 */
/**
 * saveAs 失败后的兜底：B站 会在下载触发后极短时间内关闭承载下载的页面，
 * 导致 Playwright 的 download artifact 失效（saveAs/path 都报
 * "Target page, context or browser has been closed"）。
 * 但下载 URL 本身仍可用，此处用 Node 原生 fetch 带上同一 profile 的 Cookie 直接拉取。
 * @returns {Promise<string|null>} 保存后的本地路径
 */
async function fetchByDownloadUrl(dl, destPath, tag) {
  try {
    const url = dl.url()
    if (!url || !/^https?:/i.test(url)) return null
    const ctx = await getContext(config.headless)
    const cookies = await ctx.cookies().catch(() => [])
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const res = await fetch(url, {
      headers: {
        cookie,
        referer: config.targetUrl,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    })
    if (!res.ok) {
      log(`[${tag}] 下载 URL 兜底返回 HTTP ${res.status}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) {
      log(`[${tag}] 下载 URL 兜底内容过小(${buf.length}B)，判定失败`)
      return null
    }
    fs.writeFileSync(destPath, buf)
    log(`[${tag}] 已通过下载 URL 兜底保存: ${buf.length} 字节`)
    return destPath
  } catch (e) {
    log(`[${tag}] 下载 URL 兜底失败: ` + (e && e.message))
    return null
  }
}

async function acquirePage(ctx) {
  const alive = ctx.pages().filter((p) => !p.isClosed())
  const reused = alive.length > 0
  const page = reused ? alive[0] : await ctx.newPage()
  log('[page] 取用页面: ' + (reused ? '复用已有 ' + alive.length + ' 个中的第一个' : 'ctx.newPage() 新建'))
  try { page.removeAllListeners('response') } catch (e) { /* ignore */ }
  return page
}

async function pageHasLoginPrompt(page) {
  for (const kw of config.selectors.loginFlag) {
    try {
      if (await page.locator(`text="${kw}"`).first().isVisible({ timeout: 800 })) return true
    } catch { /* ignore */ }
  }
  return false
}

async function dumpDebug(page, tag) {
  try {
    const base = path.join(LOG_DIR, `${tag}-${Date.now()}`)
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {})
    fs.writeFileSync(`${base}.html`, await page.content(), 'utf-8')
    log(`[fetch] 已保存排查快照: ${base}.png / .html`)
  } catch { /* ignore */ }
}

/** 清理下载目录中以指定前缀开头的旧文件，避免轮询时取到旧文件 */
function cleanDownloadFiles(prefix) {
  try {
    fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => f.startsWith(prefix) && /\.(xlsx|xls|csv)$/i.test(f))
      .forEach(f => {
        try { fs.unlinkSync(path.join(DOWNLOAD_DIR, f)) } catch { /* ignore */ }
      })
  } catch { /* ignore */ }
}

/** 等待下载目录中最近指定时间窗口内出现的任意 Excel 文件（兜底，文件名前缀可能变化） */
async function waitForRecentExcel(dir, timeout = 30000, { since = 30000, interval = 500 } = {}) {
  const windowStart = Date.now() - since
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const files = fs.readdirSync(dir)
        .map(f => ({ name: f, path: path.join(dir, f), stat: fs.statSync(path.join(dir, f)) }))
        .filter(({ stat, name }) => stat.isFile() && /\.(xlsx|xls|csv)$/i.test(name) && stat.mtime.getTime() > windowStart)
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())
      if (files.length > 0) {
        // 确保文件已写完
        const target = files[0].path
        let lastSize = -1
        for (let i = 0; i < 10; i++) {
          const s = fs.statSync(target).size
          if (s === lastSize && s > 0) return target
          lastSize = s
          await new Promise(r => setTimeout(r, 100))
        }
        return target
      }
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

/** 等待以指定前缀开头的文件出现在下载目录 */
async function waitForDownloadFile(prefix, { timeout = 30000, interval = 500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => f.startsWith(prefix) && /\.(xlsx|xls|csv)$/i.test(f))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length > 0) {
      // 确保文件已写完（1 秒内大小不再变化）
      const target = path.join(DOWNLOAD_DIR, files[0].name)
      let lastSize = -1
      for (let i = 0; i < 10; i++) {
        const s = fs.statSync(target).size
        if (s === lastSize && s > 0) return target
        lastSize = s
        await new Promise(r => setTimeout(r, 100))
      }
      return target
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return null
}

/** 把抓取结果同步到 public/streamer_data.json，使前端自动载入 */
function syncToPublicDataset() {
  try {
    const latestFile = path.join(DATA_DIR, 'latest.json')
    const publicFile = path.join(ROOT, 'public', 'streamer_data.json')
    if (!fs.existsSync(latestFile)) return
    // 用原子写替代 copyFileSync：Windows 上目标文件被读句柄占用时 copyFileSync 会 EPERM
    const payload = fs.readFileSync(latestFile, 'utf-8')
    atomicWriteSync(publicFile, payload)
    // 同时把 dist 里的也更新，避免生产构建后 dist 与 public 不一致
    const distFile = path.join(ROOT, 'dist', 'streamer_data.json')
    if (fs.existsSync(distFile)) atomicWriteSync(distFile, payload)
    log('[fetch] 已自动同步到 public/streamer_data.json')
  } catch (e) {
    log('[fetch] 同步到 public 失败: ' + e.message)
  }
}

/**
 * 抓取B站后台数据
 * @param {'today'|'yesterday'} type
 */
async function fetchDataImpl(type = 'today') {
  if (isRunLocked(state, log)) {
    return { ok: false, skipped: true, message: '上一次抓取仍在进行中，本次跳过' }
  }
  const runToken = acquireRun(state)
  state.lastRunType = type
  state.lastError = null

  let page
  let downloadPath = null
  let apiDumps = []
  let retry = 0
  const maxRetry = 2

  // 一次性登录校验：登录失效属于「权限失效」，重试无意义，直接告警并退出，
  // 避免每个抓取周期反复拉起浏览器空转（历史上曾因此静默停更 19 小时未被发现）。
  const login = await checkLogin()
  state.loggedIn = login.loggedIn
  state.uname = login.uname
  if (!login.loggedIn) {
    state.lastError = '未登录B站账号，请先在「数据自动同步」页点击【扫码登录B站】完成登录'
    raiseAlert('login', 'B站登录会话已失效，数据抓取已暂停。请在「数据自动同步」页点击【扫码登录B站】重新登录，登录成功后系统会自动恢复抓取与榜单更新。')
    releaseRun(state, runToken)
    return { ok: false, type, error: state.lastError, needsLogin: true }
  }
  // 登录有效 → 清除登录类告警（可能由之前的失效遗留）
  clearAlerts()

  while (retry <= maxRetry) {
    try {
      const ctx = await getContext(config.headless)
      page = await acquirePage(ctx)

      // 捕获接口响应作为兜底数据源
      apiDumps = []
      page.on('response', async (res) => {
        try {
          const url = res.url()
          if (!/bilibili\.com/.test(url)) return
          if (!/(anchor|guild|galaxy|datacenter|data)/i.test(url)) return
          const ct = res.headers()['content-type'] || ''
          if (!ct.includes('json')) return
          const json = await res.json().catch(() => null)
          if (json && json.data) apiDumps.push({ url, json })
        } catch { /* ignore */ }
      })

      log(`[fetch] 打开数据页: ${config.targetUrl}`)
      await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: config.navTimeout })
      await page.waitForTimeout(3500)

      if (await pageHasLoginPrompt(page)) {
        await dumpDebug(page, 'need-login')
        throw new Error('页面提示需要登录，请重新扫码登录')
      }

      // 选择【今日】/【昨日】
      const tabWords = type === 'today' ? config.selectors.todayTab : config.selectors.yesterdayTab
      const clickedTab = await clickByText(page, tabWords)
      if (!clickedTab) log(`[fetch] 未找到「${tabWords.join('/')}」切换项，使用页面默认周期`)
      await page.waitForTimeout(2500)

      // 清理下载目录中上次残留的「主播数据」文件，避免轮询时取到旧文件，导致【今日】与【昨日】数据完全一致
      cleanDownloadFiles('主播数据')
      cleanDownloadFiles(`${type}_`)

      // 点击【下载】按钮
      const exported = await clickByText(page, config.selectors.exportButton, { timeout: 10000 })
      if (!exported) {
        await dumpDebug(page, 'no-export-button')
        throw new Error('未找到「导出/下载」按钮，B站页面可能已改版。请查看 server/logs 下的快照，并在 server/config.json 的 selectors.exportButton 中补充按钮文案')
      }

      await page.waitForTimeout(800)

      // 关键：必须在弹窗处理/点击「确定」之前就注册 download 监听。
      // 若等点击后再注册，下载事件可能已在 waitForEvent 挂上之前发出，造成「点了确定却抓不到下载」。
      // download 事件一触发就「立刻」保存：B站 在下载开始后很快就会关闭页面/上下文，
      // 若像以前那样等到流程走完再 saveAs，会报 "Target page, context or browser has been closed"。
      const savePromise = page
        .waitForEvent('download', { timeout: 90000 })
        .then(async (dl) => {
          const suggested = dl.suggestedFilename() || `${type}.xlsx`
          const p = path.join(DOWNLOAD_DIR, `${type}_${Date.now()}_${suggested}`)
          log('[fetch] download 事件已触发，立即保存: ' + suggested)
          try {
            await dl.saveAs(p)
            return p
          } catch (err) {
            log('[fetch] download.saveAs 失败(' + err.message + ')，尝试 download.path()')
            try {
              const tmp = await dl.path()
              if (tmp && fs.existsSync(tmp)) { fs.copyFileSync(tmp, p); return p }
            } catch { /* ignore */ }
            return await fetchByDownloadUrl(dl, p, 'fetch')
          }
        })
        .catch(() => null)

      // B站后台 2026-09 改版：点击下载后先弹"选择下载类型"对话框，点"按日汇总下载"后
      // 再弹"选择下载范围"对话框，最后点"确定"才真正开始下载。
      await page.waitForTimeout(1000)
      const flow = await driveExportFlow(page, 60000)
      if (!flow.scope || !flow.type) {
        log('[fetch] 导出对话框未完整走完，仍继续等待下载事件')
        await clickByText(page, config.selectors.dailySummaryButton, { timeout: 5000 })
      }

      // 等待下载文件落盘（savePromise 在 download 事件触发的瞬间就已开始保存）
      downloadPath = await savePromise
      if (!downloadPath) {
        log('[fetch] 未取得下载文件，轮询下载目录')
        downloadPath = await waitForDownloadFile('主播数据', { timeout: 60000 })
        if (!downloadPath) downloadPath = await waitForRecentExcel(DOWNLOAD_DIR, 60000)
      }

      if (!downloadPath || !fs.existsSync(downloadPath)) {
        await dumpDebug(page, 'no-download')
        throw new Error('导出未产生下载文件，请查看 server/logs 下的快照排查')
      }

      log(`[fetch] 已下载: ${downloadPath}`)
      break // 成功，退出重试循环
    } catch (e) {
      retry++
      log(`[fetch] 第 ${retry}/${maxRetry} 次尝试失败: ${e.message}`)
      if (page) { await page.close().catch(() => {}); page = undefined }
      if (retry > maxRetry) {
        state.lastError = e.message
        raiseAlert('fetch', `数据抓取失败（已重试 ${retry} 次）：${e.message}。系统将在下一个周期自动重试；若持续失败请检查 B站 页面是否改版或网络是否通畅。`)
        pushHistory({ type, ok: false, error: e.message })
        saveState()
        releaseRun(state, runToken)
        return { ok: false, type, error: e.message }
      }
      // 注意：上面已把 page 置为 undefined，这里绝不能再用 page.waitForTimeout()，
      // 否则会抛 TypeError 并逃出函数体，导致 finally 不执行、抓取锁永久不释放（数据永久停更）。
      await sleep(2000)
    }
  }

  try {
    const statTime = type === 'today'
      ? `${dateStr(0)} ~ ${dateStr(0)}`
      : `${dateStr(-1)} ~ ${dateStr(-1)}`

    const { records, headerMap, rawHeaders } = parseWorkbook(downloadPath, statTime)
    if (!records.length) throw new Error('导出文件解析结果为空，请检查文件内容')

    // 记录一次列名映射，便于核对【大航海人数】等字段是否正确识别。
    // 注意：该调试文件写入已用 try/catch 包裹——历史上曾因 headers-today.json 写入抛 EPERM
    // 而中止整个抓取流程（数据未合并进 latest.json、今日看板显示 0）。调试日志绝不应影响数据落盘。
    try {
      // 使用唯一时间戳文件名，避免反复写入固定文件名在 Windows 上触发 EPERM 锁竞争
      fs.writeFileSync(
        path.join(LOG_DIR, `headers-${type}-${Date.now()}.json`),
        JSON.stringify({ rawHeaders, headerMap }, null, 2),
        'utf-8'
      )
    } catch (e) {
      log(`[fetch] 写入调试列名映射失败（已忽略，不影响数据落盘）: ${e.message}`)
    }

    const outFile = path.join(DATA_DIR, `${type}.json`)
    atomicWriteSync(outFile, JSON.stringify(records, null, 2))

    // 合并进汇总数据（以 房间号+统计日期 为键，新数据覆盖旧数据）
    const latestFile = path.join(DATA_DIR, 'latest.json')
    let base = []
    try {
      if (fs.existsSync(latestFile)) base = JSON.parse(fs.readFileSync(latestFile, 'utf-8'))
    } catch { /* ignore */ }
    const merged = mergeRecords(base, records)
    atomicWriteSync(latestFile, JSON.stringify(merged, null, 2))

    // 自动同步到前端数据源，无需人工点击「载入看板」
    syncToPublicDataset()
    syncFirstBroadcast()
    bus.emit('data-changed', { type, count: records.length })

    // 今日抓取成功后，自动同步移除已在 B站后台移出的主播（宽限期 + 健康度保护已在模块内实现）
    if (type === 'today') {
      try {
        const pruned = pruneRemovedRooms()
        if (pruned && pruned.ok && pruned.pruned > 0) {
          log(`[fetch] 自动移除已移出主播：${pruned.pruned} 条记录 / ${pruned.rooms} 个房间`)
        }
      } catch (e) {
        log('[fetch] 自动移除已移出主播失败（已忽略，不影响抓取）: ' + e.message)
      }
    }

    // 今日抓取成功后，自动同步运营团队人员变动（新增 / 减少，宽限期 + 健康度保护已在模块内实现）
    if (type === 'today') {
      try {
        const team = syncOpsTeam()
        if (team && team.ok && team.changes > 0) {
          log(`[fetch] 运营团队变动同步：${team.current} 人在册，本次变动 ${team.changes} 项（add ${team.added.length}/remove ${team.removed.length}）`)
        }
      } catch (e) {
        log('[fetch] 运营团队变动同步失败（已忽略，不影响抓取）: ' + e.message)
      }
    }

    const apiDumpFile = path.join(LOG_DIR, `api-${type}.json`)
    if (apiDumps.length) {
      fs.writeFileSync(apiDumpFile, JSON.stringify(apiDumps.slice(0, 5), null, 2), 'utf-8')
    }

    const now = new Date().toISOString()
    if (type === 'today') state.lastToday = now
    else state.lastYesterday = now
    state.lastCount = records.length
    const seaCount = records.reduce((s, r) => {
      const v = Number(r['大航海人数'])
      return s + (Number.isNaN(v) ? 0 : v)
    }, 0)
    const revenue = records.reduce((s, r) => {
      const v = Number(r['总流水（元）'])
      return s + (Number.isNaN(v) ? 0 : v)
    }, 0)
    const rooms = new Set(records.map(r => String(r['房间号'] || '')).filter(Boolean))
    const dateRange = records.length
      ? (() => {
          const dates = records.map(r => r['统计结束日期'] || r['统计日期'] || '').filter(Boolean).sort()
          return dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '未知'
        })()
      : '未知'
    const check = {
      summary: `${records.length} 条 / ${rooms.size} 房间 / 统计 ${dateRange} / 流水 ¥${revenue.toFixed(2)} / 大航海 ${seaCount}`,
      count: records.length,
      roomCount: rooms.size,
      revenue,
      seaCount,
      dateRange,
      warnings: [],
    }
    // 基础校验：流水为负或房间号缺失
    const badRevenue = records.filter(r => Number(r['总流水（元）']) < 0).length
    const missingRoom = records.filter(r => !String(r['房间号'] || '').trim()).length
    if (badRevenue) check.warnings.push(`${badRevenue} 条记录流水为负`)
    if (missingRoom) check.warnings.push(`${missingRoom} 条记录缺少房间号`)

    pushHistory({ type, ok: true, count: records.length, seaCount })
    saveState()
    clearAlerts() // 抓取成功 → 清除瞬时抓取类告警（如有）

    log(`[fetch] ${type} 抓取成功: ${records.length} 条，大航海合计 ${seaCount}`)
    return { ok: true, type, count: records.length, seaCount, revenue, file: outFile, check }
  } catch (e) {
    state.lastError = e.message
    pushHistory({ type, ok: false, error: e.message })
    saveState()
    log(`[fetch] ${type} 解析/保存失败: ${e.message}`)
    return { ok: false, type, error: e.message }
  } finally {
    if (page) await page.close().catch(() => {})
    releaseRun(state, runToken)
  }
}

/**
 * 补抓「指定日期」的历史数据（B站后台数据窗口通常为近 7 天，可精确到某一天）。
 * 流程：打开主播数据页 → 在日期范围选择器中点选 开始=结束=目标日期（单日范围）
 *        → 点击【导出数据】→【按日汇总下载】→ 解析并以 房间号::日期 合并进 latest.json。
 * @param {string} dateStr YYYY-MM-DD
 */
async function fetchDataByDateImpl(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
    return { ok: false, error: '日期格式应为 YYYY-MM-DD' }
  }
  if (isRunLocked(state, log)) {
    return { ok: false, skipped: true, message: '上一次抓取仍在进行中，本次跳过' }
  }
  const runToken = acquireRun(state)
  state.lastError = null

  const [Y, M, D] = dateStr.split('-').map(Number)
  let page
  let downloadPath = null

  try {
    const login = await checkLogin()
    state.loggedIn = login.loggedIn
    state.uname = login.uname
    if (!login.loggedIn) {
      raiseAlert('login', 'B站登录会话已失效，历史补抓已暂停。请在「数据自动同步」页点击【扫码登录B站】重新登录，登录成功后系统会自动恢复抓取。')
      throw new Error('未登录B站账号，请先在「数据自动同步」页点击【扫码登录B站】完成登录')
    }

    const ctx = await getContext(config.headless)
    page = await acquirePage(ctx)

    log(`[fetch-date] 打开数据页并筛选日期: ${dateStr}`)
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: config.navTimeout })
    await page.waitForTimeout(3500)

    if (await pageHasLoginPrompt(page)) {
      await dumpDebug(page, 'need-login')
      throw new Error('页面提示需要登录，请重新扫码登录')
    }

    // 打开「我的主播列表」区域的日期范围选择器（第二个 daterange 编辑器）
    const dateEditors = page.locator('.el-date-editor--daterange')
    const editorCount = await dateEditors.count().catch(() => 1)
    const editor = editorCount > 1 ? dateEditors.nth(1) : dateEditors.first()
    await editor.click({ timeout: 8000 })
    await page.waitForSelector('.el-date-range-picker', { timeout: 8000 })
    await page.waitForTimeout(500)

    // 在正确的月份面板中点选目标日（开始）
    await selectDayInRange(page, Y, M, D)
    await page.waitForTimeout(400)
    // 再次点选同一天作为结束 → 单日范围
    await selectDayInRange(page, Y, M, D)
    await page.waitForTimeout(500)

    // 确认（有「确定」按钮则点击，否则回车）
    const confirmBtn = page.locator('.el-date-range-picker .el-picker-panel__footer .el-button--default, .el-picker-panel__footer .confirm, .el-picker-panel__footer button').first()
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click().catch(() => {})
    } else {
      await page.keyboard.press('Enter').catch(() => {})
    }
    await page.waitForTimeout(800)

    // 应用筛选：点击与「我的主播列表」区域对应的「查询」按钮
    const queryBtns = page.getByRole('button', { name: /查询|搜索|筛选|搜 索|搜索查询/ })
    const queryCount = await queryBtns.count().catch(() => 0)
    const queryBtn = queryCount > 1 ? queryBtns.nth(1) : queryBtns.first()
    let clickedQuery = false
    if (await queryBtn.isVisible().catch(() => false)) {
      await queryBtn.click().catch(() => {})
      clickedQuery = true
      await page.waitForTimeout(2500)
    }

    // 读取「我的主播列表」下方的统计时间注释，确认筛选已生效
    const listDateNote = await page.evaluate(() => {
      const listHeader = Array.from(document.querySelectorAll('*')).find(el =>
        el.children.length === 0 && (el.textContent || '').includes('我的主播列表')
      )
      if (!listHeader) return ''
      const section = listHeader.closest('.el-card, section, .card, .panel, [class*="section"]') || listHeader.parentElement
      return (section ? section.innerText : '').match(/统计时间[:：]\s*(\d{4}-\d{2}-\d{2}[^\n]*)/)?.[1] || ''
    })
    log(`[fetch-date] 编辑器索引: ${editorCount - 1} | 点击查询: ${clickedQuery} | 列表统计时间: ${listDateNote || '(未识别)'}`)

    await page.waitForTimeout(1200) // 等待表格按新日期刷新

    // 清理旧下载文件，避免取到历史文件
    cleanDownloadFiles('主播数据')
    cleanDownloadFiles(`bydate_${dateStr}_`)

    // 导出 → 按日汇总下载
    const exported = await clickByText(page, config.selectors.exportButton, { timeout: 10000 })
    if (!exported) {
      await dumpDebug(page, 'no-export-button')
      throw new Error('未找到「导出/下载」按钮，B站页面可能已改版。请查看 server/logs 下的快照')
    }
    await page.waitForTimeout(800)

    // 关键：必须在弹窗处理/点击「确定」之前就注册 download 监听，
    // 否则下载事件可能在 waitForEvent 挂上之前就已发出，导致「点了确定却抓不到下载」。
    const savePromise = page
      .waitForEvent('download', { timeout: 90000 })
      .then(async (dl) => {
        const suggested = dl.suggestedFilename() || `bydate_${dateStr}.xlsx`
        const p = path.join(DOWNLOAD_DIR, `bydate_${dateStr}_${Date.now()}_${suggested}`)
        log('[fetch-date] download 事件已触发，立即保存: ' + suggested)
        try {
          await dl.saveAs(p)
          return p
        } catch (err) {
          log('[fetch-date] download.saveAs 失败(' + err.message + ')，尝试 download.path()')
          try {
            const tmp = await dl.path()
            if (tmp && fs.existsSync(tmp)) { fs.copyFileSync(tmp, p); return p }
          } catch { /* ignore */ }
          return await fetchByDownloadUrl(dl, p, 'fetch-date')
        }
      })
      .catch(() => null)

    const flow = await driveExportFlow(page, 60000)
    if (!flow.scope || !flow.type) {
      log('[fetch-date] 导出对话框未完整走完，仍继续等待下载事件')
      await clickByText(page, config.selectors.dailySummaryButton, { timeout: 5000 })
    }

    // 等待下载文件落盘
    downloadPath = await savePromise
    if (!downloadPath) {
      log('[fetch-date] 未取得下载文件，轮询下载目录')
      downloadPath = await waitForDownloadFile('主播数据', { timeout: 60000 })
      if (!downloadPath) downloadPath = await waitForRecentExcel(DOWNLOAD_DIR, 60000)
    }
    if (!downloadPath || !fs.existsSync(downloadPath)) {
      await dumpDebug(page, 'no-download')
      throw new Error('导出未产生下载文件，请查看 server/logs 下的快照排查')
    }
    log(`[fetch-date] 已下载: ${downloadPath}`)

    // 解析（统计日期固定为目标日）
    const statTime = `${dateStr} ~ ${dateStr}`
    const { records, headerMap, rawHeaders } = parseWorkbook(downloadPath, statTime)
    if (!records.length) throw new Error('导出文件解析结果为空，请检查文件内容')

    try {
      fs.writeFileSync(
        path.join(LOG_DIR, `headers-bydate-${dateStr}.json`),
        JSON.stringify({ rawHeaders, headerMap }, null, 2),
        'utf-8'
      )
    } catch (e) {
      log(`[fetch-date] 写入调试列名映射失败（已忽略，不影响数据落盘）: ${e.message}`)
    }

    // 合并进汇总数据（以 房间号+统计日期 为键，仅覆盖该日记录，不影响其他日期）
    const latestFile = path.join(DATA_DIR, 'latest.json')
    let base = []
    try { if (fs.existsSync(latestFile)) base = JSON.parse(fs.readFileSync(latestFile, 'utf-8')) } catch { /* ignore */ }
    const merged = mergeRecords(base, records)
    atomicWriteSync(latestFile, JSON.stringify(merged, null, 2))
    syncToPublicDataset()
    syncFirstBroadcast()
    bus.emit('data-changed', { type: 'bydate', date: dateStr, count: records.length })

    const rooms = new Set(records.map(r => String(r['房间号'] || '')).filter(Boolean))
    const revenue = records.reduce((s, r) => s + (Number(r['总流水（元）']) || 0), 0)
    const seaCount = records.reduce((s, r) => s + (Number(r['大航海人数']) || 0), 0)

    state.lastByDate = { date: dateStr, at: new Date().toISOString(), count: records.length }
    pushHistory({ type: 'bydate', date: dateStr, ok: true, count: records.length })
    saveState()
    clearAlerts()
    log(`[fetch-date] ${dateStr} 补抓成功: ${records.length} 条，大航海合计 ${seaCount}`)
    return { ok: true, type: 'bydate', date: dateStr, count: records.length, roomCount: rooms.size, revenue, seaCount, file: downloadPath }
  } catch (e) {
    state.lastError = e.message
    pushHistory({ type: 'bydate', date: dateStr, ok: false, error: e.message })
    saveState()
    log(`[fetch-date] ${dateStr} 补抓失败: ${e.message}`)
    return { ok: false, type: 'bydate', date: dateStr, error: e.message }
  } finally {
    if (page) await page.close().catch(() => {})
    releaseRun(state, runToken)
  }
}

/**
 * 硬超时守护：任何一次抓取超过上限仍未结束，一律判定卡死。
 * 处理动作：强制关闭浏览器（让卡住的 await 抛错退出）→ 释放抓取锁 → 记录失败历史。
 * 这样即使单次抓取彻底卡死，下一个定时周期仍能正常抓取，不会出现「数据永久停更」。
 */
async function guardFetch(label, historyEntry, task) {
  try {
    return await withHardTimeout(label, FETCH_HARD_TIMEOUT_MS, task)
  } catch (e) {
    if (!isTimeoutError(e)) throw e

    const msg = e.message
    log(`[guard] ${msg}`)
    log('[guard] 正在强制关闭浏览器并释放抓取锁，以便下一个周期能正常抓取')
    try { await closeContext() } catch { /* ignore */ }

    // 卡死的运行已被放弃，直接强制释放（不带令牌，无条件释放）
    releaseRun(state)
    state.lastError = msg
    pushHistory({ ...historyEntry, ok: false, error: msg })
    saveState()
    return { ok: false, ...historyEntry, error: msg, timeout: true }
  }
}

/** 抓取「今日/昨日」数据（带硬超时守护） */
export async function fetchData(type = 'today') {
  return guardFetch(`【${type === 'today' ? '今日' : '昨日'}】抓取`, { type }, () => fetchDataImpl(type))
}

/** 按指定日期补抓（带硬超时守护） */
export async function fetchDataByDate(dateStr) {
  return guardFetch(`【${dateStr}】按日期补抓`, { type: 'bydate', date: dateStr }, async () => {
    // B站 导出属于「概率性成功」：实测约一半概率在下载触发后被 B站 关闭承载下载的页面，
    // 导致 download.saveAs 抛 "Target page, context or browser has been closed"
    //（表现为「导出未产生下载文件」）。因此按日期补抓也必须像今日抓取一样重试。
    let last = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetchDataByDateImpl(dateStr)
        if (r && (r.ok || r.skipped)) return r
        last = r
      } catch (e) {
        last = { ok: false, type: 'bydate', date: dateStr, error: e && e.message }
      }
      if (attempt < 3) {
        log(`[fetch-date] 第 ${attempt}/3 次尝试失败: ${last && last.error}，3 秒后重试`)
        await sleep(3000)
      }
    }
    return last
  })
}

/** 在 Element UI 日期范围选择器中，于正确的月份面板点选指定日 */
async function selectDayInRange(page, Y, M, D) {
  const leftHeader = page.locator('.el-date-range-picker__content.is-left .el-date-range-picker__header div').first()
  const rightHeader = page.locator('.el-date-range-picker__content.is-right .el-date-range-picker__header div').first()
  const leftTxt = (await leftHeader.textContent().catch(() => '')) || ''
  const rightTxt = (await rightHeader.textContent().catch(() => '')) || ''
  let panel = null
  if (leftTxt.includes(`${M} 月`) && leftTxt.includes(`${Y}`)) panel = page.locator('.el-date-range-picker__content.is-left')
  else if (rightTxt.includes(`${M} 月`) && rightTxt.includes(`${Y}`)) panel = page.locator('.el-date-range-picker__content.is-right')
  else {
    // 翻到目标月：点左面板的「上一年/月」箭头，直到左面板表头匹配
    for (let i = 0; i < 12; i++) {
      const lt = (await leftHeader.textContent().catch(() => '')) || ''
      if (lt.includes(`${M} 月`) && lt.includes(`${Y}`)) { panel = page.locator('.el-date-range-picker__content.is-left'); break }
      await page.locator('.el-date-range-picker__content.is-left .el-icon-d-arrow-left, .el-picker-panel__icon-btn.el-icon-d-arrow-left').first().click().catch(() => {})
      await page.waitForTimeout(300)
    }
  }
  if (!panel) throw new Error(`无法在日期选择器中定位到 ${Y}年${M}月`)
  const cell = panel.locator('td.available', { hasText: new RegExp(`^\\s*${D}\\s*$`) }).first()
  await cell.click({ timeout: 8000 })
}

export function readData(type = 'latest') {
  const f = path.join(DATA_DIR, `${type}.json`)
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch {
    return null
  }
}
