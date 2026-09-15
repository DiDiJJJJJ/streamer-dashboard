import { useState, useEffect } from 'react'
import { Sidebar, menuItems } from './components/Sidebar'
import { Header } from './components/Header'
import { Dashboard } from './components/Dashboard'
import { ChallengePage } from './components/ChallengePage'
import { StreamersList } from './components/StreamersList'
import { AgentDashboard } from './components/AgentDashboard'
import { StreamerDataPage } from './components/StreamerDataPage'
import { UnionRecruitPage } from './components/UnionRecruitPage'
import { OperatorMonthlyPage } from './components/OperatorMonthlyPage'
import { OpsTeamPage } from './components/OpsTeamPage'
import { OfflineStreamersDataPage } from './components/OfflineStreamersDataPage'
import { StreamerCycleFlowPage } from './components/StreamerCycleFlowPage'
import { SyncPage } from './components/SyncPage'
import {
  VenueOps, TeamPerf, StreamerTier, ContentData, BizAnalysis, Ranking, RiskControl, Benchmark,
} from './components/modules/AnalysisModules'
import { useStreamerData } from './hooks/useStreamerData'
import { StaticGate } from './components/StaticGate'

const titles = {
  dashboard: '主播数据',
  streamers: '主播名册',
  agents: '运营数据看板',
  sync: '数据自动同步',
  challenge: '线下主播赛事管理',
  venue: '场地运营',
  team: '团队管理',
  tier: '主播分层',
  content: '内容数据',
  biz: '经营分析',
  ranking: '排行榜',
  risk: '风控中心',
  benchmark: '对标基准',
  streamerdata: '主播数据对比',
  recruit: '入会招募统计',
  opmonthly: '运营月度统计',
  opteam: '运营团队变动',
  offlinelist: '线下主播数据列表',
  cycleflow: '主播周期流水',
}

