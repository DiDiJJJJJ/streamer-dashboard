import fs from 'node:fs'
import path from 'node:path'
import xlsx from 'xlsx'
import { config, DATA_DIR, DOWNLOAD_DIR, log } from '../config.js'
import { getContext, checkLogin, closeContext } from '../browser.js'
import { atomicWriteSync } from '../utils/atomicWrite.js'

const ROSTER_FILE = path.join(DATA_DIR, 'roster.json')
const OUTPUT_FILE = path.join(DATA_DIR, 'union_recruit_stats.json')
const ARCHIVE_FILE = path.join(DATA_DIR, 'union_recruit_archive.json')

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/** 从多种运营经纪人格式中提取运营人员名
 *  支持：
 *    - 小辫子|运营组|虚拟线下部
 *    - 运营经纪人：小辫子|运营组|虚拟线下部
 *    - 运营经纪人 小辫子|运营组|虚拟线下部
 *    - 小辫子
 */
function parseOperator(raw) {
  const s = String(raw || '').trim()
  if (!s) return '未分配'
  const withoutPrefix = s
    .replace(/^运营经纪人[：:\s]+/i, '')   // 去掉 "运营经纪人：" / "运营经纪人 "
    .replace(/^经纪人[：:\s]+/i, '')      // 去掉 "经纪人："
    .trim()
  return withoutPrefix.split('|')[0].trim() || '未分配'
}

/** 从「主播」单元格多行文本中提取房间号（旧版兼容） */
function parseRoomFromStreamerCell(cellText) {
  const txt = String(cellText || '')
  const m = txt.match(/房间号[：:\s]*(\d+)/)
  return m ? m[1].trim() : ''
}

/** 把房间号统一转字符串 */
function normalizeRoom(v) {
  if (v === null || v === undefined || v === '') return ''
  return String(v).trim()
}

/** 读取线下主播房间号清单 */
function readOfflineRooms() {
  try {
    if (!fs.existsSync(ROSTER_FILE)) return new Set()
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'))
    const list = Array.isArray(roster.offlineRooms) ? roster.offlineRooms : []
    return new Set(list.map(String))
  } catch (e) {
    log('[recruit] 读取 roster.json 失败:', e.message)
    return new Set()
  }
}

/** 先点击父菜单展开，再点击子菜单（B站左侧折叠菜单） */
async function expandAndClickSubmenu(page, parentTexts, subTexts, { timeout = 6000 } = {}) {
  // 先尝试直接定位子菜单（可能已展开）
  const direct = await clickByText(page, subTexts, { timeout })
  if (direct) return { parent: null, child: direct }

  // 否则先点击父菜单展开
  for (const p of parentTexts) {
    const clickedParent = await clickByText(page, [p], { timeout })
    if (clickedParent) {
      log(`[recruit] 已展开父菜单: ${p}`)
      await sleep(1200)
      const clickedChild = await clickByText(page, subTexts, { timeout })
      if (clickedChild) return { parent: clickedParent, child: clickedChild }
    }
  }
  return null
}

/** 多候选文本点击（与 fetcher.js 逻辑保持一致） */
async function clickByText(page, texts, { timeout = 6000, role } = {}) {
  for (const t of texts) {
    const candidates = []
    if (role) candidates.push(page.getByRole(role, { name: t, exact: false }))
    candidates.push(
      page.getByRole('tab', { name: t, exact: false }),
      page.getByRole('button', { name: t, exact: false }),
      page.getByRole('radio', { name: t, exact: false }),
      page.locator(`text="${t}"`),
      page.locator(`//*[not(self::script)][normalize-space(text())="${t}"]`),
    )
    for (const loc of candidates) {
      try {
        const el = loc.first()
        if (await el.isVisible({ timeout: 1200 })) {
          await el.click({ timeout })
          log(`[recruit] 已点击: ${t}`)
          return t
        }
      } catch { /* try next */ }
    }
  }
  return null
}

/** 判断页面是否出现登录提示 */
async function pageHasLoginPrompt(page) {
  for (const kw of config.selectors.loginFlag) {
    try {
      if (await page.locator(`text="${kw}"`).first().isVisible({ timeout: 800 })) return true
    } catch { /* ignore */ }
  }
  return false
}

/** 清理下载目录中可能干扰的旧文件 */
function cleanDownloadFiles(prefixes) {
  try {
    fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => prefixes.some(p => f.includes(p)) && /\.(xlsx|xls|csv)$/i.test(f))
      .forEach(f => {
        try { fs.unlinkSync(path.join(DOWNLOAD_DIR, f)) } catch { /* ignore */ }
      })
  } catch { /* ignore */ }
}

