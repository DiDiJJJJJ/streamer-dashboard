// 流水展示组件：整数部分加粗，小数部分保持原样式（如 ¥157,559.40）
export function Money({ value, prefix = '¥', className = '' }) {
  const n = Number(value || 0)
  const formatted = n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const [intPart, decPart] = formatted.split('.')
  return (
    <span className={className}>
      {prefix}
      <span className="font-bold">{intPart}</span>
      {decPart ? `.${decPart}` : ''}
    </span>
  )
}
