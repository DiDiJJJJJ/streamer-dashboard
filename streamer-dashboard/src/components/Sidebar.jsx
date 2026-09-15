import { useState } from 'react'
import { LayoutDashboard, Users, BarChart3, Trophy, RefreshCcw, Menu, X, Building2, UserCog, Layers, Radio, Wallet, Award, ShieldAlert, GitCompareArrows, ChevronDown, ChevronRight } from 'lucide-react'

// 运营数据看板为父级菜单，内含子菜单（主播数据 等）
// requiresBackend: true 表示该项在静态托管模式下隐藏（依赖后端实时接口或为写操作页）
export const menuItems = [
  { key: 'dashboard', label: '主播数据', icon: LayoutDashboard },
  {
    key: 'streamers',
    label: '线下主播管理',
    icon: Users,
    children: [
      { key: 'streamers', label: '主播名册' },
      { key: 'offlinelist', label: '线下主播数据' },
      { key: 'cycleflow', label: '主播周期流水' },
    ],
  },
  {
    key: 'agents',
    label: '运营数据看板',
    icon: BarChart3,
    children: [
      { key: 'agents', label: '运营总览' },
      { key: 'streamerdata', label: '主播数据' },
      { key: 'recruit', label: '入会招募统计' },
      { key: 'opmonthly', label: '运营月度统计' },
      { key: 'opteam', label: '运营团队变动' },
    ],
  },
  { key: 'sync', label: '数据自动同步', icon: RefreshCcw, requiresBackend: true },
  { key: 'challenge', label: '线下主播赛事管理', icon: Trophy },
  { key: 'venue', label: '场地运营', icon: Building2 },
  { key: 'team', label: '团队管理', icon: UserCog },
  { key: 'tier', label: '主播分层', icon: Layers },
  { key: 'content', label: '内容数据', icon: Radio },
  { key: 'biz', label: '经营分析', icon: Wallet },
  { key: 'ranking', label: '排行榜', icon: Award },
  { key: 'risk', label: '风控中心', icon: ShieldAlert },
  { key: 'benchmark', label: '对标基准', icon: GitCompareArrows },
]

// 取某菜单项（含子菜单）所有可导航 key，用于判断是否处于激活分支
function itemKeys(item) {
  if (item.children && item.children.length) return item.children.map(c => c.key)
  return [item.key]
}

export function Sidebar({ active, onChange, expanded, onMouseEnter, onMouseLeave, mobileOpen, onMobileToggle }) {
  // 父级菜单展开状态（默认展开「运营数据看板」）
  const [openGroups, setOpenGroups] = useState(() => new Set(['agents', 'streamers']))

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed left-0 top-0 z-40 flex h-full flex-col border-r border-slate-800 bg-slate-900 transition-all duration-300 ease-out ${
        expanded ? 'w-64' : 'w-20'
      } ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 overflow-hidden border-b border-slate-800 px-4">
        <img
          src="/logo.png"
          alt="公司logo"
          className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-white/10"
        />
        <span className={`whitespace-nowrap text-[15px] font-bold tracking-wide text-white transition-all duration-200 ${
          expanded ? 'ml-0 max-w-[200px] opacity-100' : 'ml-0 max-w-0 opacity-0'
        }`}>线下主播看板</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {(import.meta.env.VITE_STATIC
          ? menuItems
              .map(m => m.children ? { ...m, children: m.children.filter(c => !c.requiresBackend) } : m)
              .filter(m => !m.requiresBackend && (!m.children || m.children.length > 0))
          : menuItems
        ).map(item => {
          const Icon = item.icon
          const keys = itemKeys(item)
          const branchActive = keys.includes(active)
          // 展开态：默认打开含激活子项的组；收起态(仅图标)悬停展开整条侧栏，子项随组展开显示
          const groupOpen = expanded && (openGroups.has(item.key) || branchActive)

          if (item.children && item.children.length) {
            return (
              <div key={item.key}>
                <button
                  onClick={() => toggleGroup(item.key)}
                  className={`fx-nav flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium tracking-[0.02em] transition-all ${
                    expanded ? 'justify-start' : 'justify-center'
                  } ${
                    branchActive
                      ? 'is-active bg-brand-600 text-white shadow-[0_6px_18px_-6px_rgba(37,99,235,0.75)]'
                      : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                  }`}
                  title={item.label}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className={`flex-1 overflow-hidden whitespace-nowrap text-left transition-all duration-200 ${
                    expanded ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0'
                  }`}>{item.label}</span>
                  {expanded && (
                    groupOpen
                      ? <ChevronDown size={14} className="shrink-0 opacity-70" />
                      : <ChevronRight size={14} className="shrink-0 opacity-70" />
                  )}
                </button>

                {/* 子菜单 */}
                <div className={`space-y-1 overflow-hidden transition-all duration-200 ${
                  groupOpen ? 'mt-1 max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
                }`}>
                  {item.children.map(child => {
                    const childActive = active === child.key
                    return (
                      <button
                        key={child.key}
                        onClick={() => onChange(child.key)}
                        className={`flex w-full items-center gap-2 rounded-lg py-2 pl-11 pr-3 text-[12.5px] font-medium tracking-[0.02em] transition-all ${
                          childActive
                            ? 'bg-brand-600/90 text-white shadow-[0_4px_14px_-6px_rgba(37,99,235,0.7)]'
                            : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                        }`}
                        title={child.label}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          childActive ? 'bg-white' : 'bg-slate-600'
                        }`} />
                        <span className="truncate">{child.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          }

          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className={`fx-nav flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium tracking-[0.02em] transition-all ${
                expanded ? 'justify-start' : 'justify-center'
              } ${
                isActive
                  ? 'is-active bg-brand-600 text-white shadow-[0_6px_18px_-6px_rgba(37,99,235,0.75)]'
                  : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
              }`}
              title={item.label}
            >
              <Icon size={18} className="shrink-0" />
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${
                expanded ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0'
              }`}>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <button
        onClick={onMobileToggle}
        className="fx-pop absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 md:hidden"
      >
        <X size={16} />
      </button>
    </aside>
  )
}