/** 等待新的招募统计表格文件出现在下载目录 */
async function waitForDownloadFile(prefixes, { timeout = 60000, interval = 500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => prefixes.some(p => f.includes(p)) && /\.(xlsx|xls|csv)$/i.test(f))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length > 0) {
      const target = path.join(DOWNLOAD_DIR, files[0].name)
      let lastSize = -1
      for (let i = 0; i < 10; i++) {
        const s = fs.statSync(target).size
        if (s === lastSize && s > 0) return target
        lastSize = s
        await sleep(100)
      }
      return target
    }
    await sleep(interval)
  }
  return null
}

/** 表头匹配：支持字符串或字符串数组 */
function findHeaderIndex(rawHeaders, candidate) {
  const candidates = Array.isArray(candidate) ? candidate : [candidate]
  for (const c of candidates) {
    const idx = rawHeaders.findIndex(rh => String(rh || '').includes(c))
    if (idx >= 0) return idx
  }
  return -1
}

/** 解析下载的入退会表格 */
function parseRecruitWorkbook(filePath) {
  const wb = xlsx.readFile(filePath, { type: 'file', cellText: true, cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!rows.length) return { headers: [], records: [] }

  const rawHeaders = rows[0].map(h => String(h || '').trim())
  const h = config.selectors.recruitTableHeaders

  const idx = {
    streamer: findHeaderIndex(rawHeaders, h.streamer),
    uid: findHeaderIndex(rawHeaders, h.uid),
    room: findHeaderIndex(rawHeaders, h.room),
    operator: findHeaderIndex(rawHeaders, h.operator),
    recruiter: findHeaderIndex(rawHeaders, h.recruiter),
    status: findHeaderIndex(rawHeaders, h.status),
    time: findHeaderIndex(rawHeaders, h.time),
  }

  log(`[recruit] 表头索引: ${JSON.stringify(idx)}`)

  const records = rows.slice(1).map((row, i) => {
    const streamerCell = idx.streamer >= 0 ? row[idx.streamer] : ''
    const roomFromCell = parseRoomFromStreamerCell(streamerCell)
    const roomFromCol = idx.room >= 0 ? normalizeRoom(row[idx.room]) : ''
    const room = roomFromCol || roomFromCell

    const uid = idx.uid >= 0 ? String(row[idx.uid] || '').trim() : ''

    // 运营人员优先读「经纪人」列，缺失则用「邀约人」列兜底
    let operatorRaw = idx.operator >= 0 ? row[idx.operator] : ''
    if (!String(operatorRaw || '').trim() && idx.recruiter >= 0) {
      operatorRaw = row[idx.recruiter]
    }
    const operator = parseOperator(operatorRaw)

    const recruiterRaw = idx.recruiter >= 0 ? row[idx.recruiter] : ''

    return {
      rowIndex: i + 2,
      name: String(streamerCell).split(/\r?\n/)[0].trim() || '',
      uid,
      room,
      operatorRaw: String(operatorRaw || '').trim(),
      operator,
      recruiterRaw: String(recruiterRaw || '').trim(),
      status: idx.status >= 0 ? String(row[idx.status] || '').trim() : '',
      time: idx.time >= 0 ? String(row[idx.time] || '').trim() : '',
    }
  })

  return { headers: rawHeaders, records }
}

/** 生成去重键：优先 UID，无 UID 时用 姓名+房间号+时间+状态 */
function dedupKey(r) {
  if (r.uid) return `${r.uid}|${r.time}|${r.status}`
  return `${r.name}|${r.room}|${r.time}|${r.status}`
}

/** 读取历史归档（去重库） */
function readArchive() {
  try {
    if (!fs.existsSync(ARCHIVE_FILE)) return { version: 2, updatedAt: null, records: [] }
    const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf-8'))
    if (!data || !Array.isArray(data.records)) return { version: 2, updatedAt: null, records: [] }
    return { version: 2, updatedAt: data.updatedAt || null, records: data.records }
  } catch (e) {
    log('[recruit] 读取 archive 失败:', e.message)
    return { version: 2, updatedAt: null, records: [] }
  }
}

/** 保存历史归档 */
function writeArchive(archive) {
  archive.updatedAt = new Date().toISOString()
  atomicWriteSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2))
}

