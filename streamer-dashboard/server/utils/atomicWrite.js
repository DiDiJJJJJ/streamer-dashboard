import fs from 'node:fs'
import path from 'node:path'

/**
 * 原子写入：先写唯一临时文件，再替换目标文件。
 *
 * Windows 下的坑：
 *  - 实时杀毒/并发读写会让 rename 偶发 EPERM；
 *  - 同一份数据文件若被「另一个 node 实例」同时读写（例如看门狗重复拉起了多个服务实例），
 *    rename 与 unlink 都会被拒绝，临时文件会不断堆积。
 * 因此这里：rename 失败降级 copyFile，仍失败则退避重试，最后兜底直接覆盖写（可用性优先），
 * 并且每轮都尽力清理临时文件。
 */

/** 真正的阻塞休眠：不占用 CPU（旧版用 while 空转，会把一个核跑满） */
function sleep(ms) {
  if (ms <= 0) return
  try {
    const sab = new SharedArrayBuffer(4)
    Atomics.wait(new Int32Array(sab), 0, 0, ms)
  } catch {
    // 极端环境下没有 SharedArrayBuffer 时退回空转
    const end = Date.now() + ms
    while (Date.now() < end) { /* noop */ }
  }
}

export function atomicWriteSync(filePath, data) {
  let lastErr

  // 阶段一：原子替换（临时文件 -> rename/copy）
  // 次数不宜多：latest.json 有 16MB+，每次失败都会重写一份临时文件，
  // 重试太多会造成大量无效磁盘 IO 与临时文件堆积。
  for (let attempt = 0; attempt < 6; attempt++) {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tmp, data, 'utf-8')
      // 实时杀毒可能在 writeFileSync 返回后仍短暂持有临时文件句柄，稍等再替换
      if (attempt === 0) sleep(30)
      try {
        fs.renameSync(tmp, filePath)
        return
      } catch (renameErr) {
        try {
          fs.copyFileSync(tmp, filePath)
          try { fs.unlinkSync(tmp) } catch { /* ignore */ }
          return
        } catch {
          throw renameErr
        }
      }
    } catch (e) {
      lastErr = e
      try { fs.unlinkSync(tmp) } catch { /* 目标被占用时连临时文件也删不掉，交给启动清理 */ }
      sleep(Math.min(80 * (2 ** attempt), 800))
    }
  }

  // 阶段二：兜底直接覆盖写（非原子，但能绕开 rename 锁定）
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.writeFileSync(filePath, data, 'utf-8')
      return
    } catch (e) {
      lastErr = e
      sleep(Math.min(80 * (2 ** attempt), 800))
    }
  }

  throw lastErr || new Error(`atomicWriteSync failed: ${filePath}`)
}

/**
 * 清理目录下遗留的原子写临时文件（形如 xxx.json.<pid>.<timestamp>.tmp）。
 * 服务启动时调用：历史故障（多实例抢写）曾遗留 299 个共 295MB 的临时文件。
 * @param {string} dir 目标目录
 * @param {number} maxAgeMs 只清理早于该时长的文件，默认 10 分钟，避免误删正在写入的临时文件
 * @returns {{count:number, bytes:number}}
 */
export function cleanStaleTmp(dir, maxAgeMs = 10 * 60 * 1000) {
  const result = { count: 0, bytes: 0 }
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return result
  }

  const now = Date.now()
  const pattern = /\.\d+\.\d+\.tmp$/

  for (const name of entries) {
    if (!pattern.test(name)) continue
    const p = path.join(dir, name)
    try {
      const st = fs.statSync(p)
      if (now - st.mtimeMs < maxAgeMs) continue
      fs.unlinkSync(p)
      result.count += 1
      result.bytes += st.size
    } catch { /* ignore */ }
  }
  return result
}
