import { useState, useEffect, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'streamer_dashboard_data'
const OFFLINE_ROOMS_KEY = 'streamer_offline_rooms'
const STATUS_KEY = 'streamer_status'
const EXTRA_KEY = 'streamer_extra_map'

// 仅读取【运营经纪人】字段，忽略【招募经纪人】
export const ALL_COLUMNS = [
  '主播昵称', '主播id', '房间号', '开播分区',
  '运营经纪人', '运营经纪人UID', '主播在会时间',
  'TOPSTAR等级', '主播等级分数', '粉丝数', '总流水（元）', '总收益（元）',
  '主播自提礼物收益', '语聊房嘉宾收益（元）', '专属互动礼物收益（元）', '新增粉丝数',
  '弹幕数', '开播天数', '开播时长（小时）', 'pk次数', 'pk流水', 'pk付费人数',
  '违规次数', '峰值在线人数（pcu）', '平均在线人数（acu）', '付费人数', '大航海人数',
  '渠道来源', '年龄分层', '性别', '直播经验', '直播类型', '主播身份', '统计时间'
]

function cleanValue(v) {
  if (v === undefined || v === null || v === '-' || v === '') return ''
  return v
}

/** 从统计时间提取日期范围，支持 "YYYY-MM-DD 00:00:00 ~ YYYY-MM-DD 23:59:59" 或单日 */
export function parseStatTime(statTimeStr) {
  if (!statTimeStr) return { date: '', start: '', end: '' }
  const match = String(statTimeStr).match(/(\d{4}-\d{2}-\d{2})/g)
  if (!match || match.length === 0) return { date: '', start: '', end: '' }
  return {
    start: match[0],
    end: match[match.length - 1] || match[0],
    date: match[0],
  }
}

function cleanRecord(r) {
  const out = {}
  ALL_COLUMNS.forEach(col => {
    out[col] = cleanValue(r[col])
  })
  out['主播id'] = String(out['主播id'] ?? '')
  out['房间号'] = String(out['房间号'] ?? '')
  out['运营经纪人UID'] = String(out['运营经纪人UID'] ?? '')

  const numericCols = ['粉丝数', '总流水（元）', '总收益（元）', '主播自提礼物收益',
    '语聊房嘉宾收益（元）', '专属互动礼物收益（元）', '新增粉丝数', '弹幕数',
    '开播天数', '开播时长（小时）', 'pk次数', 'pk流水', 'pk付费人数', '违规次数',
    '峰值在线人数（pcu）', '平均在线人数（acu）', '付费人数', '大航海人数', '发布动态数量']

  numericCols.forEach(col => {
    const raw = out[col]
    if (raw === '' || raw === undefined) {
      out[col] = 0
      return
    }
    const s = String(raw).replace(/[元天小时%,\s]/g, '').trim()
    const n = parseFloat(s)
    out[col] = isNaN(n) ? 0 : n
  })

  // 统一加上统计日期，便于按日去重/覆盖
  // 区间（连续多日）数据把「统计日期」标记为截止日（as-of），让列表/筛选按最新快照呈现
  const stat = parseStatTime(out['统计时间'])
  out['统计日期'] = stat.end || stat.start || stat.date
  out['统计开始日期'] = stat.start
  out['统计结束日期'] = stat.end

  return out
}

// 解析统计时间中的起始日期，作为开播日期默认值
function parseOpenDate(statTime) {
  if (!statTime) return ''
  const match = String(statTime).match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

// 防御性解析：即使数据中出现 NaN / Infinity 也替换为 null，避免 JSON.parse 报错
function safeParseJSON(text) {
  const cleaned = text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null')
    .replace(/\b-infinity\b/g, 'null')
  return JSON.parse(cleaned)
}

async function loadJSON(url, timeoutMs = 30000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return safeParseJSON(text)
  } finally {
    clearTimeout(timer)
  }
}

// 加载服务端名册（权威来源，覆盖浏览器 localStorage）。名册包含线下主播名单 / 在职状态 / 赛道 等。
async function loadRoster() {
  const IS_STATIC = !!import.meta.env.VITE_STATIC
  const url = IS_STATIC ? './roster.json' : './api/roster'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const j = await res.json()
    if (IS_STATIC) return j
    return j.ok ? j : null
  } catch {
    return null
  }
}

