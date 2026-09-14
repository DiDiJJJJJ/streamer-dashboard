import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { config, PROFILE_DIR, DOWNLOAD_DIR, log } from './config.js'

let context = null
let currentHeadless = null
let launching = null

/**
 * Chrome 的「单实例」标记文件。上一个 Chrome 被强杀（进程卡死后 taskkill）时这些文件会残留，
 * 导致新实例启动即自杀，报 `launchPersistentContext: Target page, context or browser has been closed`。
 */
const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']

function clearProfileLocks() {
  const cleared = []
  for (const name of SINGLETON_FILES) {
    const p = path.join(PROFILE_DIR, name)
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true, recursive: true })
        cleared.push(name)
      }
    } catch { /* ignore */ }
  }
  return cleared
}

/** 启动持久化上下文；失败则清理残留单实例锁后重试一次 */
async function launchPersistent(launchOpts) {
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, launchOpts)
  } catch (e) {
    const first = String(e?.message || e).split('\n')[0]
    const cleared = clearProfileLocks()
    log(`[browser] 启动失败: ${first}`)
    log(`[browser] 已清理 profile 残留锁 [${cleared.join(', ') || '无'}]，2 秒后重试一次`)
    await new Promise((r) => setTimeout(r, 2000))
    return await chromium.launchPersistentContext(PROFILE_DIR, launchOpts)
  }
}

/**
 * 获取持久化浏览器上下文（登录状态保存在 .chrome-profile 目录，扫码一次长期有效）
 * 同一个 userDataDir 不能被两个实例同时占用，因此切换 headless 模式时会先关闭旧实例。
 */
export async function getContext(headless = config.headless) {
  if (context && currentHeadless === headless) return context
  if (launching) await launching

  // 复用已存在的持久化上下文：避免在 headless 模式切换时关闭用户正在使用的登录窗口，
  // 从而导致 B站 会话中断（表现为「账号自动退出」）。登录态由 .chrome-profile 持久化，
  // 切换 headless 与否不影响 cookie，因此直接复用最安全。
  if (context) return context

  launching = (async () => {
    if (!config.chromePath) {
      throw new Error('未检测到本机 Chrome/Edge 浏览器，请在 server/config.json 中设置 chromePath')
    }
    log(`[browser] 启动浏览器 headless=${headless} path=${config.chromePath}`)
    context = await launchPersistent({
      executablePath: config.chromePath,
      headless,
      acceptDownloads: true,
      downloadsPath: DOWNLOAD_DIR,
      viewport: { width: 1600, height: 950 },
      locale: 'zh-CN',
      timezoneId: config.timezone,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-features=Translate',
      ],
    })
    currentHeadless = headless
    context.setDefaultTimeout(config.actionTimeout)
    context.setDefaultNavigationTimeout(config.navTimeout)
    // 抹掉 webdriver 指纹
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    context.on('close', () => { context = null; currentHeadless = null })
    return context
  })()

  try {
    return await launching
  } finally {
    launching = null
  }
}

export async function closeContext() {
  if (context) {
    try { await context.close() } catch { /* ignore */ }
    context = null
    currentHeadless = null
    log('[browser] 浏览器已关闭')
  }
}

/** 判断当前是否已登录B站 */
export async function checkLogin() {
  const ctx = await getContext(true)
  const page = await ctx.newPage()
  try {
    const res = await page.goto('https://api.bilibili.com/x/web-interface/nav', {
      waitUntil: 'domcontentloaded',
      timeout: config.navTimeout,
    })
    const body = await res.text()
    const json = JSON.parse(body)
    const loggedIn = json?.code === 0 && json?.data?.isLogin === true
    return {
      loggedIn,
      uname: json?.data?.uname || '',
      uid: json?.data?.mid || '',
    }
  } catch (e) {
    log('[browser] 登录状态检测失败:', e.message)
    return { loggedIn: false, uname: '', uid: '', error: e.message }
  } finally {
    await page.close().catch(() => {})
  }
}

/** 打开有头浏览器让用户扫码登录 */
export async function openLoginWindow() {
  await closeContext()
  const ctx = await getContext(false)
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  log('[browser] 已打开登录窗口，请在浏览器中扫码登录')
  return true
}
