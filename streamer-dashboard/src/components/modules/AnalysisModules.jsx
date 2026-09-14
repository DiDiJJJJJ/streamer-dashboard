import { useMemo, useState } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar as ReBar,
  XAxis, YAxis, CartesianGrid, LabelList,
} from 'recharts'
import { Building2, UserCog, Layers, Radio, Wallet, Award, ShieldAlert, GitCompareArrows, Crown, AlertTriangle } from 'lucide-react'
import {
  aggByRoom, periodRange, parseAgent, tierOf, num, pct, money, fmt,
} from '../../lib/metrics'

const PIE = ['#4F86F7', '#3DD9D6', '#22C58B', '#A78BFA', '#FBBF24', '#F472B6', '#FB923C', '#A3E635', '#F87171', '#C084FC']
const TIER_COLOR = { S: '#F472B6', A: '#A78BFA', B: '#22C58B', C: '#4F86F7', D: '#94a3b8' }
const PERIODS = ['本月', '上月', '近30天', '全部']

function Card({ title, icon: Icon, right, children, className = '' }) {
  return (
    <div className={`fx-card rounded-2xl border border-border bg-white p-4 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            {Icon && <Icon size={16} className="text-brand-600" />}
            {title}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

function Stat({ label, value, sub, accent = 'text-text' }) {
  return (
    <div className="fx-card rounded-xl border border-border bg-bg/40 p-3">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-text-muted">{sub}</div>}
    </div>
  )
}

function Bar({ label, value, max, color = '#4F86F7', sub }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-28 shrink-0 truncate text-xs text-text-secondary" title={label}>{label}</div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-bg">
        <div className="h-full rounded" style={{ width: `${w}%`, background: color }} />
      </div>
      <div className="w-20 shrink-0 text-right text-xs tabular-nums text-text">{sub ?? fmt(value)}</div>
    </div>
  )
}

function PeriodTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
      {PERIODS.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`fx-chip rounded-md px-3 py-1 text-xs transition-colors ${
            value === p ? 'bg-brand-600 font-medium text-white' : 'text-text-secondary hover:text-text'
          }`}
        >{p}</button>
      ))}
    </div>
  )
}

function Empty({ msg = '当前周期内暂无数据' }) {
  return <div className="py-10 text-center text-sm text-text-muted">{msg}</div>
}

function Th({ children, align = 'left', className = '' }) {
  return <th className={`fx-th px-2 py-1.5 text-${align} text-[11px] font-medium text-text-secondary ${className}`}>{children}</th>
}
function Td({ children, align = 'left' }) {
  return <td className={`px-2 py-1.5 text-${align} text-xs text-text tabular-nums`}>{children}</td>
}

/* ============================== 模块1 场地运营 ============================== */
export function VenueOps({ records, roster }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const agg = useMemo(() => aggByRoom(records, range), [records, range])
  const data = useMemo(() => {
    const totalRev = agg.reduce((s, r) => s + num(r['总流水（元）']), 0)
    const totalHours = agg.reduce((s, r) => s + num(r['开播时长（小时）']), 0)
    const rosterRooms = roster?.offlineRooms?.length || agg.length
    const byZone = {}
    agg.forEach(r => {
      const z = r['开播分区'] || '未知'
      byZone[z] = (byZone[z] || 0) + 1
    })
    const top = [...agg].sort((a, b) => num(b['总流水（元）']) - num(a['总流水（元）'])).slice(0, 12)
    return { totalRev, totalHours, rosterRooms, byZone, top, rooms: agg.length, occupy: agg.length / (rosterRooms || 1) }
  }, [agg, roster])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">场地运营</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="直播间总数" value={data.rosterRooms} sub={`名册 ${data.rosterRooms} 间`} />
        <Stat label="有产出房间" value={data.rooms} sub={`占用率 ${pct(data.rooms, data.rosterRooms)}`} accent="text-brand-600" />
        <Stat label="总流水" value={money(data.totalRev)} sub={`${data.rooms} 间合计`} />
        <Stat label="坪效（间均流水）" value={money(data.totalRev / (data.rooms || 1))} sub={`总开播 ${fmt(data.totalHours, 0)} 小时`} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="分区房间分布" icon={Building2}>
          {Object.entries(data.byZone).sort((a, b) => b[1] - a[1]).map(([z, c], i) => (
            <Bar key={z} label={z} value={c} max={Math.max(...Object.values(data.byZone))} color={PIE[i % PIE.length]} sub={`${c} 间`} />
          ))}
        </Card>
        <Card title="房间流水 TOP" icon={Building2}>
          {data.top.length ? data.top.map(r => (
            <Bar key={r['房间号']} label={`${r['主播昵称']}`} value={num(r['总流水（元）'])} max={num(data.top[0]['总流水（元）'])} color="#4F86F7" sub={money(r['总流水（元）'])} />
          )) : <Empty />}
        </Card>
      </div>
      <Card title="房间明细（按流水降序）" className="fx-enter">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>主播</Th><Th>房间号</Th><Th>分区</Th>
                <Th align="right">总流水</Th><Th align="right">开播时长(h)</Th>
                <Th align="right">弹幕数</Th><Th align="right">大航海</Th>
              </tr>
            </thead>
            <tbody>
              {data.top.map(r => (
                <tr key={r['房间号']} className="border-b border-border/60">
                  <Td>{r['主播昵称']}</Td><Td>{r['房间号']}</Td><Td>{r['开播分区']}</Td>
                  <Td align="right">{money(r['总流水（元）'])}</Td>
                  <Td align="right">{fmt(r['开播时长（小时）'])}</Td>
                  <Td align="right">{fmt(r['弹幕数'])}</Td>
                  <Td align="right">{r['大航海人数']}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-text-muted">说明：占用率 = 有产出房间 / 名册房间总数；坪效 = 总流水 / 有产出房间数。排班精确占用率待接入排班表后细化。</p>
    </div>
  )
}

/* ============================== 模块2 团队管理 ============================== */
export function TeamPerf({ records }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const data = useMemo(() => {
    const agg = aggByRoom(records, range)
    const map = new Map()
    agg.forEach(r => {
      const a = parseAgent(r['运营经纪人'])
      const cur = map.get(a) || { agent: a, rooms: 0, rev: 0, earn: 0, sea: 0, hours: 0, violate: 0, fans: 0 }
      cur.rooms += 1
      cur.rev += num(r['总流水（元）'])
      cur.earn += num(r['总收益（元）'])
      cur.sea += num(r['大航海人数'])
      cur.hours += num(r['开播时长（小时）'])
      cur.violate += num(r['违规次数'])
      cur.fans += num(r['新增粉丝数'])
      map.set(a, cur)
    })
    const list = Array.from(map.values()).map(x => ({ ...x, perRoom: x.rev / (x.rooms || 1) }))
      .sort((a, b) => b.perRoom - a.perRoom)
    const avg = list.length ? list.reduce((s, x) => s + x.perRoom, 0) / list.length : 0
    return { list, avg, totalRooms: agg.length }
  }, [records, range])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">团队管理 · 运营人效</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="运营人数" value={data.list.length} sub={`管理 ${data.totalRooms} 位主播`} />
        <Stat label="场均人均流水" value={money(data.avg)} sub="各运营人均均值" accent="text-brand-600" />
        <Stat label="最高人均运营" value={data.list[0]?.agent || '-'} sub={data.list[0] ? money(data.list[0].perRoom) : ''} />
        <Stat label="最低人均运营" value={data.list[data.list.length - 1]?.agent || '-'} sub={data.list.length ? money(data.list[data.list.length - 1].perRoom) : ''} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="运营总流水对比" icon={UserCog}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={data.list.slice(0, 10)} layout="vertical" margin={{ left: 40, right: 16 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="agent" width={60} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => money(v)} />
                <ReBar dataKey="rev" fill="#4F86F7"><LabelList dataKey="rev" position="right" formatter={v => money(v)} fontSize={10} /></ReBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="运营人效排行（人均流水）" icon={UserCog}>
          {data.list.length ? data.list.map(x => (
            <Bar key={x.agent} label={x.agent} value={x.perRoom} max={data.list[0].perRoom} color="#22C58B" sub={money(x.perRoom)} />
          )) : <Empty />}
        </Card>
      </div>
      <Card title="运营明细" className="fx-enter">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>运营</Th><Th align="right">主播数</Th><Th align="right">总流水</Th>
                <Th align="right">人均流水</Th><Th align="right">总收益</Th>
                <Th align="right">大航海</Th><Th align="right">开播时长</Th><Th align="right">违规</Th>
              </tr>
            </thead>
            <tbody>
              {data.list.map(x => (
                <tr key={x.agent} className="border-b border-border/60">
                  <Td>{x.agent}</Td><Td align="right">{x.rooms}</Td>
                  <Td align="right">{money(x.rev)}</Td><Td align="right" className="font-medium text-brand-600">{money(x.perRoom)}</Td>
                  <Td align="right">{money(x.earn)}</Td><Td align="right">{x.sea}</Td>
                  <Td align="right">{fmt(x.hours)}</Td><Td align="right">{x.violate}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ============================== 模块3 主播分层 ============================== */
export function StreamerTier({ records, roster }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const data = useMemo(() => {
    const agg = aggByRoom(records, range)
    const tier = { S: 0, A: 0, B: 0, C: 0, D: 0 }
    const star = {}
    const tenure = {}
    agg.forEach(r => {
      tier[tierOf(r['总流水（元）'])] += 1
      const st = r['TOPSTAR等级'] || '未评级'
      star[st] = (star[st] || 0) + 1
      const tn = r['主播在会时间'] || '未知'
      tenure[tn] = (tenure[tn] || 0) + 1
    })
    const statusVals = Object.values(roster?.status || {}).map(s => s?.status)
    const onJob = statusVals.filter(s => s === '在职').length
    const left = statusVals.filter(s => s === '离职').length
    const top = [...agg].sort((a, b) => num(b['总流水（元）']) - num(a['总流水（元）'])).slice(0, 15)
    return { tier, star, tenure, onJob, left, top }
  }, [records, roster, range])

  const tierData = Object.entries(data.tier).map(([k, v]) => ({ name: k, value: v })).filter(d => d.value)

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">主播分层与生命周期</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="S 级主播" value={data.tier.S} sub="流水≥2万" accent="text-pink-600" />
        <Stat label="A 级主播" value={data.tier.A} sub="流水≥8千" accent="text-purple-600" />
        <Stat label="在职 / 离职" value={`${data.onJob} / ${data.left}`} sub="来自名册状态" />
        <Stat label="B+C 级" value={data.tier.B + data.tier.C} sub="流水 1~8千" />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="流水分层分布" icon={Layers}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={tierData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label>
                  {tierData.map((d, i) => <Cell key={d.name} fill={TIER_COLOR[d.name] || PIE[i % PIE.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="在会时间分布" icon={Layers}>
          {Object.entries(data.tenure).sort((a, b) => b[1] - a[1]).map(([k, v], i) => (
            <Bar key={k} label={k} value={v} max={Math.max(...Object.values(data.tenure))} color={PIE[i % PIE.length]} sub={`${v} 人`} />
          ))}
        </Card>
        <Card title="TOPSTAR 评级" icon={Layers}>
          {Object.entries(data.star).sort((a, b) => b[1] - a[1]).map(([k, v], i) => (
            <Bar key={k} label={k} value={v} max={Math.max(...Object.values(data.star))} color={PIE[i % PIE.length]} sub={`${v} 人`} />
          ))}
        </Card>
      </div>
      <Card title="头部主播明细（按流水）" className="fx-enter">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>主播</Th><Th>运营</Th><Th>分层</Th><Th align="right">总流水</Th>
                <Th align="right">粉丝数</Th><Th align="right">新增粉丝</Th><Th align="right">大航海</Th>
              </tr>
            </thead>
            <tbody>
              {data.top.map(r => (
                <tr key={r['房间号']} className="border-b border-border/60">
                  <Td>{r['主播昵称']}</Td><Td>{parseAgent(r['运营经纪人'])}</Td>
                  <Td><span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: TIER_COLOR[tierOf(r['总流水（元）'])] }}>{tierOf(r['总流水（元）'])}</span></Td>
                  <Td align="right">{money(r['总流水（元）'])}</Td>
                  <Td align="right">{fmt(r['粉丝数'])}</Td>
                  <Td align="right">{fmt(r['新增粉丝数'])}</Td>
                  <Td align="right">{r['大航海人数']}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ============================== 模块4 内容数据 ============================== */
export function ContentData({ records }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const data = useMemo(() => {
    const agg = aggByRoom(records, range)
    const sum = k => agg.reduce((s, r) => s + num(r[k]), 0)
    const pcu = agg.reduce((m, r) => Math.max(m, num(r['峰值在线人数（pcu）'])), 0)
    const acu = agg.reduce((s, r) => s + num(r['平均在线人数（acu）']), 0)
    const damuku = sum('弹幕数'); const hours = sum('开播时长（小时）')
    const fans = sum('新增粉丝数'); const sea = sum('大航海人数'); const pay = sum('付费人数')
    const byZone = {}
    agg.forEach(r => {
      const z = r['开播分区'] || '未知'
      const o = byZone[z] || { zone: z, rooms: 0, rev: 0, damuku: 0, hours: 0, fans: 0 }
      o.rooms += 1; o.rev += num(r['总流水（元）']); o.damuku += num(r['弹幕数'])
      o.hours += num(r['开播时长（小时）']); o.fans += num(r['新增粉丝数'])
      byZone[z] = o
    })
    const zoneList = Object.values(byZone).map(o => ({ ...o, perHour: o.hours ? o.damuku / o.hours : 0 }))
      .sort((a, b) => b.damuku - a.damuku)
    const top = [...agg].sort((a, b) => num(b['弹幕数']) - num(a['弹幕数'])).slice(0, 10)
    return { damuku, hours, pcu, acu, fans, sea, pay, zoneList, top, violate: sum('违规次数'),
      damukuDensity: hours ? damuku / hours : 0, seaRate: pay ? sea / pay : 0 }
  }, [records, range])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">内容数据 · 直播质量与互动</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="总开播时长" value={`${fmt(data.hours)} h`} sub={`峰值在线 ${fmt(data.pcu)}`} />
        <Stat label="平均在线(ACU)" value={fmt(data.acu)} sub={`弹幕总数 ${fmt(data.damuku)}`} />
        <Stat label="弹幕密度" value={`${fmt(data.damukuDensity, 0)}/h`} sub="弹幕/开播时长" accent="text-brand-600" />
        <Stat label="新增粉丝 / 大航海" value={`${fmt(data.fans)} / ${data.sea}`} sub={`大航海占比 ${pct(data.sea * 100, data.pay * 100).replace('%', '')}%`} />
        <Stat label="违规次数" value={data.violate} sub="全场地合计" accent={data.violate ? 'text-red-600' : 'text-text'} />
        <Stat label="付费人数" value={fmt(data.pay)} sub={`大航海 ${data.sea} 人`} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="分区互动对比（弹幕）" icon={Radio}>
          {data.zoneList.length ? data.zoneList.map(z => (
            <Bar key={z.zone} label={z.zone} value={z.damuku} max={data.zoneList[0].damuku} color="#3DD9D6" sub={fmt(z.damuku)} />
          )) : <Empty />}
        </Card>
        <Card title="弹幕数 TOP 主播" icon={Radio}>
          {data.top.length ? data.top.map(r => (
            <Bar key={r['房间号']} label={r['主播昵称']} value={num(r['弹幕数'])} max={num(data.top[0]['弹幕数'])} color="#A78BFA" sub={fmt(r['弹幕数'])} />
          )) : <Empty />}
        </Card>
      </div>
      <Card title="分区内容质量明细" className="fx-enter">
        <div className="max-h-80 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>分区</Th><Th align="right">房间数</Th><Th align="right">总流水</Th>
                <Th align="right">弹幕数</Th><Th align="right">开播时长</Th><Th align="right">人均弹幕/h</Th><Th align="right">新增粉丝</Th>
              </tr>
            </thead>
            <tbody>
              {data.zoneList.map(z => (
                <tr key={z.zone} className="border-b border-border/60">
                  <Td>{z.zone}</Td><Td align="right">{z.rooms}</Td><Td align="right">{money(z.rev)}</Td>
                  <Td align="right">{fmt(z.damuku)}</Td><Td align="right">{fmt(z.hours)}</Td>
                  <Td align="right">{fmt(z.perHour, 0)}</Td><Td align="right">{fmt(z.fans)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-text-muted">说明：弹幕、开播时长、人气、新增粉丝、违规等均为 B站 直播数据原始字段，已接入现有抓取。掉粉率待接入粉丝净增减字段后补充。</p>
    </div>
  )
}

/* ============================== 模块5 经营分析 ============================== */
export function BizAnalysis({ records, roster }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const data = useMemo(() => {
    const agg = aggByRoom(records, range)
    const rev = agg.reduce((s, r) => s + num(r['总流水（元）']), 0)
    const earn = agg.reduce((s, r) => s + num(r['总收益（元）']), 0)
    const self = agg.reduce((s, r) => s + num(r['主播自提礼物收益']), 0)
    const guest = agg.reduce((s, r) => s + num(r['语聊房嘉宾收益（元）']), 0)
    const exclusive = agg.reduce((s, r) => s + num(r['专属互动礼物收益（元）']), 0)
    const cost = Object.values(roster?.extra || {}).reduce((s, e) => s + num(e?.guarantee), 0)
    const net = earn - cost
    const list = agg.map(r => {
      const rv = num(r['总流水（元）']); const er = num(r['总收益（元）'])
      const g = 0
      return { ...r, margin: rv ? er / rv : 0, net: er - g }
    }).sort((a, b) => b.net - a.net).slice(0, 15)
    const pieData = [
      { name: '自提礼物', value: self }, { name: '语聊嘉宾', value: guest }, { name: '专属互动', value: exclusive },
    ].filter(d => d.value)
    return { rev, earn, split: rev - earn, cost, net, list, pieData, margin: rev ? earn / rev : 0 }
  }, [records, roster, range])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">经营分析 · 成本与利润</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="总流水" value={money(data.rev)} sub="平台侧流水" />
        <Stat label="净收益（分成后）" value={money(data.earn)} sub={`毛利率 ${pct(data.margin * 100, 100)}`} accent="text-brand-600" />
        <Stat label="平台分成" value={money(data.split)} sub="流水 - 净收益" />
        <Stat label="保底/人力成本" value={money(data.cost)} sub={`净贡献 ${money(data.net)}`} accent={data.net < 0 ? 'text-red-600' : 'text-text'} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="收益构成" icon={Wallet}>
          {data.pieData.length ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.pieData} dataKey="value" nameKey="name" outerRadius={80} label>
                    {data.pieData.map((d, i) => <Cell key={d.name} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => money(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </Card>
        <Card title=" profitability 解读" icon={Wallet}>
          <p className="text-xs leading-6 text-text-secondary">
            毛利率 = 净收益 ÷ 总流水，反映平台分成后的实际留存。<br />
            净贡献 = 净收益 − 名册主播保底（extra.guarantee 合计），为正代表场地在该周期整体盈利。<br />
            下方明细按「净贡献」降序列出头部主播，负值（红）代表该主播收益未覆盖保底，需关注。
          </p>
        </Card>
      </div>
      <Card title="主播净贡献明细（净收益降序）" className="fx-enter">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>主播</Th><Th>运营</Th><Th align="right">总流水</Th><Th align="right">净收益</Th>
                <Th align="right">毛利率</Th><Th align="right">净贡献</Th>
              </tr>
            </thead>
            <tbody>
              {data.list.map(r => (
                <tr key={r['房间号']} className="border-b border-border/60">
                  <Td>{r['主播昵称']}</Td><Td>{parseAgent(r['运营经纪人'])}</Td>
                  <Td align="right">{money(r['总流水（元）'])}</Td>
                  <Td align="right">{money(r['总收益（元）'])}</Td>
                  <Td align="right">{pct(r.margin * 100, 100)}</Td>
                  <Td align="right" className={r.net < 0 ? 'text-red-600 font-medium' : ''}>{money(r.net)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-text-muted">说明：毛利率为平台分成口径的代理指标；保底成本来自名册 extra.guarantee，单主播盈亏为「净收益 − 保底」近似。房租/设备折旧待接入后细化。</p>
    </div>
  )
}

/* ============================== 模块6 排行榜 ============================== */
function NewbieCard({ title, list }) {
  const max = list.length ? Math.max(...list.map(r => num(r['总流水（元）'])), 1) : 1
  return (
    <Card
      title={title}
      icon={Award}
      right={<span className="text-xs font-medium text-text-muted">{list.length} 位</span>}
      className="fx-enter"
    >
      {list.length ? (
        <div className="divide-y divide-border/60">
          {list.map((r, i) => {
            const rev = num(r['总流水（元）'])
            const ratio = max > 0 ? Math.max(3, (rev / max) * 100) : 0
            return (
              <div key={r['房间号']} className="flex items-center gap-2.5 py-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i < 3 ? 'bg-brand-600 text-white shadow-[0_3px_10px_-3px_rgba(37,99,235,0.75)]' : 'bg-slate-100 text-slate-500'
                }`}>
                  {i < 3 ? <Crown size={13} /> : i + 1}
                </span>
                <div className="w-24 shrink-0 truncate sm:w-28">
                  <div className="truncate text-sm font-semibold text-slate-800">{r['主播昵称']}</div>
                  <div className="truncate text-[11px] text-text-muted">{parseAgent(r['运营经纪人'])}</div>
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-[width] duration-500 ease-out"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-extrabold leading-none tabular-nums text-brand-600">{money(rev)}</div>
                  <div className="mt-0.5 text-[10px] font-medium text-text-muted">总流水</div>
                </div>
              </div>
            )
          })}
        </div>
      ) : <Empty msg="该在会时间段暂无主播数据" />}
    </Card>
  )
}

