export interface Annotation {
  id: string
  num: number
  comment: string
  color: string
  box?: { x: number; y: number; w: number; h: number }
  point?: { x: number; y: number }
}

export interface Arrow {
  id: string
  x1: number; y1: number; x2: number; y2: number
  color: string
}

const PANEL_W = 300
const PADDING = 24

export async function renderComposite(
  img: HTMLImageElement,
  imgSize: { w: number; h: number },
  annotations: Annotation[],
  arrows: Arrow[] = []
): Promise<string> {
  const imgW = imgSize.w
  const imgH = imgSize.h

  // Annotation sizes — fixed small pin, large readable text
  const pinR = 14
  const strokeW = Math.max(2, Math.round(imgW * 0.002))
  const pinFont = 12

  const noted = annotations.filter(a => a.comment.trim())
  const titleH = 44
  const itemH = Math.max(36, pinR * 2 + 12)
  const legendH = noted.length > 0 ? 56 : 0
  const notesH = titleH + noted.length * itemH + legendH + PADDING * 2
  const totalH = Math.max(imgH, notesH)
  const totalW = PANEL_W + imgW

  const canvas = document.createElement('canvas')
  canvas.width = totalW
  canvas.height = totalH
  const ctx = canvas.getContext('2d')!

  // White background
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, totalW, totalH)

  // Notes panel title
  ctx.fillStyle = '#111'
  ctx.font = `bold 18px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.fillText('Notes', PADDING, PADDING + 18)

  // Notes items
  noted.forEach((a, i) => {
    const y = PADDING + titleH + i * itemH
    const cx = PADDING + pinR
    const cy = y + pinR

    ctx.beginPath()
    ctx.arc(cx, cy, pinR, 0, Math.PI * 2)
    ctx.fillStyle = a.color
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.font = `bold ${pinFont}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(a.num), cx, cy + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    ctx.fillStyle = '#222'
    ctx.font = `17px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.fillText(a.comment, PADDING + pinR * 2 + 8, cy + 5, PANEL_W - PADDING - pinR * 2 - 16)
  })

  if (noted.length > 0) {
    const legendY = PADDING + titleH + noted.length * itemH + 10
    ctx.fillStyle = '#aaa'
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText('Numbers map to the notes above.', PADDING, legendY)
    ctx.fillText('Outlined shapes are user-added annotations.', PADDING, legendY + 18)
  }

  // Divider
  ctx.strokeStyle = '#e5e5e5'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PANEL_W, 0)
  ctx.lineTo(PANEL_W, totalH)
  ctx.stroke()

  // Image
  const imgOffsetY = (totalH - imgH) / 2
  ctx.drawImage(img, PANEL_W, imgOffsetY, imgW, imgH)

  // Arrows (visual only)
  arrows.forEach(a => {
    ctx.strokeStyle = a.color
    ctx.lineWidth = strokeW
    drawArrow(ctx, PANEL_W + a.x1, imgOffsetY + a.y1, PANEL_W + a.x2, imgOffsetY + a.y2, strokeW)
  })

  // Annotations on image
  annotations.forEach(a => {
    const ox = PANEL_W
    const oy = imgOffsetY
    ctx.strokeStyle = a.color
    ctx.lineWidth = strokeW

    if (a.box) {
      ctx.strokeRect(ox + a.box.x, oy + a.box.y, a.box.w, a.box.h)
    }

    const px = a.box ? ox + a.box.x : ox + a.point!.x
    const py = a.box ? oy + a.box.y : oy + a.point!.y

    ctx.beginPath()
    ctx.arc(px, py, pinR, 0, Math.PI * 2)
    ctx.fillStyle = a.color
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.font = `bold ${pinFont}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(a.num), px, py + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  })

  return canvas.toDataURL('image/png')
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, lw: number): void {
  const headLen = Math.max(16, lw * 5)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
  ctx.stroke()
}
