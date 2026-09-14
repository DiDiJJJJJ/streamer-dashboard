import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteSync } from './utils/atomicWrite.js'

export const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')

export const DATA_DIR = path.join(__dirname, 'data')
export const DOWNLOAD_DIR = path.join(__dirname, 'downloads')
export const PROFILE_DIR = path.join(__dirname, '.chrome-profile')
export const LOG_DIR = path.join(__dirname, 'logs')

for (const d of [DATA_DIR, DOWNLOAD_DIR, PROFILE_DIR, LOG_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function detectChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { if (p && fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return null
}

const DEFAULTS = {
  port: 8787,
  // 管理员口令：首次启动自动生成并写入 config.json（留空即自动生成随机值）
  adminToken: '',
  // B站直播公会中心 - 主播数据页
  targetUrl: 'https://live.bilibili.com/galaxy/center/data/anchor',
  // B站直播公会中心 - 招募统计入口页；先打开左侧菜单可正常渲染的页面，
  // 再通过「主播管理 → 入退会管理」菜单导航（直接路径常 404，走菜单更稳）
  recruitUrl: 'https://live.bilibili.com/galaxy/center/data/anchor',
  loginUrl: 'https://passport.bilibili.com/login',
  chromePath: detectChrome(),
  headless: true,
  // 定时任务（cron 表达式）
  cronToday: '*/20 * * * *',      // 每 20 分钟抓取【今日】
  cronYesterday: '30 13 * * *',    // 每日 13:30 抓取【昨日】（延后至源数据更新更完整，避免过早抓取导致载入不全）
  cronYesterdayFinal: '30 14 * * *', // 每日 14:30 用「按日期精确」补抓【昨日】最终结算值（绕过易失效的「昨日」页签，避免抓成今日数据；byDate 单日导出不含大航海，已由 mergeRecords 保留）
  cronRecruit7Days: '0 9 * * *',   // 每日 09:00 抓取【近7天】入退会记录并合并去重
  cronKpiMonthly: '10 0 * * *',    // 每日 00:10 结算已过完的自然月 KPI 完成情况
  // KPI 月度结算延迟天数：自然月结束后，次月的前 N 天内持续刷新该月结算（兼容 T+N 延迟结算，
  // 月末最后一天的终值要等次月 1 日 14:30 的「按日期精确」补抓才落定）；
  // 过了该窗口才冻结快照，此后历史不再被自动改写。
  kpiSettleDelayDays: 3,
  // KPI 月度考核豁免月份：这些自然月的 KPI 完成情况不结算、不归档（如仅作历史数据补录、不参与考核的月份）。
  // 仅影响 KPI 月度结算归档，不影响「运营月度统计」页面的数据展示与环比。
  kpiExcludedMonths: ['2026-07'],
  timezone: 'Asia/Shanghai',
  // 错过的定时任务补跑：服务在计划时刻未运行（关机/崩溃/手动停止）时，
  // 启动后自动回溯并立即补抓一次，避免当天数据断档
  catchUpMissed: true,
  catchUpMaxAgeHours: 36,         // 错过超过该时长则不再补跑（补跑只能抓到"当前的昨日"）
  catchUpGraceMinutes: 2,         // 距计划时刻不足该分钟数时不补跑，交给正常 cron 触发
  // 主播移除同步：今日抓取快照作为在册权威来源；某房间连续 N 分钟未出现在今日抓取中即判定为已移出
  removedGraceMinutes: 60,         // 宽限期（分钟）：防御单次抓取残缺 / 网络抖动导致误删（cron 每 20 分钟，60 分钟≈连续 3 次未出现）
  removedMinHealthyCount: 800,     // 今日抓取条数低于该值视为异常抓取，暂停移除逻辑以防误删
  // 运营团队变动同步：与主播移除同源（今日抓取快照作为在册权威来源），检测运营经纪人新增 / 减少
  opsGraceMinutes: 60,             // 宽限期（分钟）：某在职运营连续未出现于抓取数据达此时长才标记离职，防御抖动
  opsMinHealthyCount: 800,         // 今日抓取条数低于该值视为异常，暂停离职判定并回退 latest 当月数据
  navTimeout: 60000,
  actionTimeout: 20000,
  // 页面元素识别关键词（B站改版时可在 config.json 中覆盖，无需改代码）
  selectors: {
    todayTab: ['今日', '今天'],
    yesterdayTab: ['昨日', '昨天'],
    exportButton: ['导出数据', '导出明细', '数据导出', '导出', '下载'],
    dailySummaryButton: ['按日汇总下载', '按日汇总', '日汇总下载'],
    // 入退会管理 / 招募统计页面用选择器（文案改版时可在 config.json 覆盖）
    // 主播管理是左侧主菜单，入退会管理是其子菜单，需要先点击主播管理展开
    recruitMenu: ['主播管理', '入退会管理'],
    anchorManageMenu: ['主播管理'],
    entryExitMenu: ['入退会管理'],
    entryTab: ['入会管理'],
    exitTab: ['退会管理'],
    // 入退会页面日期范围筛选（按顺序尝试，命中即停）
    date7Days: ['近7日', '近 7 日', '7天', '最近7天'],
    date30Days: ['近30日', '近 30 日', '30天', '最近30天'],
    dateThisMonth: ['本月'],
    recruitExportButton: ['下载', '导出数据', '导出明细'],
    // 表格列头匹配（支持多候选，顺序优先；同时兼容旧版字符串配置）
    recruitTableHeaders: {
      streamer: ['主播昵称', '主播', '主播信息'],
      uid: ['UID', '用户ID', 'B站UID'],
      room: ['房间号', '直播间ID', '房间ID'],
      operator: ['经纪人', '运营经纪人', '运营人员'],
      cooperation: ['合作时间', '合作时长', '合作期限'],
      recruiter: ['邀约人', '招募经纪人', '邀请人'],
      status: ['邀约状态', '状态'],
      time: ['时间点', '时间'],
      statTime: ['统计时间'],
    },
    statusJoined: ['已入会'],
    loginFlag: ['扫码登录', '请登录', '登录', '手机号登录'],
  },
}

const CONFIG_FILE = path.join(__dirname, 'config.json')

function loadUserConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch (e) {
    console.warn('[config] config.json 解析失败，使用默认配置:', e.message)
  }
  return {}
}

const userConfig = loadUserConfig()

export const config = {
  ...DEFAULTS,
  ...userConfig,
  selectors: { ...DEFAULTS.selectors, ...(userConfig.selectors || {}) },
}

export function saveConfig(patch) {
  const next = { ...loadUserConfig(), ...patch }
  atomicWriteSync(CONFIG_FILE, JSON.stringify(next, null, 2))
  Object.assign(config, patch)
  return config
}

export function log(...args) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: config.timezone })
  const line = `[${ts}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  console.log(line)
  try {
    const f = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`)
    fs.appendFileSync(f, line + '\n', 'utf-8')
  } catch { /* ignore */ }
}
