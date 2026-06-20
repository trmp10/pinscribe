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
  bidirectional?: boolean
  label?: string
}

export interface TextItem {
  id: string
  x: number
  y: number
  text: string
  color: string
  width?: number
  height?: number
  fontSize?: number
}

const PANEL_W = 300
const PADDING = 24

export function renderComposite(
  img: HTMLImageElement,
  imgSize: { w: number; h: number },
  annotations: Annotation[],
  arrows: Arrow[] = [],
  texts: TextItem[] = []
): string {
  const imgW = imgSize.w
  const imgH = imgSize.h

  // Annotation sizes — fixed small pin, large readable text
  const pinR = 14
  const strokeW = 2
  const pinFont = 12

  const noted = annotations.filter(a => a.comment.trim())
  const titleH = 44
  const COMMENT_FONT = `17px -apple-system, BlinkMacSystemFont, sans-serif`
  const TEXT_LEFT = PADDING + pinR * 2 + 8
  const COMMENT_MAX_W = PANEL_W - PADDING - TEXT_LEFT
  const LINE_H = 22
  // Pre-measure wrapped lines to compute correct itemH per annotation
  const measureCtx = document.createElement('canvas').getContext('2d')!
  measureCtx.font = COMMENT_FONT
  const notedWithLines = noted.map(a => {
    const lines = wrapText(measureCtx, a.comment, COMMENT_MAX_W)
    return { ...a, lines }
  })
  const notesH = titleH + notedWithLines.reduce((acc, a) => acc + Math.max(pinR * 2 + 12, a.lines.length * LINE_H + 16), 0) + PADDING * 2
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
  let noteY = PADDING + titleH
  notedWithLines.forEach(a => {
    const itemH = Math.max(pinR * 2 + 12, a.lines.length * LINE_H + 16)
    const cx = PADDING + pinR
    const cy = noteY + pinR + 4

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
    ctx.font = COMMENT_FONT
    a.lines.forEach((line, li) => {
      ctx.fillText(line, TEXT_LEFT, noteY + 20 + li * LINE_H)
    })

    noteY += itemH
  })

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
    drawArrow(ctx, PANEL_W + a.x1, imgOffsetY + a.y1, PANEL_W + a.x2, imgOffsetY + a.y2, strokeW, a.bidirectional)
    if (a.label) {
      const lx = PANEL_W + (a.x1 + a.x2) / 2
      const ly = imgOffsetY + (a.y1 + a.y2) / 2
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(a.label).width
      const pw = tw + 12, ph = 18, pr = 5
      ctx.fillStyle = a.color
      ctx.beginPath(); ctx.roundRect(lx - pw / 2, ly - ph / 2, pw, ph, pr); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.fillText(a.label, lx, ly)
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    }
  })

  // Text items on image
  const TEXT_FONT_SIZE = 16
  const TEXT_LINE_HEIGHT = 22
  const TEXT_MAX_W = 200
  texts.forEach(t => {
    const fs = t.fontSize ?? TEXT_FONT_SIZE
    ctx.font = `bold ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.fillStyle = t.color
    const maxW = t.width ?? TEXT_MAX_W
    const lines = wrapText(ctx, t.text, maxW)
    const lh = fs * 1.4
    lines.forEach((line, i) => {
      ctx.fillText(line, PANEL_W + t.x, imgOffsetY + t.y + fs + i * lh)
    })
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

    const px = a.box ? ox + a.box.x + a.box.w : ox + a.point!.x
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    // Break any remaining word that's still too wide (no spaces)
    if (ctx.measureText(line).width > maxWidth) {
      let chunk = ''
      for (const ch of line) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { lines.push(chunk); chunk = ch }
        else chunk += ch
      }
      if (chunk) lines.push(chunk)
    } else if (line) {
      lines.push(line)
    }
  }
  return lines.length ? lines : ['']
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, lw: number, bidirectional?: boolean): void {
  const arrowLen = Math.hypot(x2 - x1, y2 - y1)
  const headLen = Math.min(Math.max(6, lw * 5), arrowLen / 2.2)
  const headAngle = Math.PI / 5
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle - headAngle), y2 - headLen * Math.sin(angle - headAngle))
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle + headAngle), y2 - headLen * Math.sin(angle + headAngle))
  if (bidirectional) {
    const ra = Math.atan2(y1 - y2, x1 - x2)
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - headLen * Math.cos(ra - headAngle), y1 - headLen * Math.sin(ra - headAngle))
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - headLen * Math.cos(ra + headAngle), y1 - headLen * Math.sin(ra + headAngle))
  }
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
}
