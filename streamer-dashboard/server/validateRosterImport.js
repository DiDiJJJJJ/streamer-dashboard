// 线下主播导入模板强校验
// 校验项：表头名称 / 列顺序 / 列数量 / 必填项 / 字段类型与取值范围。
// 任一不合规即整表拒绝（返回全部错误：行 / 列 / 原因），不写入任何数据。

export const EXPECTED_HEADERS = ['房间号', '开播日期', '保底金额', '在职状态']

function normHeader(s) {
  return String(s ?? '')
    .trim()
    .replace(/[【\[]/g, '')
    .replace(/[】\]]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

// Excel 日期标准化：Date 对象 / 序列号 / 各类字符串 -> YYYY-MM-DD
export function normalizeDate(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number') {
    // Excel 1900 日期系统序列号
    const d = new Date((v - 25569) * 86400 * 1000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  return ''
}

/**
 * 校验导入模板。
 * @param {string[]} headers 原始表头（按列顺序）
 * @param {object[]} rows 原始数据行（以表头文本为 key）
 * @returns {{ ok: boolean, errors: Array, normalized: Array }}
 */
export function validateRosterTemplate(headers, rows) {
  const errors = []

  // 1) 列数量
  if (!Array.isArray(headers) || headers.length !== EXPECTED_HEADERS.length) {
    errors.push({
      row: 0,
      col: '表头',
      field: '列数量',
      reason: `模板应为 ${EXPECTED_HEADERS.length} 列（${EXPECTED_HEADERS.join(' / ')}），实际 ${Array.isArray(headers) ? headers.length : 0} 列`,
    })
  } else {
    // 2) 表头名称 + 3) 列顺序
    headers.forEach((h, i) => {
      const nh = normHeader(h)
      const exp = EXPECTED_HEADERS[i]
      if (nh !== exp) {
        const misplacedAt = EXPECTED_HEADERS.findIndex((e) => normHeader(e) === nh)
        if (misplacedAt >= 0) {
          errors.push({
            row: 0,
            col: String(h ?? ''),
            field: '列顺序',
            reason: `列顺序错误：「${h}」应在第 ${misplacedAt + 1} 列，而非第 ${i + 1} 列`,
          })
        } else {
          errors.push({
            row: 0,
            col: String(h ?? ''),
            field: '表头名称',
            reason: `未知列「${h}」，模板仅支持：${EXPECTED_HEADERS.join(' / ')}`,
          })
        }
      }
    })
  }

  // 表头错误直接拒绝（无法定位数据列）
  if (errors.length) {
    return { ok: false, errors: errors.slice(0, 50), normalized: [] }
  }

  // 4) 必填项 + 5) 字段类型与取值范围
  const [roomH, dateH, guaH, statusH] = headers
  const normalized = []
  rows.forEach((row, idx) => {
    const r = idx + 1 // 数据行从 1 开始计数
    const room = String(row[roomH] ?? '').trim()

    if (!room) {
      errors.push({ row: r, col: roomH, field: '房间号', reason: '房间号为必填项，不能为空' })
    } else if (!/^\d{4,12}$/.test(room)) {
      errors.push({ row: r, col: roomH, field: '房间号', reason: `房间号应为 4-12 位纯数字，实际「${room}」` })
    }

    const rawDate = row[dateH]
    let openDate = ''
    if (rawDate != null && String(rawDate).trim() !== '') {
      openDate = normalizeDate(rawDate)
      if (!openDate) {
        errors.push({ row: r, col: dateH, field: '开播日期', reason: `开播日期无法识别为有效日期：${String(rawDate)}` })
      }
    }

    const rawGua = row[guaH]
    let guarantee = ''
    if (rawGua != null && String(rawGua).trim() !== '') {
      const g = String(rawGua).replace(/[^\d.]/g, '')
      const n = Number(g)
      if (g === '' || Number.isNaN(n) || n < 0) {
        errors.push({ row: r, col: guaH, field: '保底金额', reason: `保底金额应为非负数字，实际「${String(rawGua)}」` })
      } else {
        guarantee = n
      }
    }

    const rawStatus = row[statusH]
    let status = ''
    if (rawStatus != null && String(rawStatus).trim() !== '') {
      const s = String(rawStatus).trim()
      if (s !== '在职' && s !== '离职') {
        errors.push({ row: r, col: statusH, field: '在职状态', reason: `在职状态仅允许「在职」或「离职」，实际「${s}」` })
      } else {
        status = s
      }
    }

    if (room && /^\d{4,12}$/.test(room)) {
      normalized.push({ room, openDate, guarantee, status })
    }
  })

  if (errors.length) {
    return { ok: false, errors: errors.slice(0, 50), normalized: [] }
  }
  return { ok: true, errors: [], normalized }
}
