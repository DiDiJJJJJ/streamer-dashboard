import { useState, useRef, useEffect } from 'react'
import { X, Download, Loader2, Image as ImageIcon } from 'lucide-react'

/**
 * 可复用的「生成海报」按钮 + 预览弹窗。
 * 用于运营端（ChallengePage）与对外分享页（share.jsx）。
 * board 结构：{ weekLabel, totals:{参赛人数,达标人数,总流水}, top3:[], rows:[] }
 *
 * 关键修复：每次点击都基于「当前」board 重新生成 canvas，并直接绘制到弹窗内的
 * <canvas> 元素（不依赖 data URL 字符串，避免浏览器/状态缓存导致展示旧海报）。
 * 生成前与关闭时均清空状态，杜绝旧图残留。
 */
export function PosterButton({ board, statTime, label = '生成海报' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [posterCanvas, setPosterCanvas] = useState(null) // 当前生成的 canvas 元素
  const canvasRef = useRef(null)
  const genSeq = useRef(0) // 生成序号，确保只绘制「最新一次」的结果

  // 每次打开或生成新图，把最新 canvas 重绘到弹窗内（clearRect 确保无残影）
  useEffect(() => {
    if (!open || !posterCanvas || !canvasRef.current) return
    const dest = canvasRef.current
    dest.width = posterCanvas.width
    dest.height = posterCanvas.height
    const ctx = dest.getContext('2d')
    ctx.clearRect(0, 0, dest.width, dest.height)
    ctx.drawImage(posterCanvas, 0, 0)
  }, [open, posterCanvas])

  async function gen() {
    if (!board) {
      setErr('暂无榜单数据，无法生成海报')
      return
    }
    const seq = ++genSeq.current
    setBusy(true)
    setErr('')
    setPosterCanvas(null) // 先清空旧图，避免展示上一次的残留
    try {
      const { renderPoster } = await import('../utils/poster')
      // 时间取传入值；未传则取点击时刻的最新时间（避免挂载时冻结）
      const t = statTime || new Date().toLocaleString('zh-CN')
      // 整体超时兜底：绝不让按钮卡在「生成中」
      const canvas = await Promise.race([
        renderPoster(board, { statTime: t }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('海报生成超时（15s），请刷新页面后重试')), 15000)
        ),
      ])
      // 仅当本次生成仍为「最新一次」时才采用，防止快速重复点击错乱
      if (seq === genSeq.current) {
        setPosterCanvas(canvas)
        setOpen(true)
      }
    } catch (e) {
      setErr(e?.message || '海报生成失败')
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setOpen(false)
    // 关闭后清空，确保下次打开是干净状态
    setPosterCanvas(null)
    setErr('')
  }

  function download() {
    if (!posterCanvas) return
    const a = document.createElement('a')
    a.href = posterCanvas.toDataURL('image/png')
    a.download = '紫萝传媒挑战赛本周榜单.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <>
      <button
        onClick={gen}
        disabled={busy || !board}
        className="fx-lift flex items-center gap-1.5 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-amber-600 hover:to-orange-600 disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
        {busy ? '生成中…' : label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="max-h-[92vh] w-full max-w-sm overflow-auto rounded-2xl bg-white p-3 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-text">挑战赛本周榜单海报</span>
              <button onClick={close} className="fx-pop rounded-md p-1 text-text-secondary hover:bg-bg">
                <X size={16} />
              </button>
            </div>
            {posterCanvas ? (
              <canvas ref={canvasRef} className="w-full rounded-lg" />
            ) : (
              <div className="flex h-72 w-full items-center justify-center rounded-lg bg-bg text-xs text-text-secondary">
                {busy ? '海报生成中…' : '海报已关闭'}
              </div>
            )}
            {err && <div className="mt-2 text-xs text-danger">{err}</div>}
            <button
              onClick={download}
              disabled={!posterCanvas}
              className="fx-glow mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <Download size={15} /> 下载 / 保存图片
            </button>
            <div className="mt-2 text-center text-[10px] text-text-muted">手机端可长按图片保存到相册</div>
          </div>
        </div>
      )}
    </>
  )
}
