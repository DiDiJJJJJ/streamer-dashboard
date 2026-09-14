import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, parseISO } from 'date-fns'

const tabs = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
]

// 快捷日期筛选：今日/昨日/本周/本月 即时生效；自定义区间需点击"查询"才生效
export function QuickDateFilter({ onApply, defaultMode = 'all' }) {
  const [mode, setMode] = useState(defaultMode)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')

  useEffect(() => {
    const today = new Date()
    let range = null
    let label = '全部'
    if (mode === 'today') {
      range = { start: startOfDay(today), end: endOfDay(today) }
      label = '今日'
    } else if (mode === 'yesterday') {
      const y = subDays(today, 1)
      range = { start: startOfDay(y), end: endOfDay(y) }
      label = '昨日'
    } else if (mode === 'week') {
      range = { start: startOfWeek(today, { weekStartsOn: 1 }), end: endOfWeek(today, { weekStartsOn: 1 }) }
      label = '本周'
    } else if (mode === 'month') {
      range = { start: startOfMonth(today), end: endOfMonth(today) }
      label = '本月'
    } else if (mode === 'custom' && appliedStart && appliedEnd) {
      range = { start: parseISO(appliedStart), end: parseISO(appliedEnd) }
      label = '自定义'
    }
    onApply(range ? { ...range, label } : null)
  }, [mode, appliedStart, appliedEnd, onApply])

  function handleQuery() {
    if (customStart && customEnd) {
      setAppliedStart(customStart)
      setAppliedEnd(customEnd)
      setMode('custom')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => setMode(t.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === t.key
              ? 'bg-brand-600 text-white'
              : 'border border-border bg-white text-text-secondary hover:border-brand-400 hover:text-brand-700'
          }`}
        >
          {t.label}
        </button>
      ))}
      <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
        <Calendar size={12} className="text-text-secondary" />
        <input
          type="date"
          value={customStart}
          onChange={e => setCustomStart(e.target.value)}
          className="border-none bg-transparent text-xs outline-none w-24"
        />
        <span className="text-text-secondary">~</span>
        <input
          type="date"
          value={customEnd}
          onChange={e => setCustomEnd(e.target.value)}
          className="border-none bg-transparent text-xs outline-none w-24"
        />
      </div>
      <button
        onClick={handleQuery}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
      >
        查询
      </button>
    </div>
  )
}