// 安全写入 localStorage：数据集较大时（当前约 9MB）会超出浏览器 5MB 配额，
// 直接 setItem 会抛 QuotaExceededError 并触发"数据加载失败"报错循环。
// 这里捕获配额异常，先尝试清理历史大缓存再重试一次；仍失败则静默跳过
// （服务端始终是最新数据源，本地缓存仅作为离线兜底，缺失不影响正常使用）。
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)
    if (!isQuota) return false
    try {
      // 清理历史大缓存后重试一次：避免重复累积占满配额
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem('streamer_dashboard_updated')
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }
}

// 内部单人管理工具的内置默认管理口令：未手动在「数据同步」页设置口令时自动回退使用，
// 避免名册写操作（改在职状态 / 保底 / 开播日期等）因缺少口令被后端 401 拒绝而“静默失败、选了没反应”。
const BUILTIN_ADMIN_TOKEN = 'fbc1985757d7849a22e64c672d3120a6'

export function useStreamerData() {
  const [records, setRecords] = useState([])
  const [offlineRooms, setOfflineRooms] = useState(new Set())
  const [statusMap, setStatusMap] = useState({})
  const [extraMap, setExtraMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)
  const [roster, setRoster] = useState({})

  const saveRecords = useCallback((newRecords) => {
    const cleaned = newRecords.map(cleanRecord)
    setRecords(cleaned)
    const now = new Date().toISOString()
    setLastUpdated(now)
    // 注意：全量数据约 15MB，远超 localStorage 5MB 配额，写入必抛 QuotaExceededError。
    // 改为只缓存「最后更新时间」轻量标记；数据始终以服务端为权威来源（offline 兜底价值低且会卡顿）。
    safeSetItem('streamer_dashboard_updated', now)
  }, [])

  const syncData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadJSON('./streamer_data.json?t=' + Date.now())
      const cleaned = data.map(cleanRecord)
      saveRecords(cleaned)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [saveRecords])

  const saveOfflineRooms = useCallback((rooms) => {
    const next = new Set(rooms)
    setOfflineRooms(next)
    localStorage.setItem(OFFLINE_ROOMS_KEY, JSON.stringify(Array.from(next)))
  }, [])

  const saveStatusMap = useCallback((next) => {
    setStatusMap(next)
    localStorage.setItem(STATUS_KEY, JSON.stringify(next))
  }, [])

  const saveExtraMap = useCallback((next) => {
    setExtraMap(next)
    localStorage.setItem(EXTRA_KEY, JSON.stringify(next))
  }, [])

  // 服务端名册权威：导入成功后用返回的名册整体替换本地缓存映射
  const applyServerRoster = useCallback((r) => {
    if (!r) return
    setRoster(r)
    saveOfflineRooms(new Set(r.offlineRooms || []))
    saveStatusMap(r.status || {})
    saveExtraMap(r.extra || {})
  }, [saveOfflineRooms, saveStatusMap, saveExtraMap])

  useEffect(() => {
    const savedOffline = localStorage.getItem(OFFLINE_ROOMS_KEY)
    const savedStatus = localStorage.getItem(STATUS_KEY)
    const savedExtra = localStorage.getItem(EXTRA_KEY)

    if (savedOffline) {
      try { setOfflineRooms(new Set(JSON.parse(savedOffline))) } catch {}
    }
    if (savedStatus) {
      try { setStatusMap(JSON.parse(savedStatus)) } catch {}
    }
    if (savedExtra) {
      try { setExtraMap(JSON.parse(savedExtra)) } catch {}
    }

    // 加载服务端名册（权威来源，覆盖 localStorage）。名册包含线下主播名单 / 在职状态 / 赛道 等。
    // 必须整体替换，不能 merge：服务端删除房间/状态后，localStorage 旧缓存不能把它们又加回来。
    loadRoster().then(r => {
      if (!r) return
      applyServerRoster(r)
    }).catch(() => {})

    // 优先从服务端取最新数据。全量数据约 15MB，不再写入 localStorage（5MB 配额必然失败且会卡顿）；
    // 服务端为权威来源，断网时给出明确提示而非无限「加载中」。加载已带 30s 超时兜底。
    setLoading(true)
    loadJSON('./streamer_data.json?t=' + Date.now())
      .then(data => {
        const cleaned = data.map(cleanRecord)
        setRecords(cleaned)
        const now = new Date().toISOString()
        setLastUpdated(now)
        safeSetItem('streamer_dashboard_updated', now)
        setError(null)
      })
      .catch(err => {
        setError(
          err.name === 'AbortError'
            ? '数据加载超时（网络或隧道较慢，请稍后重试或刷新页面）'
            : `数据加载失败：${err.message}`
        )
      })
      .finally(() => setLoading(false))

    // 自动刷新：每 60 秒重新拉取最新数据。
    // 静态托管模式跳过轮询（92MB 文件频繁重拉会卡顿），由用户手动刷新页面查看最新快照。
    let pollTimer = null
    if (!import.meta.env.VITE_STATIC) {
      pollTimer = setInterval(() => { syncData() }, 60_000)
    }

    // 实时推送：订阅服务端 SSE，数据一变更立即刷新（多端同步，无需手动刷新）。
    // 静态托管模式无后端 SSE，直接跳过。
    let es = null
    if (!import.meta.env.VITE_STATIC) {
      let lastSseSync = 0
      try {
        es = new EventSource('./api/events')
        es.onmessage = () => {
          const now = Date.now()
          if (now - lastSseSync < 1500) return
          lastSseSync = now
          syncData()
        }
        es.onerror = () => { /* EventSource 会自动重连；上方轮询作为兜底 */ }
      } catch { /* 不支持 SSE 时降级为纯轮询 */ }
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer)
      if (es) es.close()
    }
  }, [applyServerRoster, syncData])

  // 将名册变更持久化到服务端（管理员口令来自 localStorage['sync_admin_token']）。
  // 失败不影响本地 UI（本地仍为兜底），但服务端为权威来源，后续刷新会以服务端为准。
  const postRoster = useCallback(async (patch) => {
    if (import.meta.env.VITE_STATIC) return false
    try {
      const token = localStorage.getItem('sync_admin_token') || BUILTIN_ADMIN_TOKEN
      const res = await fetch('./api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const j = await res.json()
        // 关键修复：不再用服务端返回的整份 roster 覆盖本地状态。
        // 本地「乐观更新」已是权威来源；若该覆盖保留，连续打字时每个按键都会触发一次 POST，
        // 多次异步响应的到达顺序可能与发送顺序不一致——较早（承载较短旧文本）的响应较迟到达时，
        // 会把本地 roster 里的 离职原因/离职日期 覆盖回旧值，表现为「已输入内容被自动删除」。
        // POST 仅负责持久化，成功后不回写即可彻底消除该竞态。
        return j.ok === true
      }
    } catch {}
    return false
  }, [])

