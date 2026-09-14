import XLSX from 'xlsx'

// 与前端 ALL_COLUMNS 保持一致（仅读取运营经纪人，忽略招募经纪人）
export const ALL_COLUMNS = [
  '主播昵称', '主播id', '房间号', '开播分区',
  '运营经纪人', '运营经纪人UID', '主播在会时间',
  'TOPSTAR等级', '主播等级分数', '粉丝数', '总流水（元）', '总收益（元）',
  '主播自提礼物收益', '语聊房嘉宾收益（元）', '专属互动礼物收益（元）', '新增粉丝数',
  '弹幕数', '开播天数', '开播时长（小时）', 'pk次数', 'pk流水', 'pk付费人数',
  '违规次数', '峰值在线人数（pcu）', '平均在线人数（acu）', '付费人数', '大航海人数',
  '渠道来源', '年龄分层', '性别', '直播经验', '直播类型', '主播身份', '统计时间',
]

// 列名归一化：去空格、统一全半角括号、小写化英文
function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .toLowerCase()
}

// 标准列 -> 可能的别名（B站导出表列名会有细微差异）
const ALIASES = {
  '主播昵称': ['主播昵称', '昵称', '主播名称', '主播'],
  '主播id': ['主播id', '主播uid', 'uid', '主播用户id'],
  '房间号': ['房间号', '直播间号', '直播间id', 'roomid', '房间id'],
  '开播分区': ['开播分区', '分区', '直播分区', '所属分区'],
  '运营经纪人': ['运营经纪人', '运营', '运营人员', '所属运营'],
  '运营经纪人uid': ['运营经纪人uid', '运营uid'],
  '主播在会时间': ['主播在会时间', '在会时间', '入会时间', '签约时间'],
  'topstar等级': ['topstar等级', 'top star等级', 'topstar'],
  '主播等级分数': ['主播等级分数', '等级分数', '主播分数'],
  '粉丝数': ['粉丝数', '粉丝总数', '总粉丝数'],
  '总流水(元)': ['总流水(元)', '总流水', '流水(元)', '流水'],
  '总收益(元)': ['总收益(元)', '总收益', '收益(元)', '收益'],
  '主播自提礼物收益': ['主播自提礼物收益', '自提礼物收益', '自提收益'],
  '语聊房嘉宾收益(元)': ['语聊房嘉宾收益(元)', '语聊房嘉宾收益', '嘉宾收益'],
  '专属互动礼物收益(元)': ['专属互动礼物收益(元)', '专属互动礼物收益', '互动礼物收益'],
  '新增粉丝数': ['新增粉丝数', '新增粉丝', '涨粉数'],
  '弹幕数': ['弹幕数', '弹幕总数', '弹幕量'],
  '开播天数': ['开播天数', '直播天数', '有效开播天数'],
  '开播时长(小时)': ['开播时长(小时)', '开播时长', '直播时长(小时)', '直播时长'],
  'pk次数': ['pk次数'],
  'pk流水': ['pk流水'],
  'pk付费人数': ['pk付费人数'],
  '违规次数': ['违规次数', '违规'],
  '峰值在线人数(pcu)': ['峰值在线人数(pcu)', 'pcu', '峰值在线人数', '最高在线'],
  '平均在线人数(acu)': ['平均在线人数(acu)', 'acu', '平均在线人数'],
  '付费人数': ['付费人数', '付费用户数'],
  '大航海人数': ['大航海人数', '大航海', '大航海开通人数', '舰长数', '大航海数量', '新增大航海'],
  '渠道来源': ['渠道来源', '来源渠道', '渠道'],
  '年龄分层': ['年龄分层', '年龄段', '年龄'],
  '性别': ['性别'],
  '直播经验': ['直播经验', '经验'],
  '直播类型': ['直播类型', '类型'],
  '主播身份': ['主播身份', '身份'],
  '统计时间': ['统计时间', '数据日期', '日期', '统计日期', '统计周期'],
}

const NUMERIC_COLUMNS = [
  '粉丝数', '总流水（元）', '总收益（元）', '主播自提礼物收益',
  '语聊房嘉宾收益（元）', '专属互动礼物收益（元）', '新增粉丝数', '弹幕数',
  '开播天数', '开播时长（小时）', 'pk次数', 'pk流水', 'pk付费人数', '违规次数',
  '峰值在线人数（pcu）', '平均在线人数（acu）', '付费人数', '大航海人数',
]

