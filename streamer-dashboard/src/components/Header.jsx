import { RefreshCw, Upload, Clock, Menu, AlertCircle, Lock } from 'lucide-react'
import { useVersion } from '../hooks/useVersion'

const ADMIN_TOKEN_KEY = 'sync_admin_token'
function defaultApiBase() {
  // 前端与同步服务同源（8787 直接托管，或经隧道代理），用相对路径即可
  if (typeof window !== 'undefined' && window.location.port === '8787') return ''
  return 'http://localhost:8787'
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function VersionBadge() {
  const { version, hasUpdate } = useVersion()
  if (!version) return null
  return (
    <span
      title={`版本 ${version.version}${version.buildTime ? '\n构建时间 ' + new Date(version.buildTime).toLocaleString('zh-CN') : ''}`}
      className={`hidden items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium sm:inline-flex ${
        hasUpdate ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {hasUpdate ? <AlertCircle size={10} /> : null}
      v{version.version}
    </span>
  )
}

export function Header({
  title,
  icon: Icon,
  lastUpdated,
  onSync,
  onImport,
  onMenuClick,
  loading,
}) {
  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const token = localStorage.getItem(ADMIN_TOKEN_KEY) || ''
    if (!token) {
      alert('需要管理员口令：请先打开「数据自动同步」页，在顶部输入管理员口令后再导入 Excel。')
      e.target.value = ''
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      const res = await fetch(`${defaultApiBase()}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ fileBase64: b64, fileName: file.name }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) throw new Error('管理员口令错误，请在「数据自动同步」页重新输入正确口令')
      if (!res.ok || !json.ok) throw new Error(json.error || `导入失败 (HTTP ${res.status})`)
      const check = json.check
      const warn = check?.warnings?.length ? '\n\n警告：' + check.warnings.join('；') : ''
      alert(`导入成功（已完整替换旧数据）\n校验：${check?.summary || json.count + ' 条'}${warn}`)
      // 重新从服务端拉取，覆盖本地可能被污染的缓存
      onSync?.()
    } catch (err) {
      alert('导入失败：' + err.message)
    } finally {
      e.target.value = ''
    }
  }

  function handleSync() {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY) || ''
    if (!token) {
      alert('需要管理员口令：请先打开「数据自动同步」页，在顶部输入管理员口令后再同步数据。')
      return
    }
    onSync?.()
  }

  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="fx-pop flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
        >
          <Menu size={20} />
        </button>
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.65)]">
            <Icon size={18} />
          </span>
        )}
        <div key={title} className="fx-enter flex flex-col">
          <h1 className="text-[19px] font-bold leading-tight tracking-tight text-slate-900">{title}</h1>
          <span className="text-[11px] font-medium tracking-[0.08em] text-slate-400">线下主播管理后台</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-1 text-xs text-text-secondary sm:flex">
          <Clock size={14} />
          <span>更新时间 {formattedTime}</span>
        </div>

        <VersionBadge />

        <label className="fx-lift flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
          <Upload size={14} />
          <span className="hidden sm:inline">导入Excel</span>
          <Lock size={11} className="opacity-70" />
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>

        <button
          onClick={handleSync}
          disabled={loading}
          className="fx-glow flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">同步数据</span>
        </button>
      </div>
    </header>
  )
}
