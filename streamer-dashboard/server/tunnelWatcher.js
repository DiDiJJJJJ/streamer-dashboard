// 外网隧道地址监听 + 变更记录
// ------------------------------------------------------------
// 痛点：Cloudflare 临时隧道地址每次重启都会变化，旧方案让用户去
// tunnel.log 里几千行日志里 grep「trycloudflare.com」，繁琐易错。
// 这里集中解决：
//   1) 监听 server/tunnel.log，自动提取最新外网地址；
//   2) 维护 server/data/tunnel_history.json 变更历史（按时间倒序）；
//   3) 地址变化或手动登记时 emit bus 事件，前端据此弹窗 / 刷新历史。
// ------------------------------------------------------------
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, DATA_DIR, log } from './config.js'
import { bus } from './events.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

const TUNNEL_LOG = path.join(ROOT, 'server', 'tunnel.log')
const HISTORY_FILE = path.join(DATA_DIR, 'tunnel_history.json')
const TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi
const MAX_ENTRIES = 1000

// type 取值：'tunnel'（隧道地址，自动）| 'password'（管理员密码变更，手动）| 'other'（其他关键信息，手动）
// 每条记录：{ id, at(ISO), type, value, note }

let history = []
let current = { url: '', at: '', type: 'tunnel', healthy: null, reason: '' }
let watchTimer = null
let watcher = null

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function loadHistory() {
  history = []
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
      if (Array.isArray(arr)) history = arr
    }
  } catch (e) {
    log('[tunnel] load history failed: ' + e.message)
  }
  rebuildCurrent()
}

function rebuildCurrent() {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if (e.type === 'tunnel' && e.value) {
      current = { url: e.value, at: e.at, type: 'tunnel', ...checkTunnelHealth(e.value) }
      return
    }
  }
  current = { url: '', at: '', type: 'tunnel', healthy: false, reason: '尚未检测到外网地址' }
}

function persist() {
  try {
    atomicWriteSync(HISTORY_FILE, JSON.stringify(history, null, 2))
  } catch (e) {
    log('[tunnel] persist failed: ' + e.message)
  }
}

function lastTunnelUrl() {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if (e.type === 'tunnel' && e.value) return e.value
  }
  return null
}

function extractLatestUrl(text) {
  const m = text.match(TUNNEL_RE)
  return m && m.length ? m[m.length - 1] : null
}

function parseLogLine(line) {
  // cloudflared 的 --logfile 在不同版本/参数下可能是 JSON 或文本格式，都做兼容
  const text = String(line || '')
  try {
    const obj = JSON.parse(text)
    if (obj && obj.time) return { time: obj.time, message: String(obj.message || obj.msg || '') }
  } catch { /* 不是 JSON，继续按文本解析 */ }

  // 文本格式示例：
  // 2026-09-11T10:23:45+08:00 ERR Serve tunnel error ... protocol=quic
  const m = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})\s+(\w+)\s+(.+)$/)
  if (m) return { time: m[1], level: m[2], message: m[3] }
  return { time: '', message: text }
}

function checkTunnelHealth(url) {
  if (!url) return { healthy: false, reason: '尚未检测到外网地址' }
  if (!fs.existsSync(TUNNEL_LOG)) return { healthy: false, reason: '未找到 tunnel.log，cloudflared 可能未启动' }

  try {
    const lines = fs.readFileSync(TUNNEL_LOG, 'utf8').split(/\r?\n/).filter(Boolean)
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 最近 5 分钟
    const recent = []
    for (const line of lines) {
      const r = parseLogLine(line)
      if (r.time && r.time >= since) recent.push(r)
    }

    const all = lines.map(parseLogLine).filter((r) => r.time)
    const lastLog = all.length ? all[all.length - 1] : null
    const messages = recent.map((r) => r.message)

    // 如果最近日志显示进程已退出/停止，直接判为不健康
    const isStoppedLog = (m) =>
      m.includes('Tunnel server stopped') ||
      m.includes('Initiating shutdown') ||
      m.includes('initial tunnel connection failed') ||
      m.includes('Tunnel server exited')

    if (messages.some(isStoppedLog)) {
      return { healthy: false, reason: 'cloudflared 已退出/停止，请重新运行启动脚本建立隧道' }
    }

    if (recent.length === 0) {
      // 没有最近日志：如果文件非常旧，判为不健康；否则未知
      const stat = fs.statSync(TUNNEL_LOG)
      const ageMin = (Date.now() - stat.mtimeMs) / 60000
      if (ageMin > 10) return { healthy: false, reason: '隧道日志超过 10 分钟未更新，cloudflared 可能已停止' }
      return { healthy: true, reason: '最近 5 分钟无异常日志' }
    }

    const hasQuicFailure = messages.some((m) =>
      m.includes('failed to dial to edge with quic') ||
      m.includes('failed to accept QUIC stream') ||
      m.includes('protocol=quic')
    )
    const hasFatal = messages.some((m) =>
      m.includes('failed to serve tunnel connection') ||
      m.includes('Serve tunnel error')
    )
    const hasRetryOnly = messages.every((m) =>
      m.includes('Retrying connection') ||
      m.includes('failed to serve tunnel connection') ||
      m.includes('Serve tunnel error') ||
      m.includes('context canceled') ||
      m.includes('failed to dial to edge')
    )
    const hasSuccess = messages.some((m) =>
      m.includes('registered tunnel') ||
      m.includes('started tunnel') ||
      m.includes('Your quick tunnel') ||
      m.includes('Request') // 有 HTTP 流量进来也算可用
    )

    if (hasQuicFailure && !hasSuccess) {
      return {
        healthy: false,
        reason: '检测到 UDP/QUIC 被当前网络限制，请改用 --protocol http2 或在启动脚本中切换为 HTTP/2 模式',
      }
    }
    if (hasFatal && !hasSuccess) {
      return { healthy: false, reason: '隧道连接失败，可能是多个 cloudflared 实例冲突或网络异常' }
    }
    if (hasRetryOnly && !hasSuccess) {
      return { healthy: false, reason: '隧道正在反复重连，尚未建立成功' }
    }
    if (hasSuccess) {
      return { healthy: true, reason: '隧道最近有成功连接/流量' }
    }
    return { healthy: null, reason: '健康状态未知' }
  } catch (e) {
    return { healthy: null, reason: '健康检查异常：' + e.message }
  }
}