// 清洗数值：去掉「天/元/小时/%/逗号」等单位后转数字
export function toNumber(v) {
  if (v === undefined || v === null || v === '' || v === '-') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const s = String(v).replace(/[,，\s]/g, '').replace(/(元|天|小时|个|人|次|%)/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function cleanText(v) {
  if (v === undefined || v === null || v === '-') return ''
  return String(v).trim()
}

/** 从统计时间提取日期 */
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

/** 建立 表头 -> 标准列 的映射 */
function buildHeaderMap(headers) {
  const map = {}
  headers.forEach(h => {
    const nh = norm(h)
    for (const std of ALL_COLUMNS) {
      const key = norm(std)
      const aliases = ALIASES[key] || [key]
      if (aliases.some(a => norm(a) === nh) || nh === key) {
        map[h] = std
        return
      }
    }
    // 宽松匹配：包含关系
    for (const std of ALL_COLUMNS) {
      const key = norm(std)
      const aliases = ALIASES[key] || [key]
      if (aliases.some(a => nh.includes(norm(a)) || norm(a).includes(nh))) {
        if (!Object.values(map).includes(std)) {
          map[h] = std
          return
        }
      }
    }
  })
  return map
}

/** 把一行原始数据规范化为标准 record */
function normalizeRow(row, headerMap, statTime) {
  const out = {}
  ALL_COLUMNS.forEach(c => { out[c] = '' })

  Object.entries(row).forEach(([k, v]) => {
    const std = headerMap[k]
    if (std) out[std] = v
  })

  out['主播id'] = cleanText(out['主播id'])
  out['房间号'] = cleanText(out['房间号'])
  out['运营经纪人UID'] = cleanText(out['运营经纪人UID'])
  out['运营经纪人'] = cleanText(out['运营经纪人'])
  out['主播昵称'] = cleanText(out['主播昵称'])

  NUMERIC_COLUMNS.forEach(c => { out[c] = toNumber(out[c]) })

  ALL_COLUMNS.forEach(c => {
    if (!NUMERIC_COLUMNS.includes(c)) out[c] = cleanText(out[c])
  })

  if (!out['统计时间'] && statTime) out['统计时间'] = statTime

  const stat = parseStatTime(out['统计时间'])
  // 区间（连续多日）数据把「统计日期」标记为截止日（as-of），与前端 cleanRecord 保持一致
  out['统计日期'] = stat.end || stat.start || stat.date
  out['统计开始日期'] = stat.start
  out['统计结束日期'] = stat.end

  return out
}

/**
 * 解析 B站导出的 xlsx / csv
 * @param {string} filePath
 * @param {string} statTime 统计时间兜底（如 "2026-08-08 ~ 2026-08-08"）
 */
export function parseWorkbook(filePath, statTime = '') {
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false })
  const sheetName = wb.SheetNames.find(n => /主播|anchor|数据/i.test(n)) || wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  if (!rows.length) return { records: [], headerMap: {}, sheetName, rawHeaders: [] }

  const rawHeaders = Object.keys(rows[0])
  const headerMap = buildHeaderMap(rawHeaders)
  const records = rows
    .map(r => normalizeRow(r, headerMap, statTime))
    .filter(r => r['房间号'] || r['主播id'] || r['主播昵称'])

  return { records, headerMap, sheetName, rawHeaders }
}

function recordKey(r) {
  const room = String(r['房间号'] || r['主播id'] || '')
  const stat = parseStatTime(r['统计时间'])
  if (stat.start && stat.start === stat.end) {
    return `${room}::${stat.start}`
  }
  // 区间（连续多日）快照按「房间号::RANGE」为键，避免多次下载的相近区间累积成重复记录
  return `${room}::RANGE`
}

/** 合并两批数据：以「房间号 + 统计日期/区间」为唯一键，新数据覆盖旧数据 */
export function mergeRecords(base = [], incoming = []) {
  const map = new Map()
  base.forEach(r => map.set(recordKey(r), r))
  incoming.forEach(r => {
    const key = recordKey(r)
    const old = map.get(key)
    if (!old) { map.set(key, r); return }
    const merged = { ...old, ...r }
    // byDate 单日「按日汇总下载」导出不含「大航海人数」字段（恒为 0），
    // 若新数据该项为 0 而旧数据有非零值，则保留旧值，避免把已结算的大航海覆盖清零。
    if ((!merged['大航海人数'] || Number(merged['大航海人数']) === 0) &&
        old['大航海人数'] && Number(old['大航海人数']) !== 0) {
      merged['大航海人数'] = old['大航海人数']
    }
    map.set(key, merged)
  })
  return Array.from(map.values())
}

/** 仅按房间号合并（取最新一条，用于全量替换场景） */
export function mergeByRoom(base = [], incoming = []) {
  const map = new Map()
  base.forEach(r => map.set(String(r['房间号'] || r['主播id']), r))
  incoming.forEach(r => {
    const key = String(r['房间号'] || r['主播id'])
    const old = map.get(key)
    map.set(key, old ? { ...old, ...r } : r)
  })
  return Array.from(map.values())
}