export function Ranking({ records }) {
  const [period, setPeriod] = useState('本月')
  const [tab, setTab] = useState('流水')
  const range = useMemo(() => periodRange(period), [period])
  const list = useMemo(() => {
    const agg = aggByRoom(records, range)
    const keyMap = { 流水: '总流水（元）', 涨粉: '新增粉丝数', 大航海: '大航海人数', 新秀: '新增粉丝数' }
    const key = keyMap[tab]
    return [...agg].sort((a, b) => num(b[key]) - num(a[key])).slice(0, 20)
  }, [records, range, tab])
  // 新秀榜：按「主播在会时间」分组 0-1个月 / 1-3个月，组内按总流水金额降序排
  const newcomers = useMemo(() => {
    const all = aggByRoom(records, range)
    const byTenure = k => all.filter(r => (r['主播在会时间'] || '') === k)
      .sort((a, b) => num(b['总流水（元）']) - num(a['总流水（元）'])).slice(0, 20)
    return { g1: byTenure('0-1个月'), g2: byTenure('1-3个月') }
  }, [records, range])
  const max = list.length ? num(list[0][tab === '流水' ? '总流水（元）' : tab === '大航海' ? '大航海人数' : '新增粉丝数']) : 1

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-text">排行榜</h2>
        <div className="flex items-center gap-2">
          <PeriodTabs value={period} onChange={setPeriod} />
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
            {['流水', '涨粉', '大航海', '新秀'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`fx-chip rounded-md px-2.5 py-1 text-xs ${tab === t ? 'bg-brand-600 font-medium text-white' : 'text-text-secondary'}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {tab === '新秀' ? (
        <>
          <p className="text-[11px] text-text-muted">新入驻主播榜：筛选「主播在会时间」处于 0-1 个月、1-3 个月区间的主播，按总流水金额从高到低降序排名（每组 TOP 20）。仅保留排名与流水两项核心指标，流水以品牌色加大加粗突出，信息更聚焦。</p>
          <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
            <NewbieCard title="新秀榜 · 在会 0-1 个月" list={newcomers.g1} />
            <NewbieCard title="新秀榜 · 在会 1-3 个月" list={newcomers.g2} />
          </div>
        </>
      ) : (
        <Card icon={Award} className="fx-enter">
          {list.length ? list.map((r, i) => {
            const v = num(tab === '流水' ? r['总流水（元）'] : tab === '大航海' ? r['大航海人数'] : r['新增粉丝数'])
            return (
              <div key={r['房间号']} className="flex items-center gap-3 py-1.5">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-brand-600 text-white' : 'bg-bg text-text-secondary'}`}>
                  {i < 3 ? <Crown size={13} /> : i + 1}
                </div>
                <div className="w-24 shrink-0 truncate text-sm text-text sm:w-32">{r['主播昵称']}</div>
                <div className="w-20 shrink-0 truncate text-xs text-text-secondary sm:w-24">{parseAgent(r['运营经纪人'])}</div>
                <div className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-bg">
                  <div className="h-full rounded bg-brand-500" style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
                </div>
                <div className="w-20 shrink-0 text-right text-sm tabular-nums text-text sm:w-24">{tab === '流水' ? money(v) : fmt(v)}</div>
              </div>
            )
          }) : <Empty />}
        </Card>
      )}
    </div>
  )
}

