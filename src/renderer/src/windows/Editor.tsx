import React, { useEffect, useRef, useState, useCallback } from 'react'
import { renderComposite, type Annotation, type Arrow, type TextItem } from '../components/renderComposite'
import CommentPopup from '../components/CommentPopup'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool = 'box' | 'arrow' | 'text'

// ─── Constants ────────────────────────────────────────────────────────────────

const PANEL_W = 260
const PIN_R = 14
const DRAG_THRESHOLD = 8
const UI_COLOR = '#e8334a'

const COLORS = [
  { label: 'Red',    value: '#e8334a' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Amber',  value: '#f59e0b' },
  { label: 'Purple', value: '#a855f7' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function Editor(): React.ReactElement {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const seq          = useRef(1)
  const isDown       = useRef(false)

  const [img, setImg]             = useState<HTMLImageElement | null>(null)
  const [imgSize, setImgSize]     = useState({ w: 0, h: 0 })
  const [scale, setScale]         = useState(1)
  const [zoom, setZoom]           = useState(1)
  const [tool, setTool]           = useState<Tool>('box')
  const [color, setColor]         = useState(COLORS[0].value)
  const [colorOpen, setColorOpen] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [arrows, setArrows]       = useState<Arrow[]>([])
  const [texts, setTexts]         = useState<TextItem[]>([])
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [draft, setDraft]         = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [popup, setPopup]         = useState<{ id: string; sx: number; sy: number } | null>(null)
  const [activeText, setActiveText] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const [activeTextValue, setActiveTextValue] = useState('')
  const [dropHighlight, setDropHighlight] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'available' | 'downloading' | 'ready' | 'uptodate' | 'error'>('idle')
  const [updatePct, setUpdatePct] = useState(0)
  const [updateError, setUpdateError] = useState('')

  const effectiveScale = scale * zoom

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => { draw() }, [img, imgSize, scale, zoom, annotations, arrows, draft, texts, color])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') window.close()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') copyClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (img) window.api.savePng(renderComposite(img, imgSize, annotations, arrows, texts)) }
      if (e.key === 'Escape') setColorOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [img, imgSize, annotations, arrows, texts])

  useEffect(() => {
    const over  = (e: DragEvent): void => { e.preventDefault(); setDropHighlight(true) }
    const leave = (): void => setDropHighlight(false)
    const drop  = (e: DragEvent): void => {
      e.preventDefault()
      setDropHighlight(false)
      const file = e.dataTransfer?.files[0]
      if (file?.type.startsWith('image/')) readFile(file)
    }
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    const onUp = (): void => {
      if (isDown.current) { isDown.current = false; setDraft(null) }
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    window.api.onUpdateAvailable(() => setUpdateState('available'))
    window.api.onUpdateProgress(pct => { setUpdateState('downloading'); setUpdatePct(pct) })
    window.api.onUpdateDownloaded(() => setUpdateState('ready'))
    window.api.onUpdateNotAvailable(() => {
      setUpdateState('uptodate')
      setTimeout(() => setUpdateState('idle'), 3000)
    })
    window.api.onUpdateError(msg => { setUpdateState('error'); setUpdateError(msg) })
  }, [])

  // ─── Image loading ────────────────────────────────────────────────────────

  function readFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => loadImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  function loadImage(dataUrl: string): void {
    const el = new window.Image()
    el.onload = () => {
      const maxW = window.innerWidth - PANEL_W
      const maxH = window.innerHeight - 56 - 44
      const s = Math.min(maxW / el.width, maxH / el.height, 1)
      seq.current = 1
      setAnnotations([])
      setArrows([])
      setTexts([])
      setZoom(1)
      setImg(el)
      setImgSize({ w: el.width, h: el.height })
      setScale(s)
    }
    el.src = dataUrl
  }

  // ─── Canvas drawing ───────────────────────────────────────────────────────

  function draw(): void {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    const es = effectiveScale
    canvas.width  = imgSize.w * es
    canvas.height = imgSize.h * es
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    arrows.forEach(a => {
      ctx.strokeStyle = a.color
      ctx.lineWidth = 2
      drawArrowShape(ctx, a.x1 * es, a.y1 * es, a.x2 * es, a.y2 * es)
    })

    annotations.forEach(a => {
      ctx.strokeStyle = a.color
      ctx.lineWidth = 2
      if (a.box) ctx.strokeRect(a.box.x * es, a.box.y * es, a.box.w * es, a.box.h * es)
      const px = a.box ? a.box.x * es : a.point!.x * es
      const py = a.box ? a.box.y * es : a.point!.y * es
      drawPin(ctx, px, py, a.num, a.color)
    })

    texts.forEach(t => {
      const fs = 16 * es
      ctx.font = `bold ${fs}px -apple-system, sans-serif`
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x * es, t.y * es)
    })

    if (draft) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      if (tool === 'box') {
        ctx.setLineDash([6, 3])
        ctx.strokeRect(draft.x1 * es, draft.y1 * es, (draft.x2 - draft.x1) * es, (draft.y2 - draft.y1) * es)
        ctx.setLineDash([])
      } else if (tool === 'arrow') {
        drawArrowShape(ctx, draft.x1 * es, draft.y1 * es, draft.x2 * es, draft.y2 * es)
      }
    }
  }

  function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, num: number, c: string): void {
    ctx.beginPath()
    ctx.arc(x, y, PIN_R, 0, Math.PI * 2)
    ctx.fillStyle = c
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 13px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(num), x, y + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  function drawArrowShape(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    const headLen = 14
    const angle = Math.atan2(y2 - y1, x2 - x1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  }

  // ─── Mouse interaction ────────────────────────────────────────────────────

  function canvasPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / effectiveScale, y: (e.clientY - r.top) / effectiveScale }
  }

  function annotationAt(x: number, y: number): Annotation | undefined {
    return annotations.find(a => {
      const px = a.box ? a.box.x : a.point!.x
      const py = a.box ? a.box.y : a.point!.y
      return Math.hypot(px - x, py - y) <= PIN_R / effectiveScale
    })
  }

  function arrowAt(x: number, y: number): Arrow | undefined {
    const threshold = 8 / effectiveScale
    return arrows.find(a => {
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1
      const len2 = dx * dx + dy * dy
      if (len2 === 0) return Math.hypot(a.x1 - x, a.y1 - y) < threshold
      const t = Math.max(0, Math.min(1, ((x - a.x1) * dx + (y - a.y1) * dy) / len2))
      return Math.hypot(a.x1 + t * dx - x, a.y1 + t * dy - y) < threshold
    })
  }

  function commitText(): void {
    if (!activeText) return
    const val = activeTextValue.trim()
    if (val) {
      const id = `text-${Date.now()}`
      setTexts(prev => [...prev, { id, x: activeText.x, y: activeText.y, text: val, color }])
    }
    setActiveText(null)
    setActiveTextValue('')
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (popup) return
    setColorOpen(false)
    const pos = canvasPos(e)
    if (tool === 'text') {
      setActiveText({ x: pos.x, y: pos.y, sx: e.clientX, sy: e.clientY })
      setActiveTextValue('')
      return
    }
    isDown.current = true
    setDragStart(pos)
    setDraft({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!isDown.current) return
    const pos = canvasPos(e)
    if (tool === 'arrow' && e.shiftKey) {
      const dx = pos.x - dragStart.x
      const dy = pos.y - dragStart.y
      const dist = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      setDraft(prev => prev ? { ...prev, x2: prev.x1 + dist * Math.cos(snapped), y2: prev.y1 + dist * Math.sin(snapped) } : null)
    } else {
      setDraft(prev => prev ? { ...prev, x2: pos.x, y2: pos.y } : null)
    }
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!isDown.current) return
    isDown.current = false
    if (!draft) return
    const dx = Math.abs(draft.x2 - draft.x1)
    const dy = Math.abs(draft.y2 - draft.y1)
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
      setDraft(null)
      const hit = annotationAt(draft.x1, draft.y1)
      if (hit) { setPopup({ id: hit.id, sx: e.clientX, sy: e.clientY }); return }
      const arrowHit = arrowAt(draft.x1, draft.y1)
      if (arrowHit) { setArrows(prev => prev.filter(a => a.id !== arrowHit.id)); return }
      if (tool === 'box') {
        const num = seq.current++
        const id = `shape-${Date.now()}`
        setAnnotations(prev => [...prev, { id, num, comment: '', color, point: { x: draft.x1, y: draft.y1 } }])
        setPopup({ id, sx: e.clientX, sy: e.clientY })
      }
      return
    }

    const id = `shape-${Date.now()}`

    if (tool === 'arrow') {
      setArrows(prev => [...prev, { id, x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2, color }])
    } else {
      const num = seq.current++
      const box = {
        x: Math.min(draft.x1, draft.x2), y: Math.min(draft.y1, draft.y2),
        w: Math.abs(draft.x2 - draft.x1),  h: Math.abs(draft.y2 - draft.y1)
      }
      setAnnotations(prev => [...prev, { id, num, comment: '', color, box }])
      setPopup({ id, sx: e.clientX, sy: e.clientY })
    }
    setDraft(null)
  }

  // ─── Output ───────────────────────────────────────────────────────────────

  const copyClose = useCallback(() => {
    if (!img) return
    const dataUrl = renderComposite(img, imgSize, annotations, arrows, texts)
    window.api.copyToClipboard(dataUrl)
    window.close()
  }, [img, imgSize, annotations, arrows, texts])

  // ─── Render ───────────────────────────────────────────────────────────────

  const cw = imgSize.w * effectiveScale
  const ch = imgSize.h * effectiveScale

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />

      {/* Title bar — fully draggable, toolbar centered inside */}
      <div style={{ height: 44, flexShrink: 0, borderBottom: '1px solid #2a2a2a', position: 'relative', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 4,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}>
          <ToolBtn active={tool === 'box'} onClick={() => setTool('box')} title="Annotation box">
            <IconPin />
          </ToolBtn>
          <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow (hold Shift to lock straight)">
            <IconArrow />
          </ToolBtn>
          <ToolBtn active={tool === 'text'} onClick={() => setTool('text')} title="Text">
            <IconText />
          </ToolBtn>

          <Divider />

          <div style={{ position: 'relative' }}>
            <button onClick={() => setColorOpen(p => !p)} title="Annotation colour"
              style={{ width: 22, height: 22, borderRadius: '50%', background: color, border: colorOpen ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }} />
            {colorOpen && (
              <div style={{ position: 'absolute', top: 30, left: '50%', transform: 'translateX(-50%)', background: '#222', border: '1px solid #444', borderRadius: 10, padding: 10, display: 'flex', gap: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                {COLORS.map(c => (
                  <button key={c.value} title={c.label} onClick={() => { setColor(c.value); setColorOpen(false) }}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c.value, cursor: 'pointer', border: color === c.value ? '2px solid #fff' : '2px solid transparent', padding: 0 }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Update banner */}
      {updateState !== 'idle' && (
        <div style={{ flexShrink: 0, height: 34, background: '#1a1a2a', borderBottom: '1px solid #2a2a3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', fontSize: 12 }}>
          <span style={{ color: updateState === 'ready' ? '#22c55e' : updateState === 'error' ? '#ef4444' : '#888' }}>
            {updateState === 'available' && 'Downloading update...'}
            {updateState === 'downloading' && `Downloading update — ${updatePct}%`}
            {updateState === 'ready' && 'Update ready to install.'}
            {updateState === 'uptodate' && "You're up to date."}
            {updateState === 'error' && `Update failed: ${updateError}`}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {updateState === 'ready' && (
              <button onClick={() => window.api.installUpdate()}
                style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Restart
              </button>
            )}
            <button onClick={() => setUpdateState('idle')}
              style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Notes panel */}
        <div style={{ width: PANEL_W, flexShrink: 0, borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: 4, overflowY: 'auto' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Notes</div>
          {annotations.length === 0 && (
            <div style={{ color: '#444', fontSize: 13 }}>Annotations will appear here</div>
          )}
          {annotations.map(a => (
            <div key={a.id} onClick={() => setPopup({ id: a.id, sx: PANEL_W + 20, sy: 120 })}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: a.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1, paddingTop: 2 }}>
                {a.num}
              </div>
              <div style={{ color: a.comment ? '#ddd' : '#555', fontSize: 13, paddingTop: 4, lineHeight: 1.4 }}>
                {a.comment || 'Add note...'}
              </div>
            </div>
          ))}
        </div>

        {/* Canvas area */}
        <div
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'auto' }}
          onWheel={e => { if (!img) return; e.preventDefault(); setZoom(p => Math.min(Math.max(p * (e.deltaY < 0 ? 1.1 : 0.9), 0.1), 5)) }}
          onClick={() => setColorOpen(false)}
        >
          {!img ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>📎</div>
              <div style={{ color: dropHighlight ? UI_COLOR : '#555', fontSize: 14, transition: 'color 0.15s' }}>
                {dropHighlight ? 'Drop to open' : 'Drop an image or click Open'}
              </div>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ background: UI_COLOR, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer' }}>
                Open image
              </button>
            </div>
          ) : (
            <canvas ref={canvasRef} width={cw} height={ch}
              style={{ display: 'block', cursor: tool === 'text' ? 'text' : 'crosshair' }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} />
          )}

          {popup && (
            <CommentPopup
              pinId={popup.id} x={popup.sx} y={popup.sy}
              initialComment={annotations.find(a => a.id === popup.id)?.comment ?? ''}
              onSave={(id, comment) => { setAnnotations(prev => prev.map(a => a.id === id ? { ...a, comment } : a)); setPopup(null) }}
              onDelete={(id) => {
                setAnnotations(prev => prev.filter(a => a.id !== id).map((a, i) => ({ ...a, num: i + 1 })))
                seq.current = annotations.filter(a => a.id !== id).length + 1
                setPopup(null)
              }}
              onClose={() => setPopup(null)}
            />
          )}

          {activeText && (
            <input
              value={activeTextValue}
              onChange={e => setActiveTextValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitText() }
                if (e.key === 'Escape') { setActiveText(null); setActiveTextValue('') }
              }}
              onBlur={commitText}
              autoFocus
              style={{
                position: 'fixed',
                left: activeText.sx,
                top: activeText.sy - 14,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color,
                fontSize: 16 * effectiveScale,
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontWeight: 'bold',
                minWidth: 40,
                padding: 0,
                caretColor: color,
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ height: 56, flexShrink: 0, background: '#111', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
        {img ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ZoomBtn onClick={() => setZoom(p => Math.max(p * 0.9, 0.1))}>−</ZoomBtn>
            <span style={{ color: '#666', fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(effectiveScale * 100)}%</span>
            <ZoomBtn onClick={() => setZoom(p => Math.min(p * 1.1, 5))}>+</ZoomBtn>
            <ZoomBtn onClick={() => setZoom(1)} style={{ fontSize: 11, width: 'auto', padding: '4px 8px', marginLeft: 4 }}>Fit</ZoomBtn>
          </div>
        ) : <div />}
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={() => window.close()}>Cancel <Kbd>⌘W</Kbd></Btn>
          <Btn primary onClick={copyClose}>Copy & Close <Kbd primary>⌘↩</Kbd></Btn>
        </div>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconPin(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" fill="currentColor"/>
      <text x="10" y="10" textAnchor="middle" dominantBaseline="central" fill="#1a1a1a" fontSize="10" fontWeight="bold" fontFamily="-apple-system, sans-serif">1</text>
    </svg>
  )
}

function IconArrow(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 13L13 3M13 3H8M13 3V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconText(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 3h12M8 3v10M5 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Divider(): React.ReactElement {
  return <div style={{ width: 1, height: 16, background: '#333', marginLeft: 2, marginRight: 2 }} />
}

function ToolBtn({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title: string }): React.ReactElement {
  return (
    <button onClick={onClick} title={title} style={{ background: active ? '#3a3a3a' : 'transparent', color: active ? '#fff' : '#777', border: 'none', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {children}
    </button>
  )
}

function ZoomBtn({ children, onClick, style }: { children: React.ReactNode; onClick: () => void; style?: React.CSSProperties }): React.ReactElement {
  return (
    <button onClick={onClick} style={{ background: '#2a2a2a', color: '#aaa', border: 'none', borderRadius: 5, width: 28, height: 28, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', ...style }}>
      {children}
    </button>
  )
}

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button onClick={onClick} style={{ background: primary ? UI_COLOR : '#2a2a2a', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', fontFamily: 'inherit' }}>
      {children}
    </button>
  )
}

function Kbd({ children, primary }: { children: React.ReactNode; primary?: boolean }): React.ReactElement {
  return (
    <span style={{ background: primary ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)', borderRadius: 3, padding: '1px 5px', fontSize: 11, marginLeft: 4 }}>
      {children}
    </span>
  )
}
