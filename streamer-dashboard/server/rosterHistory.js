import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import { atomicWriteSync } from './utils/atomicWrite.js'

// 导入批次表 + 回滚操作日志（线下主播名册导入的"审计/变更流水"，也是回滚的数据来源）
const HISTORY_PATH = path.join(DATA_DIR, 'roster_history.json')
const ROLLBACK_LOG_PATH = path.join(DATA_DIR, 'roster_rollback_log.json')

export function loadHistory() {
  try {
    const j = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function saveHistory(arr) {
  atomicWriteSync(HISTORY_PATH, JSON.stringify(arr, null, 2))
}

export function loadRollbackLog() {
  try {
    const j = JSON.parse(fs.readFileSync(ROLLBACK_LOG_PATH, 'utf-8'))
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function saveRollbackLog(arr) {
  atomicWriteSync(ROLLBACK_LOG_PATH, JSON.stringify(arr, null, 2))
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function stamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function genBatchId() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `IMP-${stamp()}-${rand}`
}

export function genRollbackId() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `RB-${stamp()}-${rand}`
}

// 写入一条导入批次（含导入前快照 prev，供后续回滚）
export function appendBatch(entry) {
  const arr = loadHistory()
  arr.push(entry)
  // 仅保留最近 200 条，避免无限增长
  if (arr.length > 200) arr.splice(0, arr.length - 200)
  saveHistory(arr)
  return entry
}

export function findBatch(batchId) {
  return loadHistory().find((b) => b.batchId === batchId) || null
}

export function appendRollbackLog(entry) {
  const arr = loadRollbackLog()
  arr.push(entry)
  if (arr.length > 200) arr.splice(0, arr.length - 200)
  saveRollbackLog(arr)
  return entry
}
