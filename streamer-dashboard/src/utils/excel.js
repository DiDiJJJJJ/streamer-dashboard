import * as XLSX from 'xlsx'

export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        // 优先选择主播数据所在的工作表（与服务器解析逻辑保持一致），找不到再退回第一个
        const sheetName =
          workbook.SheetNames.find((n) => /主播|anchor|数据/i.test(n)) ||
          workbook.SheetNames[0]
        const firstSheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
        resolve(json)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
