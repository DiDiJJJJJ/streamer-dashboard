/**
 * 抓取运行锁 + 硬超时守护。
 *
 * 背景：抓取流程中任意一个 await（Playwright 下载、页面等待、文件解析）若永不 resolve，
 * try/finally 的 finally 永远不会执行，state.running 会一直停留在 true，
 * 之后所有定时抓取都会被「上一次抓取仍在进行中」跳过 —— 表现为数据永久停更。
 *
 * 因此这里提供两层保护：
 *  1) 运行锁带时间戳，超过硬超时的锁视为僵死锁，自动释放（自愈）；
 *  2) 对外层调用施加硬超时，超时后强制关闭浏览器并释放锁。
 *
 * 运行令牌（runToken）用于避免「超时后被放弃的旧任务」在稍后苏醒时，
 * 误把新任务持有的锁释放掉。
 */

/** 单次抓取允许的最长时间，超过即判定卡死（默认 12 分钟，可用环境变量覆盖） */
export const FETCH_HARD_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.FETCH_HARD_TIMEOUT_MS) || 12 * 60 * 1000,
)

/**
 * 判断抓取锁是否真的被占用。
 * 若锁已持有超过硬超时（或缺少时间戳，属于历史遗留的脏状态），则视为僵死锁并自动释放。
 * @returns {boolean} true 表示确实有抓取在进行中，调用方应跳过
 */
export function isRunLocked(state, log) {
  if (!state.running) return false

  const since = state.runningSince ? new Date(state.runningSince).getTime() : 0
  const age = Date.now() - since

  if (!since || Number.isNaN(since) || age > FETCH_HARD_TIMEOUT_MS) {
    const mins = since && !Number.isNaN(since) ? (age / 60000).toFixed(1) : '未知'
    log?.(`[guard] 检测到僵死的抓取锁（已持有 ${mins} 分钟，超过 ${Math.round(FETCH_HARD_TIMEOUT_MS / 60000)} 分钟上限），自动释放后继续本次抓取`)
    state.running = false
    state.runningSince = null
    state.runToken = null
    return false
  }
  return true
}

/** 获取抓取锁，返回本次运行的令牌 */
export function acquireRun(state) {
  state.running = true
  state.runningSince = new Date().toISOString()
  state.runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return state.runToken
}

/**
 * 释放抓取锁。
 * 若传入令牌与当前锁的令牌不一致，说明本次运行早已被超时放弃、锁已被别的运行持有，
 * 此时不做任何事，避免误释放。
 * @returns {boolean} 是否真的释放了
 */
export function releaseRun(state, token) {
  if (token && state.runToken && token !== state.runToken) return false
  state.running = false
  state.runningSince = null
  state.runToken = null
  return true
}

/** 超时错误标记，便于调用方识别 */
export const TIMEOUT_FLAG = '__FETCH_HARD_TIMEOUT__'

/**
 * 给异步任务施加硬超时。超时后 reject，但被放弃的任务仍可能在后台继续（无法真正中断），
 * 因此调用方需要在超时分支里强制关闭浏览器，让残留的 await 尽快抛错退出。
 */
export function withHardTimeout(label, ms, task) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} 超过 ${Math.round(ms / 60000)} 分钟仍未完成，已判定卡死并强制中止`)
      err[TIMEOUT_FLAG] = true
      reject(err)
    }, ms)
    if (typeof timer?.unref === 'function') timer.unref()
  })

  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer))
}

export function isTimeoutError(e) {
  return Boolean(e && e[TIMEOUT_FLAG])
}