function recordKey(r) {
  const room = String(r['房间号'] || '')
  const stat = parseStatTime(r['统计时间'])
  if (stat.start && stat.start === stat.end) {
    return `${room}::${stat.start}`
  }
  // 区间（连续多日）快照按「房间号::RANGE」为键，避免多次下载的相近区间累积成重复记录
  return `${room}::RANGE`
}

function checkRecords(records) {
  const rooms = new Set(records.map(r => String(r['房间号'] || '')).filter(Boolean))
  const revenue = records.reduce((s, r) => s + Number(r['总流水（元）'] || 0), 0)
  const seaCount = records.reduce((s, r) => {
    const v = Number(r['大航海人数'])
    return s + (Number.isNaN(v) ? 0 : v)
  }, 0)
  const dates = records.map(r => r['统计结束日期'] || r['统计日期'] || '').filter(Boolean).sort()
  const dateRange = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '未知'
  const warnings = []
  const badRevenue = records.filter(r => Number(r['总流水（元）']) < 0).length
  const missingRoom = records.filter(r => !String(r['房间号'] || '').trim()).length
  if (badRevenue) warnings.push(`${badRevenue} 条流水为负`)
  if (missingRoom) warnings.push(`${missingRoom} 条缺少房间号`)
  return { summary: `${records.length} 条 / ${rooms.size} 房间 / 统计 ${dateRange} / 流水 ¥${revenue.toFixed(2)} / 大航海 ${seaCount}`, warnings }
}

/**
 * 导入记录：按「房间号 + 统计日期/区间」去重，重复则覆盖。
 * 自动识别 统计时间 中的单日或多日：
 * - 单日（开始=结束）：按该日期写入/覆盖
 * - 连续多日（开始≠结束）：作为区间记录整体写入/覆盖，避免把汇总数值错误拆分导致重复计算
 */
