import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarClock, Clock, Crown, ChevronDown, Search, AlertTriangle, Inbox, Users2, UserX, X } from 'lucide-react'

// 金额格式化
function fmtMoney(n) {
  const v = Number(n) || 0
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const CYCLE_LABELS = ['第一周期', '第二周期', '第三周期']

export function StreamerCycleFlowPage() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | active | inactive

  const [detailRoom, setDetailRoom] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [expanded, setExpanded] = useState({})

  // 拉取所有线下主播周期流水一览
  useEffect(() => {
    setLoading(true)
    fetch('/api/streamer-cycle-flow/summary')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setSummary(j); else setError(j.error || '加载失败') })
      .catch((e) => setError('加载失败：' + e.message))
      .finally(() => setLoading(false))
  }, [])

  // 选中主播后拉取完整周期流水（含每日明细）
  const loadDetail = useCallback((room) => {
    if (!room) return
    setDetailLoading(true); setDetailError(''); setDetail(null)
    fetch('/api/streamer-cycle-flow?room=' + encodeURIComponent(room))
      .then((r) => r.json())
      .then((j) => { if (j.ok) setDetail(j); else setDetailError(j.error || '查询失败') })
      .catch((e) => setDetailError('查询失败：' + e.message))
      .finally(() => setDetailLoading(false))
  }, [])
  useEffect(() => { if (detailRoom) loadDetail(detailRoom) }, [detailRoom, loadDetail])

  const rows = summary ? summary.rows : []
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (kw && !((r.nickname || '').toLowerCase().includes(kw) || r.room.includes(kw))) return false
      return true
    })
  }, [rows, keyword, statusFilter])

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active' && !r.beyondThree).length
    const ended = rows.filter((r) => r.beyondThree).length
    return { active, ended, inactive: rows.length - active - ended }
  }, [rows])

  const toggleExpand = (c) => setExpanded((prev) => ({ ...prev, [c]: !prev[c] }))

  return (
    <div className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-text">
          <CalendarClock size={20} className="text-brand-600" />
          主播周期流水
        </h2>
        <p className="mt-1 text-[12px] text-text-muted">
          以主播首次开播当天为起点，每 30 天为一周期（第 1~30 / 31~60 / 61~90 天）。下表一览所有线下主播的周期流水，当前所在周期已高亮；点击任意主播可展开其各周期每日明细。
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-red-50 px-4 py-2.5 text-xs text-danger">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-10 text-sm text-text-secondary">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          正在计算周期流水…
        </div>
      )}

      {!loading && summary && (
        <>

          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:w-72">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索主播昵称 / 房间号"
                className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm text-text shadow-sm outline-none focus:border-brand-500"
              />
            </div>
            <div className="flex items-center gap-1">
              {[
                { k: 'all', label: '全部' },
                { k: 'active', label: '在职' },
                { k: 'inactive', label: '离职' },
              ].map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setStatusFilter(opt.k)}
                  className={'rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ' + (statusFilter === opt.k ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-text-secondary border border-border hover:bg-bg')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-[12px] text-text-muted">
              共 <b className="text-text">{filtered.length}</b> 位（在职 {stats.active} / 离职 {stats.inactive} / 新主播周期已结束 {stats.ended}）· 基准 {summary.refDate}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="w-full min-w-[880px] text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-slate-100 text-text text-[13px] font-bold">
                  <th className="px-3 py-2.5 text-left font-medium">主播</th>
                  <th className="px-3 py-2.5 text-left font-medium">状态</th>
                  <th className="px-3 py-2.5 text-left font-medium">首次开播</th>
                  <th className="px-3 py-2.5 text-center font-medium">当前周期</th>
                  <th className="px-3 py-2.5 text-center font-medium">距下周期</th>
                  <th className="px-3 py-2.5 text-right font-medium">第一周期</th>
                  <th className="px-3 py-2.5 text-right font-medium">第二周期</th>
                  <th className="px-3 py-2.5 text-right font-medium">第三周期</th>
                  <th className="px-3 py-2.5 text-right font-medium">三周期累计</th>
                  <th className="px-3 py-2.5 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-text-muted">无匹配主播</td>
                  </tr>
                )}
                {filtered.map((row) => {
                  const cur = row.currentCycle
                  return (
                    <tr
                      key={row.room}
                      className={'border-b border-border/60 transition-colors hover:bg-brand-50/50 ' + (detailRoom === row.room ? 'bg-brand-50/70' : '')}
                    >
                      <td className="px-3 py-2.5">
                        <button onClick={() => setDetailRoom(row.room)} className="text-left">
                          <div className="font-semibold text-text">{row.nickname || '未命名'}</div>
                          <div className="text-[11px] text-text-muted">{row.room}</div>
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            <Users2 size={11} /> 在职
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                            <UserX size={11} /> 离职{row.leaveDate ? ' · ' + row.leaveDate : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.firstBroadcast || '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {row.beyondThree ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            <Inbox size={11} /> 新主播周期已结束
                          </span>
                        ) : row.currentCycle > 0 ? (
                          <span className="font-semibold text-brand-600">第{row.currentCycle}周期</span>
                        ) : (
                          <span className="text-text-muted">未开播</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-text-secondary">
                        {row.beyondThree ? '—' : (row.daysRemaining != null ? row.daysRemaining + '天' : '—')}
                      </td>
                      {row.cycles.map((c) => {
                        const isCur = c.cycle === cur && !row.beyondThree
                        return (
                          <td
                            key={c.cycle}
                            className={'px-3 py-2.5 text-right ' + (!row.beyondThree && c.totalFlow >= 10000 ? 'bg-red-50 font-bold text-red-600' : (isCur ? 'bg-brand-50 font-semibold text-brand-700' : 'text-text'))}
                          >
                            <div className="flex flex-col items-end">
                              <span>{row.beyondThree ? '—' : fmtMoney(c.totalFlow)}</span>
                              {isCur && (
                                <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-brand-600 px-1 text-[10px] font-medium text-white">
                                  <Crown size={9} /> 当前
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5 text-right font-bold text-text">{row.beyondThree ? '—' : fmtMoney(row.threeTotal)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setDetailRoom(row.room)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-brand-600 hover:bg-brand-50"
                        >
                          {detailRoom === row.room ? '收起' : '查看'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-center text-[11px] text-text-muted">
            统计范围：线下主播（含在职与离职）· 数据来源：按日明细 latest.json · 当前周期列已高亮（背景 + 「当前」徽标）
          </p>

          {detailRoom && (
            <div className="mt-5 rounded-xl border border-border bg-bg/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-text">
                  <CalendarClock size={15} className="text-brand-600" />
                  周期流水明细 · {detail ? detail.nickname : detailRoom}
                </h3>
                <button
                  onClick={() => setDetailRoom('')}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-white"
                >
                  <X size={12} /> 收起
                </button>
              </div>

              {detailError && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-danger">
                  <AlertTriangle size={13} /> {detailError}
                </div>
              )}
              {detailLoading && (
                <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  正在加载明细…
                </div>
              )}
              {!detailLoading && detail && !detail.hasData && (
                <div className="flex flex-col items-center gap-2 py-10 text-text-muted">
                  <Inbox size={28} />
                  <p className="text-sm">该主播暂无可统计的流水数据（可能尚未开播或未纳入按日明细）。</p>
                </div>
              )}
              {!detailLoading && detail && detail.hasData && (
                <>

                  <div className="mb-4 rounded-xl border border-border bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div>
                        <div className="text-[11px] text-text-muted">主播</div>
                        <div className="text-sm font-semibold text-text">
                          {detail.nickname || '—'}{' '}
                          <span className="font-normal text-text-muted">（{detail.room}）</span>
                          {detail.status === 'inactive' && (
                            <span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                              离职{detail.leaveDate ? ' · ' + detail.leaveDate : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-text-muted">首次开播日</div>
                        <div className="text-sm font-semibold text-text">{detail.noFirstBroadcast ? '暂无开播记录' : (detail.firstBroadcast || '—')}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-text-muted">当前周期</div>
                        <div className="text-sm font-semibold text-brand-600">
                          {detail.beyondThree ? '新主播周期已结束' : (detail.currentCycle > 0 ? '第 ' + detail.currentCycle + ' 周期' : '未开播')}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-text-muted">距离下个周期</div>
                        <div className="flex items-center gap-1 text-sm font-semibold text-text">
                          <Clock size={14} className="text-text-secondary" />
                          {detail.daysRemaining != null ? detail.daysRemaining + ' 天' : '—'}
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-[11px] text-text-muted">三个周期累计流水</div>
                        <div className="text-base font-bold text-text">
                          {fmtMoney(detail.cycles.reduce((s, c) => s + c.totalFlow, 0))}
                        </div>
                      </div>
                    </div>
                    {detail.beyondThree && (
                      <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        该主播新主播周期已结束（当前第 {detail.currentCycle} 周期），下方为其前三个周期的历史流水供查询。
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {detail.cycles.map((c, idx) => {
                      const maxDaily = c.daily.reduce((m, d) => Math.max(m, d.flow), 0) || 1
                      return (
                        <div
                          key={c.cycle}
                          className={'flex flex-col rounded-xl border bg-white shadow-sm transition-all ' + (c.isCurrent ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border')}
                        >
                          <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={'flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ' + (c.isCurrent ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}>
                                {c.cycle}
                              </span>
                              <span className="text-sm font-bold text-text">{CYCLE_LABELS[idx]}</span>
                            </div>
                            {c.isCurrent && (
                              <span className="flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white">
                                <Crown size={11} /> 当前周期
                              </span>
                            )}
                          </div>
                          <div className="px-4 py-3">
                            <div className="text-[11px] text-text-muted">周期流水（{c.start} ~ {c.end}）</div>
                            <div className="mt-1 text-2xl font-bold text-trend-up">{fmtMoney(c.totalFlow)}</div>
                            <div className="mt-2 flex gap-4 text-[12px] text-text-secondary">
                              <span>统计天数 <b className="text-text">{c.days}</b></span>
                              <span>日均流水 <b className="text-text">{fmtMoney(c.dailyAvg)}</b></span>
                            </div>
                          </div>
                          <button
                            onClick={() => toggleExpand(c.cycle)}
                            className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] font-medium text-brand-600 hover:bg-brand-50"
                          >
                            <span>{expanded[c.cycle] ? '收起每日明细' : '查看每日明细'}</span>
                            <ChevronDown size={15} className={'transition-transform ' + (expanded[c.cycle] ? 'rotate-180' : '')} />
                          </button>
                          {expanded[c.cycle] && (
                            <div className="max-h-64 overflow-y-auto border-t border-border px-4 py-2">
                              {c.daily.length === 0 ? (
                                <p className="py-3 text-center text-[12px] text-text-muted">该周期无流水记录</p>
                              ) : (
                                <table className="w-full text-[12px]">
                                  <thead>
                                    <tr className="text-text-muted">
                                      <th className="py-1 text-left font-normal">日期</th>
                                      <th className="py-1 text-right font-normal">流水</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.daily.map((d) => (
                                      <tr key={d.date} className="border-t border-border/60">
                                        <td className="py-1 text-text-secondary">{d.date.slice(5)}</td>
                                        <td className="py-1 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg">
                                              <div
                                                className="h-full rounded-full bg-brand-400"
                                                style={{ width: (Math.max(4, (d.flow / maxDaily) * 100)) + '%' }}
                                              />
                                            </div>
                                            <span className="w-20 tabular-nums text-text">{fmtMoney(d.flow)}</span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <p className="mt-4 text-center text-[11px] text-text-muted">
                    统计基准日：{detail.refDate}（Asia/Shanghai）· 数据来源：按日明细 latest.json
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StreamerCycleFlowPage
