// 挑战赛海报：原生 Canvas 2D 手绘，B站风格视觉（品牌粉 #FB7299 + 蓝 #00AEEC、小电视/弹幕质感）。
// 资源：/logo.png（公会 logo）、/ziluo-avatar.png（拳击紫小萝虚拟形象）。
// 按赛道（排位赛 / 晋级赛）分别成块展示；统计时间仅显示在顶部并精确到 时:分；底部仅保留解释权声明。

function loadImage(src, opts = {}) {
  const { crossOrigin = null, timeout = 8000 } = opts
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('图片加载超时（' + timeout + 'ms）：' + src))
    }, timeout)
    img.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('图片加载失败：' + src))
    }
    img.src = src
  })
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function ellipsis(ctx, text, maxW) {
  if (!text) return ''
  if (ctx.measureText(text).width <= maxW) return text
  let t = String(text)
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function fmtMoney(v) {
  return '¥' + Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

// B站配色
const BILI_PINK = '#FB7299'
const BILI_PINK_DK = '#E85A8A'
const BILI_PINK_LT = '#FF9CBE'
const BILI_BLUE = '#00AEEC'
const INK = '#2b2b33'
const GOLD = '#FFD24A'

// 弹幕内容词池（B站 风格梗），数量需 ≥ DANMAKU_COUNT，保证 45 条随机取词有充足来源
const DANMAKU_POOL = [
  '666', '前方高能', 'awsl', '太强了', '哈哈哈', '下饭', '秀儿', 'yyds', '考据', '泪目',
  '名场面', '爷青回', '一键三连', '弹幕护体', '高能预警', '镇站之宝', '我磕到了', '好家伙',
  '蚌埠住了', '针不戳', '典中典', '退退退', '妙啊', '舒服了', '真香', '绝绝子', '泰裤辣',
  '三连了', '下次一定', '猛男必看', '课代表', '前排', '留名', '关注了', '催更', '宝藏UP',
  '神仙打架', '封神之作', '回忆杀', 'awsl+1', '哈哈哈哈', '针不戳啊', '芜湖', '起飞',
  '上才艺', '梦开始的地方', '不愧是你', '膜拜', '破防了', '有内味了', '名场面+1', '草率了',
]
// 约定：海报中渲染的随机弹幕严格为 45 条
const DANMAKU_COUNT = 45

/** 画一个「小电视」图标（B站标志性视觉元素） */
function drawTv(ctx, x, y, s, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = s * 0.12
  // 天线
  ctx.beginPath()
  ctx.moveTo(x + s * 0.32, y + s * 0.28)
  ctx.lineTo(x + s * 0.12, y)
  ctx.moveTo(x + s * 0.68, y + s * 0.28)
  ctx.lineTo(x + s * 0.88, y)
  ctx.stroke()
  // 机身
  roundRect(ctx, x, y + s * 0.28, s, s * 0.62, s * 0.14)
  ctx.fill()
  // 屏幕
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  roundRect(ctx, x + s * 0.12, y + s * 0.38, s * 0.76, s * 0.42, s * 0.08)
  ctx.fill()
  // 屏幕里的小表情（点+弧）
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(x + s * 0.38, y + s * 0.55, s * 0.04, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(x + s * 0.62, y + s * 0.55, s * 0.04, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** 弹幕气泡（B站 标志性质感） */
function drawDanmaku(ctx, x, y, text, alpha, color) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = 'bold 14px ' + FONT
  const w = ctx.measureText(text).width + 22
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  roundRect(ctx, x, y, w, 26, 13); ctx.fill()
  ctx.fillStyle = color
  ctx.fillText(text, x + 11, y + 18)
  ctx.restore()
}

/**
 * 渲染一整片随机弹幕（约定严格 count 条）。
 * 内容从 DANMAKU_POOL 随机取，位置/字号/透明度/颜色均随机分布，
 * 整体以低透明度铺在画面上，模拟 B站 视频弹幕飘过的质感。
 */
function drawDanmakuField(ctx, count, W, H, PAD) {
  const colors = [BILI_BLUE, '#ffffff', BILI_PINK, BILI_PINK_LT, '#FFE08A']
  const margin = PAD
  const top = 120
  const bottom = H - 90
  for (let i = 0; i < count; i++) {
    const text = DANMAKU_POOL[Math.floor(Math.random() * DANMAKU_POOL.length)]
    const size = 12 + Math.floor(Math.random() * 4) // 12~15px
    ctx.font = 'bold ' + size + 'px ' + FONT
    const tw = ctx.measureText(text).width
    const maxX = W - margin * 2 - tw - 12
    const x = margin + Math.random() * Math.max(0, maxX - margin)
    const y = top + Math.random() * (bottom - top)
    const alpha = 0.14 + Math.random() * 0.26 // 0.14~0.40，半透明不压字
    const color = colors[Math.floor(Math.random() * colors.length)]
    drawDanmaku(ctx, x, y, text, alpha, color)
  }
}

/**
 * 渲染挑战赛本周榜单海报
 * @param {Object} board { weekLabel, totals:{参赛人数,达标人数,总流水}, top3:[], rows:[] }
 * @param {Object} opts { statTime: string(精确到 时:分), bg?: string[] } bg 为颜色数组（>=2 个），不传则用 B站 粉→蓝 默认渐变
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPoster(board, opts = {}) {
  const W = 720
  const H = 1380
  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'alphabetic'

  const PAD = 36

  // 背景：B站 粉→蓝 渐变；支持通过 opts.bg 配置任意多色渐变
  const bgColors = Array.isArray(opts.bg) && opts.bg.length >= 2 ? opts.bg : [BILI_PINK, BILI_BLUE]
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bgColors.forEach((c, i) => bg.addColorStop(bgColors.length === 1 ? 0 : i / (bgColors.length - 1), c))
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 装饰光斑
  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(640, 90, 150, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(70, 1320, 220, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  // 小电视水印（右上角淡色）
  drawTv(ctx, W - PAD - 54, PAD - 6, 60, 'rgba(255,255,255,0.18)')

  // 顶部少量固定弹幕点缀（保留 B站 质感），主体随机弹幕由 drawDanmakuField 统一渲染
  drawDanmaku(ctx, 60, 250, '666', 0.45, BILI_BLUE)
  drawDanmaku(ctx, 470, 320, '前方高能', 0.38, '#ffffff')

  // 资源预加载（同站资源无需 crossOrigin；带超时兜底，任何异常均降级而非卡死）
  let avatar = null
  let logo = null
  try { avatar = await loadImage('/ziluo-avatar.png', { timeout: 8000 }) } catch (e) { /* ignore */ }
  try { logo = await loadImage('/logo.png', { timeout: 8000 }) } catch (e) { /* ignore */ }

  let y = PAD

  // 顶部：logo + 公会名
  if (logo) {
    ctx.save()
    roundRect(ctx, PAD, y, 46, 46, 12); ctx.clip()
    ctx.drawImage(logo, PAD, y, 46, 46)
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5
    roundRect(ctx, PAD, y, 46, 46, 12); ctx.stroke()
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px ' + FONT
  ctx.fillText('紫萝传媒', PAD + 58, y + 22)
  ctx.font = '12px ' + FONT
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.fillText('STREAMER OPERATION', PAD + 58, y + 39)

  // 顶部右侧：拳击紫小萝虚拟形象（粉环）
  const ar = 52
  const acx = W - PAD - ar
  const acy = y + ar
  ctx.save()
  ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
  if (avatar) {
    const iw = avatar.width, ih = avatar.height
    const s = Math.max((ar * 2) / iw, (ar * 2) / ih)
    ctx.drawImage(avatar, acx - (iw * s) / 2, acy - (ih * s) / 2, iw * s, ih * s)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(acx - ar, acy - ar, ar * 2, ar * 2)
  }
  ctx.restore()
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2); ctx.stroke()

  y += 84
  // 标题
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 38px ' + FONT
  ctx.fillText('2026 暑期主播挑战赛', PAD, y + 34)
  ctx.font = 'bold 22px ' + FONT
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillText('本周榜单 · 数据战报', PAD, y + 66)
  // 数据统计周期：优先用数据真实的统计周期(board.statTime)，而非页面生成时刻
  ctx.font = '13px ' + FONT
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  const period = board.statTime || board.weekLabel || (opts.statTime || '')
  if (period) ctx.fillText('数据统计周期 ' + period, PAD, y + 90)
  y += 132

  // 三项汇总（白卡 + 粉描边）
  const stats = [
    { label: '参赛人数', value: String(board.totals?.参赛人数 ?? 0) },
    { label: '达标人数', value: String(board.totals?.达标人数 ?? 0) },
    { label: '总流水', value: fmtMoney(board.totals?.总流水 ?? 0) },
  ]
  const gap = 14
  const sw = (W - PAD * 2 - gap * 2) / 3
  stats.forEach((s, i) => {
    const x = PAD + i * (sw + gap)
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    roundRect(ctx, x, y, sw, 80, 18); ctx.fill()
    ctx.fillStyle = 'rgba(251,114,153,0.18)'
    roundRect(ctx, x, y, sw, 6, 3); ctx.fill()
    ctx.fillStyle = '#8a8a96'
    ctx.font = '13px ' + FONT
    ctx.fillText(s.label, x + 16, y + 32)
    ctx.fillStyle = INK
    ctx.font = 'bold 21px ' + FONT
    ctx.fillText(ellipsis(ctx, s.value, sw - 32), x + 16, y + 60)
  })
  y += 80 + 22

  // TOP3 领奖台（排位赛）
  const top3 = (board.top3 || []).slice(0, 3)
  if (top3.length) {
    const colors = [GOLD, '#C7CDD6', '#E8A35C']
    const pgap = 12
    const pw = (W - PAD * 2 - pgap * 2) / 3
    const ph = 156
    top3.forEach((s, i) => {
      const x = PAD + i * (pw + pgap)
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, x, y, pw, ph, 18); ctx.fill()
      ctx.fillStyle = colors[i]
      ctx.beginPath(); ctx.arc(x + pw / 2, y + 26, 18, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = INK
      ctx.font = 'bold 18px ' + FONT
      ctx.textAlign = 'center'
      ctx.fillText(String(i + 1), x + pw / 2, y + 32)
      ctx.textAlign = 'left'
      ctx.fillStyle = INK
      ctx.font = 'bold 15px ' + FONT
      ctx.fillText(ellipsis(ctx, s.主播昵称 || s.name || '主播', pw - 28), x + 14, y + 76)
      ctx.fillStyle = BILI_PINK
      ctx.font = 'bold 16px ' + FONT
      ctx.fillText(fmtMoney(s.总流水), x + 14, y + 102)
      ctx.fillStyle = '#9aa0aa'
      ctx.font = '11px ' + FONT
      ctx.fillText('排位赛 · TOP' + (i + 1), x + 14, y + 126)
    })
    y += ph + 22
  }

  // 按赛道分组展示
  const rankRows = (board.rows || []).filter(r => (r.赛道 || '排位赛') === '排位赛')
  const promoRows = (board.rows || []).filter(r => (r.赛道 || '') === '晋级赛')
  const topKeys = new Set(top3.map(t => t.房间号 || t.room))

  function drawTrack(title, rows, color, maxN) {
    const list = rows.slice(0, maxN)
    if (!list.length) return
    // 赛道标题条
    ctx.fillStyle = color
    roundRect(ctx, PAD, y, 8, 22, 4); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 17px ' + FONT
    ctx.fillText(title, PAD + 16, y + 17)
    y += 34
    const rowH = 44
    list.forEach((r, i) => {
      const ry = y + i * rowH
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.16)'
      roundRect(ctx, PAD, ry, W - PAD * 2, rowH - 8, 12); ctx.fill()
      // 排名
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 16px ' + FONT
      ctx.fillText(String(i + 1), PAD + 16, ry + 28)
      // 昵称
      ctx.font = '15px ' + FONT
      ctx.fillText(ellipsis(ctx, r.主播昵称 || r.name || '主播', W - PAD * 2 - 150), PAD + 46, ry + 28)
      // 流水（右对齐）
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 15px ' + FONT
      ctx.textAlign = 'right'
      ctx.fillText(fmtMoney(r.总流水), W - PAD - 16, ry + 28)
      ctx.textAlign = 'left'
    })
    y += list.length * rowH + 18
  }

  // 排位赛：TOP3 已展示，这里补全其余（共最多 8 位）
  const rankRest = rankRows.filter(r => !topKeys.has(r.房间号 || r.room)).slice(0, 8 - top3.length)
  drawTrack('排位赛', rankRest, BILI_BLUE, 8 - top3.length)
  // 晋级赛：最多 6 位
  drawTrack('晋级赛', promoRows, GOLD, 6)

  // 整片随机弹幕（严格 45 条，内容/位置/透明度随机分布），铺在内容之上呈飘弹幕质感
  drawDanmakuField(ctx, DANMAKU_COUNT, W, H, PAD)

  // 页脚：仅保留解释权声明
  const fy = H - 56
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '13px ' + FONT
  ctx.fillText('【活动最终解释权归紫萝传媒所有】', W / 2, fy)
  ctx.textAlign = 'left'

  return canvas
}
