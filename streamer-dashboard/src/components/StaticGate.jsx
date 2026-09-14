import { useState } from 'react'

// 静态托管口令门：VITE_STATIC_PASSWORD 为空时不设防（直接进入）。
// 解锁状态仅保存在 sessionStorage，关闭浏览器后需重新输入。
const STORAGE_KEY = 'static_dashboard_unlocked_v1'

export function StaticGate({ children }) {
  const expected = import.meta.env.VITE_STATIC_PASSWORD || ''
  const [unlocked, setUnlocked] = useState(() => {
    if (!expected) return true
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')

  if (unlocked) return children

  function submit(e) {
    e.preventDefault()
    if (val === expected) {
      try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
      setUnlocked(true)
      setErr('')
    } else {
      setErr('口令错误，请重试')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200" />
          <div>
            <h1 className="text-base font-bold text-slate-900">线下主播看板</h1>
            <p className="mt-0.5 text-[11px] text-slate-500">只读静态模式 · 需访问口令</p>
          </div>
        </div>
        <input
          type="password"
          value={val}
          onChange={(e) => { setVal(e.target.value); if (err) setErr('') }}
          placeholder="请输入访问口令"
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
        />
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          进入看板
        </button>
        <p className="mt-5 text-[10px] leading-relaxed text-slate-400">
          数据来源于源机最新抓取快照（{new Date().toLocaleDateString('zh-CN')} 更新）。
          口令校验仅防误入，不构成强安全防护，请勿传播链接。
        </p>
      </form>
    </div>
  )
}