function App() {
  const [activeMenu, setActiveMenu] = useState('dashboard')
  const [sidebarHover, setSidebarHover] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tunnelToast, setTunnelToast] = useState(null) // 外网地址更新弹窗
  const sidebarExpanded = sidebarHover || mobileOpen
  const IS_STATIC = !!import.meta.env.VITE_STATIC
  // 静态模式下可真实渲染的页面（仅靠已嵌入的 streamer_data.json / props 客户端计算即可运行）；
  // 不在名单内的页面（主播名册 CRUD、招募/月度/团队 API 页、周期流水 API 页）点击后显示占位提示。
  const STATIC_ALLOWED = new Set([
    'dashboard', 'streamerdata', 'agents', 'offlinelist',
    'challenge', 'venue', 'team', 'tier', 'content', 'biz', 'ranking', 'risk', 'benchmark',
  ])
  const forceStaticPlaceholder = IS_STATIC && !STATIC_ALLOWED.has(activeMenu)
  const {
    records,
    streamers,
    offlineStreamers,
    loading,
    error,
    lastUpdated,
    importRecords,
    clearRecords,
    clearAllData,
    addOfflineRoom,
    removeOfflineRoom,
    batchAddOfflineRooms,
    setStreamerStatus,
    updateExtra,
    importOfflineStreamers,
    fetchRosterBatches,
    rollbackRosterBatch,
    syncData,
    roster,
  } = useStreamerData()

  // 外网地址更新：订阅 SSE，收到 tunnel-updated 即弹出最新地址提示框
  useEffect(() => {
    if (import.meta.env.VITE_STATIC) return
    let es
    try {
      es = new EventSource('./api/events')
      es.addEventListener('tunnel-updated', (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data && data.url) setTunnelToast({ url: data.url, at: data.at })
        } catch { /* ignore */ }
      })
    } catch { /* 不支持 SSE 时忽略 */ }
    return () => { if (es) es.close() }
  }, [])

  return (
    <StaticGate>
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        active={activeMenu}
        onChange={(key) => {
          setActiveMenu(key)
          setMobileOpen(false)
        }}
        expanded={sidebarExpanded}
        onMouseEnter={() => setSidebarHover(true)}
        onMouseLeave={() => setSidebarHover(false)}
        mobileOpen={mobileOpen}
        onMobileToggle={() => setMobileOpen((o) => !o)}
      />

      {/* 移动端抽屉遮罩：点击空白关闭侧栏（仅 ≤md 显示） */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`flex flex-1 flex-col min-w-0 overflow-x-hidden transition-all duration-300 ${
          sidebarExpanded ? 'md:ml-64' : 'md:ml-20'
        }`}
      >
        <Header
          title={titles[activeMenu]}
          icon={menuItems.flatMap(m => m.children ? [m, ...m.children] : [m]).find(m => m.key === activeMenu)?.icon}
          lastUpdated={lastUpdated}
          onSync={syncData}
          onImport={importRecords}
          onMenuClick={() => setMobileOpen(true)}
          loading={loading}
        />

        {error && (
          <div className="mx-4 mt-4 rounded-md bg-red-50 px-4 py-2 text-xs text-danger">
            数据加载失败：{error}
          </div>
        )}

        <main className="flex-1 min-w-0">
          {forceStaticPlaceholder && (
            <div className="m-6 rounded-2xl border border-amber-200 bg-amber-50 p-10 text-center">
              <div className="text-3xl">🔒</div>
              <h2 className="mt-3 text-base font-semibold text-amber-900">{titles[activeMenu] || '此功能'}</h2>
              <p className="mt-2 text-xs leading-relaxed text-amber-700">
                此功能依赖后端实时接口，在只读静态模式下不可用。<br />
                请通过 Tailscale 虚拟组网或本地后端访问完整功能。
              </p>
            </div>
          )}
          {activeMenu === 'dashboard' && <Dashboard records={records} loading={loading} onNavigate={(key) => setActiveMenu(key)} />}
          {!forceStaticPlaceholder && (<>
          {activeMenu === 'streamers' && (
            <StreamersList
              records={offlineStreamers}
              onSetStatus={setStreamerStatus}
              onUpdateExtra={updateExtra}
              offlineRooms={offlineStreamers.map(r => r['房间号'])}
              onAddOfflineRoom={addOfflineRoom}
              onRemoveOfflineRoom={removeOfflineRoom}
              onBatchAddOfflineRooms={batchAddOfflineRooms}
              onImportOffline={importOfflineStreamers}
              onFetchBatches={fetchRosterBatches}
              onRollbackBatch={rollbackRosterBatch}
            />
          )}
          {activeMenu === 'agents' && <AgentDashboard records={records} />}
          </>)}
          {activeMenu === 'streamerdata' && <StreamerDataPage records={records} />}
          {!forceStaticPlaceholder && (<>
          {activeMenu === 'recruit' && <UnionRecruitPage />}
          {activeMenu === 'opmonthly' && <OperatorMonthlyPage />}
          {activeMenu === 'opteam' && <OpsTeamPage />}
          {activeMenu === 'offlinelist' && (
            <OfflineStreamersDataPage offlineStreamers={offlineStreamers} records={records} />
          )}
          {activeMenu === 'cycleflow' && <StreamerCycleFlowPage />}
          {activeMenu === 'sync' && (
            <SyncPage
              onImport={importRecords}
              onClearRecords={clearRecords}
              onClearAll={clearAllData}
              onSync={syncData}
            />
          )}
          {activeMenu === 'challenge' && <ChallengePage records={records} roster={roster} />}
          {activeMenu === 'venue' && <VenueOps records={records} roster={roster} />}
          {activeMenu === 'team' && <TeamPerf records={records} roster={roster} />}
          {activeMenu === 'tier' && <StreamerTier records={records} roster={roster} />}
          {activeMenu === 'content' && <ContentData records={records} roster={roster} />}
          {activeMenu === 'biz' && <BizAnalysis records={records} roster={roster} />}
          {activeMenu === 'ranking' && <Ranking records={records} roster={roster} />}
          {activeMenu === 'risk' && <RiskControl records={records} roster={roster} />}
          {activeMenu === 'benchmark' && <Benchmark records={records} roster={roster} />}
          </>)}
        </main>
      </div>

      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm text-text shadow-lg">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            数据加载中...
          </div>
        </div>
      )}

      {/* 外网地址更新提示框 */}
      {tunnelToast && (
        <div className="fixed bottom-6 right-6 z-[60] w-[min(92vw,420px)] rounded-2xl border border-border bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              🌐
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text">外网地址已更新</div>
              <div className="mt-0.5 text-[11px] text-text-secondary">
                {tunnelToast.at ? new Date(tunnelToast.at).toLocaleString('zh-CN') : ''}
              </div>
              <a
                href={tunnelToast.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all rounded-lg bg-bg px-2 py-1.5 text-[12.5px] font-medium text-brand-600 underline"
              >
                {tunnelToast.url}
              </a>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                try { navigator.clipboard?.writeText(tunnelToast.url) } catch { /* ignore */ }
                setTunnelToast(null)
              }}
              className="fx-pop rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text hover:bg-bg"
            >
              复制并关闭
            </button>
            <a
              href={tunnelToast.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setTunnelToast(null)}
              className="fx-pop rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
            >
              打开
            </a>
          </div>
        </div>
      )}
    </div>
    </StaticGate>
  )
}

export default App
