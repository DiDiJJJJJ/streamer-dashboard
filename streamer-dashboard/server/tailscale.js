// Tailscale 虚拟组网访问支持
// ------------------------------------------------------------
// 背景：Cloudflare 临时隧道在当前网络下不可用（QUIC 被封、HTTP/2 连上即断），
// 改用 Tailscale 组虚拟内网，手机/电脑登录同一账号后手机可直接访问本机 8787。
// 这里集中封装：检测是否安装、读取本机 Tailscale 虚拟 IP、判断在线状态。
// ------------------------------------------------------------
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const PORT = 8787

// 常见安装路径；优先 PATH，兜底到这些位置
const CANDIDATES = [
  'tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
]

function resolveBin() {
  for (const c of CANDIDATES) {
    // PATH 里的直接用，否则检查文件存在
    if (c === 'tailscale') return c
    if (fs.existsSync(c)) return c
  }
  return null
}

function run(args, timeoutMs = 8000) {
  const bin = resolveBin()
  if (!bin) return { ok: false, installed: false, stdout: '', stderr: '' }
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
    return {
      ok: r.status === 0,
      installed: true,
      stdout: (r.stdout || '').toString(),
      stderr: (r.stderr || '').toString(),
    }
  } catch (e) {
    return { ok: false, installed: false, stdout: '', stderr: String(e && e.message) }
  }
}

// 返回本机 Tailscale 状态摘要
export function getTailscaleStatus() {
  const bin = resolveBin()
  if (!bin) {
    return {
      installed: false,
      online: false,
      needsLogin: false,
      ips: [],
      url: null,
      port: PORT,
      reason: '未检测到 Tailscale，请先运行「安装并启动Tailscale.bat」安装并登录',
    }
  }

  // 1) 取本机 IPv4 虚拟地址
  const ipRes = run(['ip', '-4'])
  let ips = []
  if (ipRes.ok) {
    ips = ipRes.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s))
  }

  // 2) 取状态（判断是否在线 / 是否需要登录）
  let online = false
  let needsLogin = false
  const stRes = run(['status', '--json'])
  if (stRes.ok) {
    try {
      const obj = JSON.parse(stRes.stdout)
      // Self 节点代表本机
      const self = obj && obj.Self
      if (self) {
        online = !!self.Online
        if (Array.isArray(self.TailscaleIPs) && self.TailscaleIPs.length === 0) needsLogin = true
      } else {
        // 没有 Self 节点通常意味着尚未登录
        needsLogin = true
      }
    } catch {
      // status 解析失败：以能否拿到 IP 兜底
      online = ips.length > 0
    }
  } else {
    // status 命令失败（常见于未登录）
    needsLogin = true
  }

  // 3) 若拿到了 IP 但 status 说未在线，仍以 IP 为准（status 偶有误报）
  if (ips.length > 0) online = true

  const url = ips.length ? `http://${ips[0]}:${PORT}` : null
  let reason = ''
  if (!ips.length) {
    reason = needsLogin ? 'Tailscale 已安装但未登录，请运行「安装并启动Tailscale.bat」完成登录' : 'Tailscale 未就绪，请确认服务已启动'
  } else if (!online) {
    reason = 'Tailscale 在线但未连到网络，请检查本机网络'
  } else {
    reason = 'Tailscale 已就绪，手机安装 Tailscale 并登录同一账号后即可访问'
  }

  return {
    installed: true,
    online,
    needsLogin,
    ips,
    url,
    port: PORT,
    reason,
  }
}