/* ============================== 模块7 风控中心 ============================== */
export function RiskControl({ records }) {
  const range = useMemo(() => periodRange('本月'), [])
  const prev = useMemo(() => periodRange('上月'), [])
  const data = useMemo(() => {
    const cur = aggByRoom(records, range)
    const last = aggByRoom(records, prev)
    const lastMap = new Map(last.map(r => [String(r['房间号']), num(r['总流水（元）'])]))
    const violate = cur.filter(r => num(r['违规次数']) > 0)
      .sort((a, b) => num(b['违规次数']) - num(a['违规次数']))
    const drop = cur.map(r => {
      const curV = num(r['总流水（元）']); const lastV = lastMap.get(String(r['房间号'])) || 0
      const change = lastV ? (curV - lastV) / lastV : 0
      return { ...r, change }
    }).filter(r => r.change <= -0.3 && num(r['总流水（元）']) > 0)
      .sort((a, b) => a.change - b.change)
    const high = new Set([...violate.map(r => r['房间号']), ...drop.map(r => r['房间号'])])
    return { violate, drop, high: high.size }
  }, [records, range, prev])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">风控中心 · 异常监控</h2>
        <span className="text-xs text-text-muted">本月周期</span>
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="违规主播数" value={data.violate.length} sub="违规次数>0" accent={data.violate.length ? 'text-red-600' : 'text-text'} />
        <Stat label="流水下滑房间" value={data.drop.length} sub="环比下滑≥30%" accent={data.drop.length ? 'text-amber-600' : 'text-text'} />
        <Stat label="高风险房间" value={data.high} sub="违规或下滑" accent={data.high ? 'text-red-600' : 'text-text'} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="违规记录" icon={ShieldAlert}>
          {data.violate.length ? (
            <table className="w-full">
              <thead><tr className="border-b border-border">
                <Th>主播</Th><Th>运营</Th><Th align="right">违规次数</Th><Th align="right">总流水</Th>
              </tr></thead>
              <tbody>{data.violate.map(r => (
                <tr key={r['房间号']} className="border-b border-border/60">
                  <Td>{r['主播昵称']}</Td><Td>{parseAgent(r['运营经纪人'])}</Td>
                  <Td align="right" className="text-red-600 font-medium">{r['违规次数']}</Td>
                  <Td align="right">{money(r['总流水（元）'])}</Td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="flex items-center gap-2 py-6 text-sm text-text-muted"><AlertTriangle size={14} /> 本月暂无违规记录</div>}
        </Card>
        <Card title="流水骤降预警（环比≤-30%）" icon={ShieldAlert}>
          {data.drop.length ? (
            <table className="w-full">
              <thead><tr className="border-b border-border">
                <Th>主播</Th><Th>运营</Th><Th align="right">本月流水</Th><Th align="right">环比</Th>
              </tr></thead>
              <tbody>{data.drop.map(r => (
                <tr key={r['房间号']} className="border-b border-border/60">
                  <Td>{r['主播昵称']}</Td><Td>{parseAgent(r['运营经纪人'])}</Td>
                  <Td align="right">{money(r['总流水（元）'])}</Td>
                  <Td align="right" className="text-amber-600 font-medium">{(r.change * 100).toFixed(0)}%</Td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="flex items-center gap-2 py-6 text-sm text-text-muted"><AlertTriangle size={14} /> 无显著流水下滑</div>}
        </Card>
      </div>
    </div>
  )
}

/* ============================== 模块8 对标基准 ============================== */
export function Benchmark({ records }) {
  const [period, setPeriod] = useState('本月')
  const range = useMemo(() => periodRange(period), [period])
  const data = useMemo(() => {
    const cur = aggByRoom(records, range)
    // 同环比（与上月对比）
    const last = aggByRoom(records, periodRange('上月'))
    const curRev = cur.reduce((s, r) => s + num(r['总流水（元）']), 0)
    const lastRev = last.reduce((s, r) => s + num(r['总流水（元）']), 0)
    const curEarn = cur.reduce((s, r) => s + num(r['总收益（元）']), 0)
    const lastEarn = last.reduce((s, r) => s + num(r['总收益（元）']), 0)
    const mom = lastRev ? (curRev - lastRev) / lastRev : 0
    // 运营人均对标
    const map = new Map()
    cur.forEach(r => {
      const a = parseAgent(r['运营经纪人'])
      const c = map.get(a) || { agent: a, rooms: 0, rev: 0 }
      c.rooms += 1; c.rev += num(r['总流水（元）']); map.set(a, c)
    })
    const agents = Array.from(map.values()).map(x => ({ ...x, perRoom: x.rev / (x.rooms || 1) }))
    const avg = agents.length ? agents.reduce((s, x) => s + x.perRoom, 0) / agents.length : 0
    // 分区中位数
    const zoneMap = new Map()
    cur.forEach(r => {
      const z = r['开播分区'] || '未知'
      const c = zoneMap.get(z) || { zone: z, arr: [] }
      c.arr.push(num(r['总流水（元）'])); zoneMap.set(z, c)
    })
    const zones = Array.from(zoneMap.values()).map(o => {
      const s = [...o.arr].sort((a, b) => a - b); const mid = s.length ? s[Math.floor(s.length / 2)] : 0
      return { zone: o.zone, rooms: s.length, avg: s.reduce((a, b) => a + b, 0) / (s.length || 1), median: mid }
    }).sort((a, b) => b.avg - a.avg)
    return { curRev, curEarn, mom, agents, avg, zones }
  }, [records, range])

  const chartData = data.agents.map(a => ({ name: a.agent, 人均流水: Math.round(a.perRoom), 均值: Math.round(data.avg) }))

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">对标与基准分析</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="fx-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="本期总流水" value={money(data.curRev)} sub={`净收益 ${money(data.curEarn)}`} />
        <Stat label="环比上月" value={`${(data.mom * 100).toFixed(1)}%`} sub="总流水 MoM" accent={data.mom >= 0 ? 'text-brand-600' : 'text-red-600'} />
        <Stat label="运营均值（人均流水）" value={money(data.avg)} sub="对标基准线" />
        <Stat label="达标运营数" value={data.agents.filter(a => a.perRoom >= data.avg).length} sub={`共 ${data.agents.length} 位运营`} />
      </div>
      <div className="fx-stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="运营人效 vs 均值基准" icon={GitCompareArrows}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ left: 16, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => money(v)} />
                <ReBar dataKey="人均流水" fill="#4F86F7" />
                <ReBar dataKey="均值" fill="#FBBF24" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="分区基准（人均/中位数）" icon={GitCompareArrows}>
          {data.zones.length ? data.zones.map(z => (
            <Bar key={z.zone} label={z.zone} value={z.avg} max={Math.max(...data.zones.map(x => x.avg))} color="#22C58B" sub={money(z.avg)} />
          )) : <Empty />}
        </Card>
      </div>
      <Card title="运营对标明细" className="fx-enter">
        <div className="max-h-80 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-border">
                <Th>运营</Th><Th align="right">主播数</Th><Th align="right">总流水</Th>
                <Th align="right">人均流水</Th><Th align="right">vs 均值</Th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => {
                const diff = a.perRoom - data.avg
                return (
                  <tr key={a.agent} className="border-b border-border/60">
                    <Td>{a.agent}</Td><Td align="right">{a.rooms}</Td><Td align="right">{money(a.rev)}</Td>
                    <Td align="right">{money(a.perRoom)}</Td>
                    <Td align="right" className={diff >= 0 ? 'text-brand-600' : 'text-red-600'}>
                      {diff >= 0 ? '+' : ''}{money(diff)}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