/** 把新记录合并到 archive，按去重键去重 */
function mergeIntoArchive(newRecords, sourceFile) {
  const archive = readArchive()
  const existing = new Set(archive.records.map(dedupKey))
  let added = 0
  for (const r of newRecords) {
    const key = dedupKey(r)
    if (existing.has(key)) continue
    const time = r.time || ''
    const date = time ? time.slice(0, 10) : ''
    archive.records.push({
      id: key,
      name: r.name,
      uid: r.uid,
      room: r.room,
      operator: r.operator,
      operatorRaw: r.operatorRaw,
      recruiterRaw: r.recruiterRaw,
      status: r.status,
      time,
      date,
      sourceFile,
      addedAt: new Date().toISOString(),
    })
    existing.add(key)
    added += 1
  }
  writeArchive(archive)
  return { archive, added }
}

/** 按时间范围过滤 archive 记录 */
function filterByRange(records, range) {
  const now = new Date()
  const tzOffset = now.getTimezoneOffset() * 60000
  const localNow = new Date(now.getTime() - tzOffset)
  const todayStr = localNow.toISOString().slice(0, 10)

  if (range === 'all') return records

  if (range === 'thisMonth') {
    const monthPrefix = todayStr.slice(0, 7)
    return records.filter(r => (r.date || '').startsWith(monthPrefix))
  }

  if (range === 'lastMonth') {
    const y = localNow.getFullYear()
    const m = localNow.getMonth() // 0-based; 0=Jan
    const last = new Date(y, m, 1) // 本月1日
    last.setMonth(last.getMonth() - 1)
    const prefix = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`
    return records.filter(r => (r.date || '').startsWith(prefix))
  }

  // 7days / 30days / default
  const days = range === '30days' ? 30 : 7
  const start = new Date(localNow.getTime() - days * 24 * 60 * 60 * 1000)
  const startStr = start.toISOString().slice(0, 10)
  return records.filter(r => (r.date || '') >= startStr)
}

/** 按运营人员聚合，并拆分为线上/线下入会数 */
function aggregateByOperator(records, offlineRooms, rangeLabel) {
  const joinedStatus = new Set(config.selectors.statusJoined)
  const rows = records.filter(r => joinedStatus.has(r.status))

  const stats = {}
  for (const r of rows) {
    const p = r.operator || '未分配'
    if (!stats[p]) {
      stats[p] = { operator: p, online: 0, offline: 0, unknown: 0, total: 0, streamers: [] }
    }

    let bucket = 'unknown'
    if (r.room) {
      bucket = offlineRooms.has(r.room) ? 'offline' : 'online'
    }

    stats[p][bucket] += 1
    stats[p].total += 1
    stats[p].streamers.push({
      name: r.name,
      uid: r.uid,
      room: r.room || '',
      status: r.status,
      time: r.time,
      type: bucket,
    })
  }

  // 每位运营的主播列表按时间倒序
  for (const s of Object.values(stats)) {
    s.streamers.sort((a, b) => b.time.localeCompare(a.time))
  }

  const list = Object.values(stats).sort((a, b) => b.total - a.total)
  return {
    range: rangeLabel,
    totalJoined: rows.length,
    onlineTotal: list.reduce((s, x) => s + x.online, 0),
    offlineTotal: list.reduce((s, x) => s + x.offline, 0),
    unknownTotal: list.reduce((s, x) => s + x.unknown, 0),
    operators: list,
  }
}

/** 保存排查快照 */
async function dumpDebug(page, tag) {
  try {
    const LOG_DIR = path.join(DATA_DIR, '..', 'logs')
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    const base = path.join(LOG_DIR, `${tag}-${Date.now()}`)
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {})
    fs.writeFileSync(`${base}.html`, await page.content(), 'utf-8')
    log(`[recruit] 已保存排查快照: ${base}.png / .html`)
  } catch { /* ignore */ }
}

/** 根据 range 选择最合适的页面日期筛选按钮 */
function dateRangeSelectorsFor(range) {
  const s = config.selectors
  if (range === 'thisMonth') return s.dateThisMonth || s.date30Days || s.date7Days
  if (range === '30days') return s.date30Days || s.dateThisMonth || s.date7Days
  return s.date7Days || s.date30Days || s.dateThisMonth
}

/**
 * 运行入退会招募统计抓取
 * @param {Object} opts
 * @param {boolean} opts.closeBrowser - 完成后是否关闭浏览器（默认 false，保留登录态）
 * @param {boolean} opts.dryRun - 是否只解析已存在的本地文件（用于调试）
 * @param {string} opts.localFile - dryRun 时指定的本地 xlsx 路径
 * @param {string} opts.range - 数据范围：'7days'(默认) | '30days' | 'thisMonth' | 'all'
 */
export async function runUnionRecruitStats(opts = {}) {
  const { closeBrowser = false, dryRun = false, localFile = '', range = '7days' } = opts
  const startAt = new Date().toISOString()
  const rangeLabel = { '7days': '近7日', '30days': '近30日', thisMonth: '本月', all: '全部' }[range] || range

  let downloadPath = localFile
  let page

  if (!dryRun) {
    // 登录校验
    const login = await checkLogin()
    if (!login.loggedIn) {
      return { ok: false, error: '未登录B站账号，请在「数据自动同步」页扫码登录后再执行本脚本' }
    }

    const ctx = await getContext(config.headless)
    // ⚠️ 必须复用 context 中已存在的页面（Chrome 初始标签页）：
    // 实测用 ctx.newPage() 创建的标签页会在 B站 下载触发后被立即关闭，
    // 导致 download.saveAs 抛 "Target page, context or browser has been closed"
    //（2026-09-15 定位，与主播数据导出同一根因）。
    const alivePages = ctx.pages().filter((p) => !p.isClosed())
    const reusedPage = alivePages.length > 0
    page = reusedPage ? alivePages[0] : await ctx.newPage()
    try { page.removeAllListeners('response') } catch (e) { /* ignore */ }
    log('[recruit] 取用页面: ' + (reusedPage ? '复用已有' : 'ctx.newPage() 新建'))

    try {
      // 优先尝试直接打开招募管理入口页（左侧菜单可正常渲染的页面）
      const entryUrl = config.recruitUrl || 'https://live.bilibili.com/galaxy/center/'
      log(`[recruit] 打开页面: ${entryUrl}`)
      await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: config.navTimeout })
      await sleep(3500)

      if (await pageHasLoginPrompt(page)) {
        await dumpDebug(page, 'recruit-need-login')
        throw new Error('页面提示需要登录，请重新扫码登录')
      }

      // 若直接打开的不是入退会管理页，则通过左侧菜单进入
      // 注意：「入退会管理」是「主播管理」下的子菜单，必须先展开父菜单
      const onPage = await page.locator('text="入退会管理"').first().isVisible({ timeout: 2000 }).catch(() => false)
      if (!onPage) {
        log('[recruit] 未直接定位到入退会管理，尝试通过左侧菜单导航（主播管理 → 入退会管理）')
        const menuOk = await expandAndClickSubmenu(
          page,
          config.selectors.anchorManageMenu || config.selectors.recruitMenu,
          config.selectors.entryExitMenu || ['入退会管理'],
          { timeout: 8000 }
        )
        if (!menuOk) {
          await dumpDebug(page, 'recruit-menu-not-found')
          throw new Error('未找到「主播管理/入退会管理」菜单入口，请检查 B站 页面是否改版')
        }
        await sleep(1500)
      }

      // 入会管理 tab（通常默认就是，但做兜底点击）
      await clickByText(page, config.selectors.entryTab)
      await sleep(800)

      // 日期范围筛选（按 range 选择最合适的按钮，顺次回退）
      const dateSelectors = dateRangeSelectorsFor(range)
      const dateClicked = await clickByText(page, dateSelectors, { timeout: 8000 })
      if (!dateClicked) {
        await dumpDebug(page, 'recruit-no-date-range')
        log('[recruit] 警告：未找到日期范围按钮，将使用页面默认值')
      } else {
        log(`[recruit] 已选择日期范围: ${dateClicked}`)
      }
      await sleep(1500)

      // 触发下载
      cleanDownloadFiles(['入退会', 'recruit', '入会', '主播'])

      // 关键：在点击「下载」之前就注册 download 监听，并在事件触发瞬间立即保存。
      // B站 会在下载开始后极短时间内关闭承载下载的页面，晚一步就会
      // "Target page, context or browser has been closed" 而丢失文件。
      const savePromise = page
        .waitForEvent('download', { timeout: 90000 })
        .then(async (dl) => {
          const suggested = dl.suggestedFilename() || `recruit_${Date.now()}.xlsx`
          const p = path.join(DOWNLOAD_DIR, `recruit_${Date.now()}_${suggested.replace(/[^\w.\-（）、\u4e00-\u9fa5]/g, '_')}`)
          log('[recruit] download 事件已触发，立即保存: ' + suggested)
          try {
            await dl.saveAs(p)
            return p
          } catch (err) {
            log('[recruit] download.saveAs 失败(' + err.message + ')，尝试 download.path()')
            try {
              const tmp = await dl.path()
              if (tmp && fs.existsSync(tmp)) { fs.copyFileSync(tmp, p); return p }
            } catch (e2) { /* ignore */ }
            return null
          }
        })
        .catch(() => null)

      const exported = await clickByText(page, config.selectors.recruitExportButton, { timeout: 10000 })
      if (!exported) {
        await dumpDebug(page, 'recruit-no-export')
        throw new Error('未找到「下载/导出」按钮，请检查 B站 页面是否改版')
      }

      // 等待下载文件落盘（savePromise 在 download 事件触发的瞬间就已开始保存）
      downloadPath = await savePromise
      if (!downloadPath) {
        log('[recruit] 未取得下载文件，轮询下载目录')
        downloadPath = await waitForDownloadFile(['入退会', 'recruit', '入会', '主播'], { timeout: 60000 })
      }

      if (!downloadPath || !fs.existsSync(downloadPath)) {
        await dumpDebug(page, 'recruit-no-download')
        throw new Error('导出未产生下载文件')
      }
      log(`[recruit] 已下载: ${downloadPath}`)
    } catch (e) {
      if (page) await page.close().catch(() => {})
      if (closeBrowser) await closeContext().catch(() => {})
      return { ok: false, error: e.message }
    }
  } else if (!downloadPath || !fs.existsSync(downloadPath)) {
    return { ok: false, error: 'dryRun 模式需指定存在的本地文件' }
  }

  // 解析并统计
  try {
    const { headers, records } = parseRecruitWorkbook(downloadPath)
    const offlineRooms = readOfflineRooms()

    // 合并到历史归档（去重库）
    const { archive, added } = mergeIntoArchive(records, downloadPath)

    // 按请求的 range 生成展示结果
    const effectiveRange = range === 'all' ? 'all' : range
    const filtered = filterByRange(archive.records, effectiveRange)
    const summary = aggregateByOperator(filtered, offlineRooms, rangeLabel)

    const result = {
      ok: true,
      generatedAt: startAt,
      range: effectiveRange,
      rangeLabel,
      file: downloadPath,
      headers,
      archiveTotal: archive.records.length,
      newlyAdded: added,
      ...summary,
    }

    atomicWriteSync(OUTPUT_FILE, JSON.stringify(result, null, 2))
    log(`[recruit] 统计完成 [${rangeLabel}]: ${summary.totalJoined} 人已入会（线上 ${summary.onlineTotal} / 线下 ${summary.offlineTotal} / 未知 ${summary.unknownTotal}），archive 共 ${archive.records.length} 条，新增 ${added} 条`)

    if (page) await page.close().catch(() => {})
    if (closeBrowser) await closeContext().catch(() => {})
    return result
  } catch (e) {
    log('[recruit] 解析/统计失败:', e.message)
    if (page) await page.close().catch(() => {})
    if (closeBrowser) await closeContext().catch(() => {})
    return { ok: false, error: e.message }
  }
}

/** 仅基于现有 archive 重新聚合（用于切换时间范围而无需重新抓取）
 * @param {string} range - '7days' | '30days' | 'thisMonth' | 'all'
 * @param {string|null} month - 指定自然月 'YYYY-MM'（优先级高于 range），用于历史月份（如 2026-07）回看
 */
export function aggregateRecruitStats(range = 'thisMonth', month = null) {
  const archive = readArchive()
  const offlineRooms = readOfflineRooms()
  const joinedStatus = new Set(config.selectors.statusJoined)

  // 可用月份清单（用于前端月份选择器），按升序排列
  const monthSet = new Set()
  for (const r of archive.records) {
    if (r.date) monthSet.add(r.date.slice(0, 7))
  }
  const availableMonths = Array.from(monthSet).sort()

  // 月度趋势：逐月聚合「已入会」总数及线上/线下/未知拆分
  const monthlyTrend = availableMonths.map(m => {
    let total = 0, online = 0, offline = 0, unknown = 0
    for (const r of archive.records) {
      if ((r.date || '').slice(0, 7) !== m) continue
      if (!joinedStatus.has(r.status)) continue
      total += 1
      let bucket = 'unknown'
      if (r.room) bucket = offlineRooms.has(r.room) ? 'offline' : 'online'
      if (bucket === 'online') online += 1
      else if (bucket === 'offline') offline += 1
      else unknown += 1
    }
    return { month: m, total, online, offline, unknown }
  })

  const rangeLabel = month
    ? month
    : ({ '7days': '近7日', '30days': '近30日', thisMonth: '本月', all: '全部' }[range] || range)
  const filtered = month
    ? archive.records.filter(r => (r.date || '').slice(0, 7) === month)
    : filterByRange(archive.records, range)
  const summary = aggregateByOperator(filtered, offlineRooms, rangeLabel)
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    range,
    rangeLabel,
    month: month || null,
    availableMonths,
    monthlyTrend,
    archiveTotal: archive.records.length,
    newlyAdded: 0,
    ...summary,
  }
}
