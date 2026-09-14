import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

/**
 * 涨跌（趋势）展示统一口径 —— 遵循国内「红涨绿跌」习惯
 *
 *   上升（数值变大）→ 红色 text-trend-up
 *   下降（数值变小）→ 绿色 text-trend-down
 *   持平（无变化）  → 中性灰 text-trend-flat
 *
 * 所有涨跌幅统一：带正负号 + 方向箭头，且箭头与文字同色。
 * 色值定义在 src/index.css 的 @theme（--color-trend-up/down/flat）。
 */

/** 判定趋势方向：up / down / flat */
export function trendOf(value) {
  const n = Number(value) || 0
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'flat'
}

/** 百分比格式化：+12.3% / -4.5% / 0.0%（负号由 toFixed 自带，正数补 +） */
export function fmtPct(n, digits = 1) {
  const v = Number(n) || 0
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}%` : `${s}%`
}

/** 趋势方向 → 文字颜色 class */
export function trendTextClass(t) {
  if (t === 'up') return 'text-trend-up'
  if (t === 'down') return 'text-trend-down'
  return 'text-trend-flat'
}

/** 趋势方向 → 图标组件 */
export function trendIcon(t) {
  if (t === 'up') return ArrowUp
  if (t === 'down') return ArrowDown
  return Minus
}

/**
 * 涨跌幅徽标：方向箭头 + 带正负号的百分比，箭头与文字同色。
 * pct 为 null/undefined/NaN 时展示占位「—」。
 */
export function TrendBadge({ pct, size = 12, digits = 1, className = '', showArrow = true }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return <span className={`inline-flex items-center gap-0.5 text-[11px] text-text-muted ${className}`}>—</span>
  }
  const t = trendOf(pct)
  const Icon = trendIcon(t)
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-semibold ${trendTextClass(t)} ${className}`}>
      {showArrow && <Icon size={size} strokeWidth={2.75} className="shrink-0" />}
      <span>{fmtPct(pct, digits)}</span>
    </span>
  )
}

/**
 * 绝对变化量（差额）：+¥1,200 / -¥800 / ¥0，带方向箭头且同色。
 * fmt 只负责「正数格式化」，正负号与箭头由本组件统一处理（避免出现 ¥-1,200 这类写法）。
 */
export function DeltaText({ delta, fmt, size = 12, className = '', unit = '' }) {
  if (delta === null || delta === undefined || Number.isNaN(Number(delta))) {
    return <span className={`text-[11px] text-text-muted ${className}`}>—</span>
  }
  const t = trendOf(delta)
  const Icon = trendIcon(t)
  const abs = Math.abs(Number(delta))
  const body = typeof fmt === 'function' ? fmt(abs) : String(abs)
  const signed = t === 'up' ? `+${body}` : t === 'down' ? `-${body}` : body
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-semibold ${trendTextClass(t)} ${className}`}>
      <Icon size={size} strokeWidth={2.75} className="shrink-0" />
      <span>{signed}{unit}</span>
    </span>
  )
}
