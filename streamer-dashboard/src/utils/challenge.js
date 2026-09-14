import { parseISO, startOfWeek, endOfWeek, format, isWithinInterval, eachDayOfInterval, addDays } from 'date-fns'

const THRESHOLD = 2000

export function parseStatTimeRange(statTimeStr) {
  if (!statTimeStr || typeof statTimeStr !== 'string') return null
  const match = statTimeStr.match(/(\d{4}-\d{2}-\d{2})/g)
  if (!match || match.length < 2) return null
  return {
    start: parseISO(`${match[0]}T00:00:00`),
    end: parseISO(`${match[1]}T23:59:59`),
  }
}

export function generateDailyRevenue(record) {
  const range = parseStatTimeRange(record['统计时间'])
  const total = Number(record['总流水（元）'] || 0)
  if (!range) {
    return [{ date: new Date(), revenue: total }]
  }
  const days = eachDayOfInterval({ start: range.start, end: range.end })
  if (days.length === 0) return [{ date: new Date(), revenue: total }]
  const base = total / days.length
  return days.map((date, idx) => ({
    date,
    revenue: idx === days.length - 1
      ? Number((total - base * (days.length - 1)).toFixed(2))
      : Number(base.toFixed(2)),
  }))
}

export function getNaturalWeeks(dateRange) {
  const weeks = []
  let cursor = startOfWeek(dateRange.start, { weekStartsOn: 1 })
  const end = endOfWeek(dateRange.end, { weekStartsOn: 1 })
  while (cursor <= end) {
    weeks.push({
      weekStart: cursor,
      weekEnd: endOfWeek(cursor, { weekStartsOn: 1 }),
      label: format(cursor, 'yyyy-MM-dd'),
    })
    cursor = addDays(cursor, 7)
  }
  return weeks
}

export function computeChallenge(records, { startDate, endDate, tracks = {}, overrideWeek = null, today = new Date() } = {}) {
  // 仅统计线下主播；赛制活动期间，离职主播自动从名单中剔除
  const filtered = records.filter(r => r['是否线下主播'] === true && r['在职状态'] !== '离职')

  const globalStart = startDate ? parseISO(`${startDate}T00:00:00`) : null
  const globalEnd = endDate ? parseISO(`${endDate}T23:59:59`) : null

  const allDays = filtered.flatMap(r => {
    const days = generateDailyRevenue(r)
    return days.map(d => ({
      ...r,
      date: d.date,
      revenue: d.revenue,
    }))
  })

  const timestamps = allDays.map(d => d.date.getTime())
  const minTime = timestamps.length ? Math.min(...timestamps) : Date.now()
  const maxTime = timestamps.length ? Math.max(...timestamps) : Date.now()

  const rangeStart = globalStart || startOfWeek(new Date(minTime), { weekStartsOn: 1 })
  const rangeEnd = globalEnd || endOfWeek(new Date(maxTime), { weekStartsOn: 1 })

  if (rangeStart > rangeEnd) return []

  const weeks = getNaturalWeeks({ start: rangeStart, end: rangeEnd })
  const weekStats = []

    weeks.forEach((week, idx) => {
    const prevWeek = idx > 0 ? weekStats[idx - 1] : null
    // 是否命中「手动指定赛道」的周（如附件中的 2026-08-03 ~ 2026-08-09 本周名单）
    const isOverrideWeek = !!(overrideWeek && week.label === overrideWeek.start)

    const dayRecords = allDays.filter(d =>
      isWithinInterval(d.date, { start: week.weekStart, end: week.weekEnd })
    )

    const byStreamer = {}
    dayRecords.forEach(d => {
      const key = d['主播id'] || d['房间号']
      if (!byStreamer[key]) {
        byStreamer[key] = {
          主播id: d['主播id'],
          主播昵称: d['主播昵称'],
          房间号: d['房间号'],
          开播分区: d['开播分区'],
          运营经纪人: d['运营经纪人'],
          总流水: 0,
        }
      }
      byStreamer[key].总流水 += d.revenue
    })

    let list = Object.values(byStreamer).map(s => ({
      ...s,
      总流水: Number(s.总流水.toFixed(2)),
    })).sort((a, b) => b.总流水 - a.总流水)

    // 赛道判定：
    // 1) 手动指定周（如附件 8/3~8/9）：以附件赛道为准；
    // 2) 其余周依据上周状态推演（状态机）：
    //    - 上周晋级赛且达标(≥2000) → 本周排位赛；
    //    - 上周排位赛且达标 → 本周留排位赛；上周排位赛未达标 → 本周降回晋级赛冷却，下周达标则下下周重回排位赛。
    const stageMap = {}
    list.forEach(s => {
      const manualStage = isOverrideWeek ? (tracks[s.房间号] || null) : null
      if (manualStage) { stageMap[s.主播id] = manualStage; return }
      const prev = prevWeek?.list?.find(x => x.主播id === s.主播id)
      if (!prev) stageMap[s.主播id] = '晋级赛'
      else if (prev.stage === '排位赛') stageMap[s.主播id] = prev.是否达标 ? '排位赛' : '晋级赛'
      else stageMap[s.主播id] = prev.是否达标 ? '排位赛' : '晋级赛'
    })

    // 排位赛内部排名（仅排位赛之间比较）：用于 TOP1/2/3 与「排位落榜」判定
    const rankInRankMap = {}
    list.filter(s => stageMap[s.主播id] === '排位赛')
      .sort((a, b) => b.总流水 - a.总流水)
      .forEach((s, i) => { rankInRankMap[s.主播id] = i })

    // 本周（进行中）与往周（已定格）采用不同状态文案
    const isCurrent = isWithinInterval(today, { start: week.weekStart, end: week.weekEnd })

    list = list.map((s, rankIdx) => {
      const passed = s.总流水 >= THRESHOLD
      const stage = stageMap[s.主播id]
      const rankInRank = rankInRankMap[s.主播id]
      let status = ''
      let rewardEligible = false

      if (stage === '晋级赛') {
        status = passed ? '已晋级' : '冲刺中~'
      } else {
        // 排位赛赛道
        if (isCurrent) {
          status = passed ? '已晋级 排位赛冲榜中~' : '冲刺中~'
        } else if (rankInRank !== undefined && rankInRank < 3) {
          status = 'TOP' + (rankInRank + 1)
          rewardEligible = true
        } else if (passed) {
          status = '排位落榜 已晋级下周排位赛'
        } else {
          status = '冲刺中~'
        }
      }

      return {
        ...s,
        排名: rankIdx + 1,
        赛道: stage,
        晋级状态: status,
        是否获奖: rewardEligible,
        是否达标: passed,
      }
    })

    weekStats.push({
      ...week,
      list,
      达标人数: list.filter(s => s.是否达标).length,
      总流水: Number(list.reduce((sum, s) => sum + s.总流水, 0).toFixed(2)),
    })
  })

  return weekStats
}
