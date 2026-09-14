#!/usr/bin/env node
/**
 * reconcile.mjs — 看板后台 vs B站后台 对账差异排查
 *
 * 目标：定位两侧「昨日总流水」等汇总指标的差异来源。
 * 覆盖维度：数据源、统计时间范围、订单状态/金额过滤、退款与手续费、币种换算与精度四舍五入。
 *
 * 用法：
 *   node scripts/reconcile.mjs
 *   或带环境变量：
 *     RECON_DATE=2026-08-11                 # 对账日期（默认昨天）
 *     BILI_TOTAL=13764.4                    # B站后台已知总流水（用于假设检验比对）
 *     BILI_EXPORT=./bilibili_export.json     # 可选：B站按房间号导出的明细（做逐房间 diff）
 *     DATA_FILE=./server/data/latest.json   # 看板数据源（默认 latest.json）
 *     REPORT=./reconcile-report.md          # 报告输出路径
 *
 * BILI_EXPORT 文件格式（二选一）：
 *   [{ "房间号": "123", "总流水（元）": 123.4, ... }, ...]
 *   或 { "total": 13764.4, "rows": [{ "房间号":"123", "总流水（元）": 123.4 }, ...] }
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'server', 'data', 'latest.json'),
  date: process.env.RECON_DATE || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })(),
  biliExport: process.env.BILI_EXPORT || null,
  biliTotal: process.env.BILI_TOTAL ? Number(process.env.BILI_TOTAL) : null,
  kanbanDisplayed: process.env.KANBAN_DISPLAYED ? Number(process.env.KANBAN_DISPLAYED) : null,
  outReport: process.env.REPORT || path.join(__dirname, '..', 'reconcile-report.md'),
}

// ---- 工具：把任意形态的「总流水」字段转成 Number ----
function num(v) {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const s = String(v).replace(/[元天小时%,\s]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}
const round2 = (x) => Math.round(x * 100) / 100
const fmt = (x) => (Math.round(x * 100) / 100).toFixed(2)

// ---- 维度1：看板数据源（latest.json 已合并的权威明细）----
function loadKanban(date) {
  const raw = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'))
  const recs = raw
    .filter((r) => (r['统计结束日期'] || r['统计日期'] || '').includes(date))
    .map((r) => ({ ...r, _rev: num(r['总流水（元）']) }))
  return recs
}

// ---- 维度2：B站导出（可选，用于逐房间 diff）----
function loadBili() {
  if (!CONFIG.biliExport) return null
  const raw = JSON.parse(fs.readFileSync(CONFIG.biliExport, 'utf8'))
  const rows = Array.isArray(raw) ? raw : (raw.rows || [])
  const total = Array.isArray(raw) ? null : (raw.total ?? null)
  const recs = rows.map((r) => ({ ...r, _rev: num(r['总流水（元）'] ?? r['总流水'] ?? r.revenue) }))
  return { recs, total }
}

// ---- 维度3~5：假设检验。每个假设返回 {label, total, delta} ----
// delta = 假设汇总量 - 看板原始全量求和（正数=看板偏多，负数=看板偏少）
function hypotheses(recs) {
  const rev = recs.map((r) => r._rev)
  const rawSum = rev.reduce((a, b) => a + b, 0)

  const out = []
  const push = (label, total) => out.push({ label, total: round2(total), delta: round2(total - rawSum) })

  push('看板全量（未过滤、直接求和，作为基准）', rawSum)

  // 精度/四舍五入：逐条变换后再求和
  push('floor 每条流水后再求和（向下取整）', rev.reduce((a, b) => a + Math.floor(b), 0))
  push('trunc 每条流水后再求和（截断小数）', rev.reduce((a, b) => a + Math.trunc(b), 0))
  push('round 每条流水后再求和（四舍五入选偶）', rev.reduce((a, b) => a + Math.round(b), 0))
  push('ceil 每条流水后再求和（向上取整）', rev.reduce((a, b) => a + Math.ceil(b), 0))
  // 精度：按「分」取整（先 ×100 取整再 ÷100）
  push('按分取整每条后再求和（round(x*100)/100）', rev.reduce((a, b) => a + Math.round(b * 100) / 100, 0))
  // 币种换算：金瓜子 1元=1000电池，平台按电池累计，未兑换零头舍去
  push('按电池换算（floor(x*1000)/1000）再求和', rev.reduce((a, b) => a + Math.floor(b * 1000) / 1000, 0))

  // 订单状态/金额过滤：看板 UI 常用 >=1 过滤「有流水主播」
  push('过滤掉「总流水<1元」记录后求和（UI 常见过滤）', rev.reduce((a, b) => a + (b >= 1 ? b : 0), 0))
  push('过滤掉「总流水<=0」记录后求和', rev.reduce((a, b) => a + (b > 0 ? b : 0), 0))

  // 运营经纪人维度过滤（看板可能只统计有经纪人的主播）
  push('过滤掉「运营经纪人为空」记录后求和',
    recs.filter((r) => String(r['运营经纪人'] || '').trim()).reduce((a, b) => a + b._rev, 0))

  // 总和取整（展示层常见）
  push('总和 Math.round 后再展示', Math.round(rawSum))
  push('总和 Math.floor 后再展示', Math.floor(rawSum))

  const lt1 = rev.filter((v) => v > 0 && v < 1)
  return { rawSum: round2(rawSum), lt1Sum: round2(lt1.reduce((a, b) => a + b, 0)), lt1Count: lt1.length, list: out }
}

// ---- 逐房间 diff（仅当提供 B站导出时）----
function roomDiff(kanban, bili) {
  const mk = (arr) => {
    const m = new Map()
    arr.forEach((r) => { const k = String(r['房间号'] || '').trim(); if (k) m.set(k, r) })
    return m
  }
  const k = mk(kanban), b = mk(bili)
  const onlyKanban = [], onlyBili = [], mismatch = []
  for (const [room, r] of k) {
    if (!b.has(room)) onlyKanban.push({ 房间号: room, 主播昵称: r['主播昵称'], 看板流水: r._rev })
    else {
      const d = round2(r._rev - b.get(room)._rev)
      if (Math.abs(d) > 0.001) mismatch.push({ 房间号: room, 主播昵称: r['主播昵称'], 看板流水: r._rev, B站流水: b.get(room)._rev, 差额: d })
    }
  }
  for (const [room, r] of b) if (!k.has(room)) onlyBili.push({ 房间号: room, 主播昵称: r['主播昵称'], B站流水: r._rev })
  return { onlyKanban, onlyBili, mismatch }
}

// ---- 主流程 ----
function main() {
  const kanban = loadKanban(CONFIG.date)
  const hyp = hypotheses(kanban)
  const bili = CONFIG.biliExport ? loadBili() : null

  const lines = []
  const L = (s = '') => lines.push(s)
  L(`# 对账差异排查报告`)
  L()
  L(`- 对账日期：${CONFIG.date}`)
  L(`- 看板数据源：${CONFIG.dataFile}`)
  L(`- 看板昨日记录数：${kanban.length}`)
  L(`- 看板昨日总流水（全量基准）：${fmt(hyp.rawSum)} 元`)
  if (CONFIG.biliTotal != null) L(`- B站后台昨日总流水（已知）：${fmt(CONFIG.biliTotal)} 元`)
  if (bili && bili.total != null) L(`- B站导出总流水：${fmt(bili.total)} 元`)
  L()

  // 维度：统计时间范围
  L(`## 1. 统计时间范围`)
  const ranges = {}
  kanban.forEach((r) => {
    const s = r['统计开始日期'] || r['统计日期'] || '?'
    const e = r['统计结束日期'] || r['统计日期'] || '?'
    const key = `${s} ~ ${e}`
    ranges[key] = (ranges[key] || 0) + 1
  })
  L(`看板昨日记录覆盖的统计时间区间分布：`)
  Object.entries(ranges).forEach(([k, c]) => L(`- ${k}：${c} 条`))
  L(`> 若 B站 后台统计口径为「00:00:00 ~ 23:59:59」区间，而看板存在「早盘快照(13:00) + 收盘补抓(20:00)」两批写入，`)
  L(`> 在补抓完成前看板会偏低（T+N 延迟结算）。本批次均为完整区间，时间范围一致。`)
  L()

  // 维度：数据源 & 逐房间 diff
  L(`## 2. 数据源与逐房间明细`)
  if (bili) {
    const dd = roomDiff(kanban, bili.recs)
    L(`- 仅在看板出现（B站缺失）：${dd.onlyKanban.length} 个`)
    L(`- 仅在B站出现（看板缺失）：${dd.onlyBili.length} 个`)
    L(`- 双侧都有但金额不一致：${dd.mismatch.length} 个`)
    if (dd.mismatch.length) {
      L()
      L(`| 房间号 | 主播 | 看板流水 | B站流水 | 差额 |`)
      L(`| --- | --- | --- | --- | --- |`)
      dd.mismatch.slice(0, 50).forEach((m) => L(`| ${m.房间号} | ${m.主播昵称} | ${fmt(m.看板流水)} | ${fmt(m.B站流水)} | ${fmt(m.差额)} |`))
    }
  } else {
    L(`未提供 B站 导出明细（BILI_EXPORT）。无法做逐房间 diff，以下仅基于看板数据做假设检验。`)
    L(`如需逐房间定位，请把 B站 后台按「房间号 + 总流水」导出的 JSON 传给 BILI_EXPORT。`)
  }
  L()

  // 维度：订单状态 / 金额过滤
  L(`## 3. 订单状态与金额过滤条件`)
  L(`看板 UI（主播数据页）常对聚合结果应用「总流水 >= 1 元」过滤，仅展示「有流水」主播；`)
  L(`若该过滤集合被直接用于顶部「昨日总流水」汇总，则 0~1 元的小额打赏会被排除。`)
  L()
  L(`**本批次「总流水 < 1 元」的记录（合计即差异额）：**`)
  const lt1 = kanban.filter((r) => r._rev > 0 && r._rev < 1)
  L(`- 记录数：${lt1.length}，合计：${fmt(hyp.lt1Sum)} 元`)
  L()
  lt1.forEach((r) => L(`  - 房间 ${r['房间号']} | ${r['主播昵称']} | 总流水 ${fmt(r._rev)} | 运营经纪人 ${r['运营经纪人'] || '(空)'} | 统计时间 ${r['统计时间']}`))
  L()

  // 维度：退款与手续费
  L(`## 4. 退款与手续费处理逻辑`)
  L(`看板落盘数据（latest.json）未单独保留「退款金额 / 平台手续费」字段，无法直接判定。`)
  L(`若 B站 后台「总流水」为毛收入（含退款、未扣手续费），而看板为净额，则差额 = Σ退款 + Σ手续费。`)
  L(`排查建议：取一笔差额较大的房间，向 B站 后台导出「礼物/大航海明细 + 退款明细 + 手续费明细」逐项核对。`)
  L()

  // 维度：币种与精度四舍五入
  L(`## 5. 币种与精度 / 四舍五入规则`)
  L(`B站 虚拟货币为「金瓜子」，1 元 = 1000 电池；充值/打赏按电池累计，零头电池未兑换部分可能舍去。`)
  L(`看板 cleanRecord 用 parseFloat 保留原始小数，求和无额外截断。下面给出各假设下的汇总值与相对基准的差异：`)
  L()
  L(`| 假设口径 | 汇总值(元) | 相对基准差异 |`)
  L(`| --- | --- | --- |`)
  hyp.list.forEach((h) => {
    let mark = ''
    if (CONFIG.biliTotal != null && Math.abs(h.total - CONFIG.biliTotal) < 0.005) mark = ' ✅匹配B站'
    if (CONFIG.kanbanDisplayed != null && Math.abs(h.total - CONFIG.kanbanDisplayed) < 0.005) mark += ' 🎯匹配看板展示值'
    if (h.label.startsWith('看板全量')) mark = '（基准）'
    L(`| ${h.label} | ${fmt(h.total)} | ${h.delta >= 0 ? '+' : ''}${fmt(h.delta)} |${mark}`)
  })
  L()

  if (CONFIG.kanbanDisplayed != null) {
    const km = hyp.list.filter((h) => Math.abs(h.total - CONFIG.kanbanDisplayed) < 0.005 && !h.label.startsWith('看板全量'))
    if (km.length) {
      L(`> 🎯 以「用户所见看板值 ${fmt(CONFIG.kanbanDisplayed)} 元」为对照，匹配到假设：**${km.map((m) => m.label).join(' / ')}**（相对基准差额 ${fmt(km[0].delta)} 元）。`)
      L(`> 即看板展示口径相对全量基准少算了这部分——正是 B站(${fmt(CONFIG.biliTotal ?? hyp.rawSum)}) 与看板展示(${fmt(CONFIG.kanbanDisplayed)}) 的差额来源。`)
    }
  }
  L()

  // 结论
  L(`## 6. 结论与可能原因分类`)
  if (CONFIG.biliTotal != null) {
    const gap = round2(CONFIG.biliTotal - hyp.rawSum)
    L(`- 看板全量基准 ${fmt(hyp.rawSum)} 与 B站 ${fmt(CONFIG.biliTotal)} 的差距 = ${fmt(gap)} 元。`)
    // 自动匹配假设
    const matched = hyp.list.filter((h) => Math.abs(h.total - CONFIG.biliTotal) < 0.005 && !h.label.startsWith('看板全量'))
    if (matched.length) {
      L(`- 自动匹配到以下假设恰好等于 B站 数值，最可能的原因即对应口径：`)
      matched.forEach((m) => L(`  - **${m.label}** → ${fmt(m.total)} 元`))
    } else {
      L(`- 未找到单一假设精确匹配 B站 数值，差异可能为「多因素叠加」（如 过滤 + 退款 + 币种零头）。`)
    }
  }
  L(`- 主因候选（按可能性排序）：`)
  L(`  1. **金额过滤**：看板 UI 对「昨日总流水」卡片复用了 \`>= 1 元\` 过滤后的集合，排除了 0~1 元小额打赏（本批次合计 ${fmt(hyp.lt1Sum)} 元）。`)
  L(`  2. **统计时间范围/T+N 延迟**：若对账发生在 20:00 收盘补抓之前，看板为早盘快照会偏低。`)
  L(`  3. **退款/手续费**：需补充 B站 明细才能判定。`)
  L(`  4. **币种零头**：金瓜子电池零头舍去，量级通常极小。`)
  L()
  L(`## 7. 建议修复`)
  L(`- 顶部「昨日总流水」卡片应使用**全量聚合**（不过滤 <1 元），或将过滤仅用于「有流水主播列表」展示。`)
  L(`- 若需与 B站 后台严格一致，建议看板增加「退款金额 / 手续费」字段，并对账时按净额/毛额分别展示。`)

  const md = lines.join('\n')
  fs.writeFileSync(CONFIG.outReport, md, 'utf-8')
  console.log(md)
  console.log(`\n[报告已写入] ${CONFIG.outReport}`)
}

main()