function recordTunnel(url, note) {
  if (!url) return false
  if (lastTunnelUrl() === url) return false // 地址未变化，不重复记录
  const at = new Date().toISOString()
  const entry = { id: genId(), at, type: 'tunnel', value: url, note: note || '' }
  history.push(entry)
  if (history.length > MAX_ENTRIES) history = history.slice(-MAX_ENTRIES)
  persist()
  current = { url, at, type: 'tunnel', ...checkTunnelHealth(url) }
  bus.emit('tunnel-updated', { url, at, note: note || '', healthy: current.healthy, reason: current.reason })
  log('[tunnel] new address recorded: ' + url)
  return true
}

function scanLog() {
  try {
    if (!fs.existsSync(TUNNEL_LOG)) return
    const text = fs.readFileSync(TUNNEL_LOG, 'utf8')
    const url = extractLatestUrl(text)
    if (url) {
      const recorded = recordTunnel(url)
      if (!recorded) {
        // 地址没变，但健康状态可能变化，刷新 current
        current = { ...current, ...checkTunnelHealth(url) }
      }
    } else {
      current = { url: '', at: '', type: 'tunnel', healthy: false, reason: '尚未检测到外网地址' }
    }
  } catch (e) {
    log('[tunnel] scan failed: ' + e.message)
  }
}

export function startTunnelWatch() {
  loadHistory()
  scanLog() // 启动时先扫一次（可能已有日志）
  try {
    if (fs.existsSync(TUNNEL_LOG)) {
      watcher = fs.watch(TUNNEL_LOG, () => {
        clearTimeout(watchTimer)
        watchTimer = setTimeout(scanLog, 400) // 防抖：cloudflared 可能多次写
      })
    } else {
      // 文件尚未创建：监听 server 目录，等 tunnel.log 出现
      watcher = fs.watch(path.join(ROOT, 'server'), (_ev, fn) => {
        if (fn === 'tunnel.log') {
          clearTimeout(watchTimer)
          watchTimer = setTimeout(scanLog, 400)
        }
      })
    }
  } catch (e) {
    log('[tunnel] watch init failed: ' + e.message)
  }
}

export function stopTunnelWatch() {
  try { watcher?.close() } catch { /* ignore */ }
  clearTimeout(watchTimer)
}

export function getCurrentTunnel() {
  if (current.url) {
    return { ...current, ...checkTunnelHealth(current.url) }
  }
  return { ...current }
}

// 查询历史：支持 from / to（ISO 字符串，含当天用 >=）与 limit
export function getTunnelHistory({ from, to, limit } = {}) {
  let list = history.slice().reverse() // 最新在前
  if (from) list = list.filter((e) => e.at >= from)
  if (to) list = list.filter((e) => e.at <= to)
  if (limit && Number.isFinite(Number(limit))) list = list.slice(0, Number(limit))
  return list
}

// 手动登记（管理员密码 / 其他关键信息变更）
export function addManualEntry({ type, value, note } = {}) {
  const at = new Date().toISOString()
  const entry = {
    id: genId(),
    at,
    type: type || 'other',
    value: value || '',
    note: note || '',
  }
  history.push(entry)
  if (history.length > MAX_ENTRIES) history = history.slice(-MAX_ENTRIES)
  persist()
  bus.emit('changelog-updated', { entry })
  return entry
}