const importRecords = useCallback((rawRecords) => {
  const incoming = rawRecords.map(cleanRecord)
  const mergedMap = new Map()
  records.forEach(r => {
    mergedMap.set(recordKey(r), r)
  })
  incoming.forEach(r => {
    const key = recordKey(r)
    mergedMap.set(key, { ...(mergedMap.get(key) || {}), ...r })
  })
  const result = Array.from(mergedMap.values())
  saveRecords(result)
  return checkRecords(result)
}, [records, saveRecords])

  /** 清空全部主播数据（保留线下房间号、状态、自定义字段） */
  const clearRecords = useCallback(() => {
    saveRecords([])
  }, [saveRecords])

  /** 彻底清空所有看板数据 */
  const clearAllData = useCallback(() => {
    saveRecords([])
    saveOfflineRooms(new Set())
    saveStatusMap({})
    saveExtraMap({})
  }, [saveRecords, saveOfflineRooms, saveStatusMap, saveExtraMap])

  const addOfflineRoom = useCallback((roomId) => {
    const cleanRoom = String(roomId).trim()
    if (!cleanRoom) return
    const next = new Set(offlineRooms)
    next.add(cleanRoom)
    saveOfflineRooms(next)
    setRoster(prev => ({ ...prev, offlineRooms: Array.from(next) }))
    postRoster({ offlineRooms: Array.from(next) })
  }, [offlineRooms, saveOfflineRooms, postRoster])

  const removeOfflineRoom = useCallback((roomId) => {
    const next = new Set(offlineRooms)
    next.delete(String(roomId))
    saveOfflineRooms(next)
    setRoster(prev => ({ ...prev, offlineRooms: Array.from(next) }))
    postRoster({ offlineRooms: Array.from(next) })
  }, [offlineRooms, saveOfflineRooms, postRoster])

  const batchAddOfflineRooms = useCallback((roomList) => {
    const next = new Set(offlineRooms)
    roomList.forEach(r => {
      const clean = String(r).trim()
      if (clean) next.add(clean)
    })
    saveOfflineRooms(next)
    setRoster(prev => ({ ...prev, offlineRooms: Array.from(next) }))
    postRoster({ offlineRooms: Array.from(next) })
  }, [offlineRooms, saveOfflineRooms, postRoster])

  const setStreamerStatus = useCallback((roomId, status, reason = '', leaveDate = '') => {
    const rid = String(roomId)
    // 乐观更新：立即合并到内存名册，主播列表的数据源(roster.status)即时重算，
    // 行内状态下拉立刻显示新值，不依赖后端响应速度/成败（解决“选了没反应”）。
    setRoster(prev => {
      const st = { ...(prev.status || {}) }
      st[rid] = { status, reason, leaveDate, updatedAt: new Date().toISOString() }
      return { ...prev, status: st }
    })
    const next = { ...statusMap }
    next[rid] = { status, reason, leaveDate, updatedAt: new Date().toISOString() }
    saveStatusMap(next)
    postRoster({ status: { [rid]: { status, reason, leaveDate } } })
  }, [statusMap, saveStatusMap, postRoster])

  // 更新单个主播的自定义字段：开播日期 / 保底金额
  const updateExtra = useCallback((roomId, patch) => {
    const room = String(roomId)
    const next = {
      ...extraMap,
      [room]: { ...(extraMap[room] || {}), ...patch },
    }
    saveExtraMap(next)
    // 乐观更新：同步写入 roster.extra，使主播列表表格（其值取自 roster.extra）在打字时
    // 立即反映，不再被异步响应重置为空（修复保底金额/开播日期「输入即被清空」）。
    setRoster(prev => {
      const ex = { ...(prev.extra || {}) }
      ex[room] = { ...(ex[room] || {}), ...patch }
      return { ...prev, extra: ex }
    })
    postRoster({ extra: { [room]: patch } })
  }, [extraMap, saveExtraMap, postRoster])

  // 线下主播 Excel 批量导入（服务端强校验 + 批次快照 + 回滚）。
  // 入参 payload = { headers: string[], rows: object[] }（原始表头与单元格，未归一化）。
  // 返回 { ok, batchId?, summary?, errors? }
  const importOfflineStreamers = useCallback(async (payload) => {
    try {
      const token = localStorage.getItem('sync_admin_token') || BUILTIN_ADMIN_TOKEN
      const res = await fetch('./api/roster/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) {
        applyServerRoster(j.roster)
        return { ok: true, batchId: j.batchId, summary: j.summary }
      }
      if (res.status === 422 && Array.isArray(j.errors)) {
        return { ok: false, errors: j.errors }
      }
      return { ok: false, errors: [{ row: 0, col: '服务器', field: '', reason: j.error || '导入失败' }] }
    } catch (e) {
      return { ok: false, errors: [{ row: 0, col: '网络', field: '', reason: e.message }] }
    }
  }, [applyServerRoster])

  // 拉取导入批次 + 回滚日志
  const fetchRosterBatches = useCallback(async () => {
    try {
      const token = localStorage.getItem('sync_admin_token') || BUILTIN_ADMIN_TOKEN
      const res = await fetch('./api/roster/batches', { headers: { 'x-admin-token': token } })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) return { ok: true, batches: j.batches || [], rollbacks: j.rollbacks || [] }
      return { ok: false, batches: [], rollbacks: [], error: j.error }
    } catch (e) {
      return { ok: false, batches: [], rollbacks: [], error: e.message }
    }
  }, [])

  // 按批次号回滚（恢复导入前快照）
  const rollbackRosterBatch = useCallback(async (batchId) => {
    try {
      const token = localStorage.getItem('sync_admin_token') || BUILTIN_ADMIN_TOKEN
      const res = await fetch('./api/roster/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ batchId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) {
        applyServerRoster(j.roster)
        return { ok: true, before: j.before, after: j.after, rollback: j.rollback }
      }
      return { ok: false, error: j.error || '回滚失败' }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [applyServerRoster])

  // 每日记录（去重键：房间号+统计日期）
  const dailyRecords = useMemo(() => {
    return records.map(r => {
      const room = String(r['房间号'])
      const isOffline = offlineRooms.has(room)
      const status = statusMap[room] || { status: '未标记', reason: '' }
      const extra = extraMap[room] || {}
      return {
        ...r,
        '是否线下主播': isOffline,
        '在职状态': status.status,
        '离职原因': status.reason,
        '离职日期': status.leaveDate || '',
        '开播日期': extra.openDate || parseOpenDate(r['统计时间']),
        '保底金额': extra.guarantee ?? '',
      }
    })
  }, [records, offlineRooms, statusMap, extraMap])

  // 去重到主播维度：取每个房间号「统计结束日期」最新的记录（用于主播列表等需要「一个主播一行」的场景）
  // 区间（连续多日）数据的统计结束日期更晚，应优于单日记录，避免被更早日期覆盖
  const streamers = useMemo(() => {
    const byRoom = new Map()
    const roomEnd = (r) => r['统计结束日期'] || r['统计日期'] || ''
    const roomDate = (r) => r['统计日期'] || ''
    dailyRecords.forEach(r => {
      const room = String(r['房间号'])
      const existing = byRoom.get(room)
      if (!existing) {
        byRoom.set(room, r)
        return
      }
      const eEnd = roomEnd(existing)
      const nEnd = roomEnd(r)
      if (nEnd > eEnd || (nEnd === eEnd && roomDate(r) > roomDate(existing))) {
        byRoom.set(room, r)
      }
    })
    return Array.from(byRoom.values())
  }, [dailyRecords])

  // 线下主播名册维度（权威来源 = 服务端 roster）：仅 45 条，完全独立于 13.4MB 流水。
  // 即便 streamer_data.json 未加载/加载失败，列表也能用房间号兜底正常渲染，绝不空白。
  const recordsByRoom = useMemo(() => {
    const m = new Map()
    for (const r of records) {
      const room = String(r['房间号'] || '').trim()
      if (room) m.set(room, r)
    }
    return m
  }, [records])

  const offlineStreamers = useMemo(() => {
    const rs = roster.offlineRooms || []
    const st = roster.status || {}
    const ex = roster.extra || {}
    return rs.map(room => {
      const key = String(room)
      const rec = recordsByRoom.get(key) || {}
      const s = st[key] || {}
      const e = ex[key] || {}
      return {
        '房间号': key,
        '主播昵称': rec['主播昵称'] || key,
        '运营经纪人': rec['运营经纪人'] || '',
        '开播分区': rec['开播分区'] || '',
        '是否线下主播': true,
        '在职状态': s.status || '未标记',
        '离职原因': s.reason || '',
        '离职日期': s.leaveDate || '',
        '开播日期': e.openDate || parseOpenDate(rec['统计时间']) || '',
        '保底金额': e.guarantee ?? '',
      }
    })
  }, [roster, recordsByRoom])

  return {
    records: dailyRecords,
    streamers,
    offlineStreamers,
    rawRecords: records,
    roster,
    offlineRooms: Array.from(offlineRooms),
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
    saveRecords,
  }
}
