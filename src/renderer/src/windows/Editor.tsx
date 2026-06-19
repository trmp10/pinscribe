import React, { useEffect, useRef, useState, useCallback } from 'react'
import { renderComposite, type Annotation, type Arrow, type TextItem } from '../components/renderComposite'
import CommentPopup from '../components/CommentPopup'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool = 'cursor' | 'box' | 'arrow' | 'double-arrow' | 'text'

// ─── Constants ────────────────────────────────────────────────────────────────

const PANEL_W = 260
const PIN_R = 14
const DRAG_THRESHOLD = 8
const UI_COLOR = '#e8334a'
const TEXT_MAX_W = 200

const COLORS = [
  { label: 'Red',    value: '#e8334a' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Amber',  value: '#f59e0b' },
  { label: 'Purple', value: '#a855f7' },
]

const UPDATE_ICONS: Record<string, React.ReactElement> = {
  checking:    <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#2a2a2a"/><circle cx="26" cy="26" r="9" stroke="#666" strokeWidth="2"/><path d="M26 20v6l4 3" stroke="#888" strokeWidth="2" strokeLinecap="round"/></svg>,
  uptodate:    <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#30d158"/><path d="M15 27l8 8 14-16" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  downloading: <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#2a2000"/><path d="M26 16v16M18 26l8 8 8-8" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  ready:       <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#14290a"/><path d="M26 35V21M18 29l8-8 8 8" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  installing:  <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#2a2000"/><circle cx="26" cy="26" r="9" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3"/></svg>,
  error:       <svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="13" fill="#2a0a0a"/><path d="M19 19l14 14M33 19L19 33" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/></svg>,
}

function relDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Editor(): React.ReactElement {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const seq          = useRef(1)
  const isDown       = useRef(false)

  // Text drag / editing refs
  const draggingTextId      = useRef<string | null>(null)
  const draggingTextOffset  = useRef({ x: 0, y: 0 })
  const draggingActiveText  = useRef(false)
  const draggingActiveOffset = useRef({ x: 0, y: 0 })
  const textCancelledRef    = useRef(false)
  const effectiveScaleRef   = useRef(1)
  const nextTextPos         = useRef<{ x: number; y: number } | null>(null)
  const nextEditingId       = useRef<string | null>(null)
  const nextEditingValue    = useRef('')
  const textWasDragged      = useRef(false)
  const undoStack           = useRef<{ annotations: Annotation[]; arrows: Arrow[]; texts: TextItem[] }[]>([])
  const redoStack           = useRef<{ annotations: Annotation[]; arrows: Arrow[]; texts: TextItem[] }[]>([])
  const movingAnnotation    = useRef<{ id: string; startMouse: {x:number;y:number}; startBox?: {x:number;y:number;w:number;h:number}; startPoint?: {x:number;y:number}; dragged: boolean } | null>(null)
  const resizingAnnotation  = useRef<{ id: string; handle: string; startMouse: {x:number;y:number}; startBox: {x:number;y:number;w:number;h:number} } | null>(null)
  const movingArrowRef      = useRef<{ id: string; startMouse: {x:number;y:number}; start: {x1:number;y1:number;x2:number;y2:number}; dragged: boolean } | null>(null)
  const sessionIdRef        = useRef('session-' + Date.now())
  const spaceHeldRef        = useRef(false)
  const isPanningRef        = useRef(false)
  const panStartRef         = useRef({ mouseX: 0, mouseY: 0, offsetX: 0, offsetY: 0 })
  const panOffsetRef        = useRef({ x: 0, y: 0 })
  const canvasWrapperRef    = useRef<HTMLDivElement>(null)
  const resizingArrowRef    = useRef<{ id: string; endpoint: 'start'|'end' } | null>(null)

  const [img, setImg]             = useState<HTMLImageElement | null>(null)
  const [imgSize, setImgSize]     = useState({ w: 0, h: 0 })
  const [scale, setScale]         = useState(1)
  const [zoom, setZoom]           = useState(1)
  const [tool, setTool]           = useState<Tool>('cursor')
  const [color, setColor]         = useState(COLORS[0].value)
  const [colorOpen, setColorOpen] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [arrows, setArrows]       = useState<Arrow[]>([])
  const [texts, setTexts]         = useState<TextItem[]>([])
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [draft, setDraft]         = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [popup, setPopup]         = useState<{ id: string; sx: number; sy: number } | null>(null)
  const [activeText, setActiveText] = useState<{ x: number; y: number } | null>(null)
  const [activeTextValue, setActiveTextValue] = useState('')
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [canUndo, setCanUndo]             = useState(false)
  const [canRedo, setCanRedo]             = useState(false)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null)
  const [arrowPopup, setArrowPopup]       = useState<{ id: string; sx: number; sy: number } | null>(null)
  const [arrowLabel, setArrowLabel]       = useState('')
  const [historyOpen, setHistoryOpen]     = useState(false)
  const [historyItems, setHistoryItems]   = useState<{ path: string; thumbnail: string; savedAt: string; sessionId: string }[]>([])
  const [helpOpen, setHelpOpen]           = useState(false)
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null)
  const [dragOverPinId, setDragOverPinId] = useState<string | null>(null)
  const [dropHighlight, setDropHighlight] = useState(false)
  const [updateState, setUpdateState]   = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error' | 'installing'>('idle')
  const [updatePct, setUpdatePct]       = useState(0)
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateError, setUpdateError]   = useState('')

  const effectiveScale = scale * zoom

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => { effectiveScaleRef.current = effectiveScale }, [effectiveScale])

  useEffect(() => {
    if (!canvasRef.current) return
    canvasRef.current.style.cursor = tool === 'text' ? 'text' : tool === 'cursor' ? 'default' : 'crosshair'
  }, [tool])

  useEffect(() => {
    const toolCursor = tool === 'text' ? 'text' : tool === 'cursor' ? 'default' : 'crosshair'
    const onDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return
      if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) return
      e.preventDefault()
      spaceHeldRef.current = true
      if (!isPanningRef.current && canvasRef.current) canvasRef.current.style.cursor = 'grab'
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      if (!isPanningRef.current && canvasRef.current) canvasRef.current.style.cursor = toolCursor
    }
    const onBlur = (): void => {
      spaceHeldRef.current = false
      isPanningRef.current = false
      if (canvasRef.current) canvasRef.current.style.cursor = toolCursor
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [tool])

  useEffect(() => { draw() }, [img, imgSize, scale, zoom, annotations, arrows, draft, color, selectedId, selectedArrowId])

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [activeTextValue, effectiveScale])

  // localStorage save (instant, for crash recovery)
  useEffect(() => {
    if (!img) return
    try {
      localStorage.setItem('pinscribe-session', JSON.stringify({ imgSrc: img.src, imgSize, annotations, arrows, texts, color }))
    } catch (_) {}
  }, [img, annotations, arrows, texts, color])

  // Debounced auto-save to IPC (for history thumbnails)
  useEffect(() => {
    if (!img) return
    const timer = setTimeout(async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.min(300 / canvas.width, 1)
      const tw = Math.round(canvas.width * ratio), th = Math.round(canvas.height * ratio)
      const tc = document.createElement('canvas')
      tc.width = tw; tc.height = th
      tc.getContext('2d')!.drawImage(canvas, 0, 0, tw, th)
      await window.api.autoSave({ version: 1, sessionId: sessionIdRef.current, thumbnail: tc.toDataURL('image/jpeg', 0.75), imageDataUrl: img.src, imgSize, annotations, arrows, texts, color, savedAt: new Date().toISOString() })
    }, 2000)
    return () => clearTimeout(timer)
  }, [img, annotations, arrows, texts, color])

  // Restore last session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pinscribe-session')
      if (!raw) return
      const s = JSON.parse(raw)
      if (s?.imgSrc) loadImage(s.imgSrc, s)
    } catch (_) {}
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') window.close()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') copyClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newSession() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); fileInputRef.current?.click() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !activeText) { e.preventDefault(); window.api.pasteImage().then(d => { if (d) loadImage(d) }) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && img && !activeText) { e.preventDefault(); window.api.copyToClipboard(renderComposite(img, imgSize, annotations, arrows, texts)) }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (img) window.api.savePng(renderComposite(img, imgSize, annotations, arrows, texts)) }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selectedId && !activeText) {
        e.preventDefault()
        saveToHistory()
        const src = annotations.find(a => a.id === selectedId)
        if (src) {
          const newId = `shape-${Date.now()}`
          const num = seq.current++
          const offset = 12
          const dupe: typeof src = src.box
            ? { ...src, id: newId, num, box: { ...src.box, x: src.box.x + offset, y: src.box.y + offset } }
            : { ...src, id: newId, num, point: { x: src.point!.x + offset, y: src.point!.y + offset } }
          setAnnotations(prev => [...prev, dupe])
          setSelectedId(newId)
        }
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !activeText) {
        if (selectedId) {
          saveToHistory()
          setAnnotations(prev => prev.filter(a => a.id !== selectedId).map((a, i) => ({ ...a, num: i + 1 })))
          seq.current = annotations.filter(a => a.id !== selectedId).length + 1
          setSelectedId(null)
        } else if (selectedArrowId) {
          saveToHistory()
          setArrows(prev => prev.filter(a => a.id !== selectedArrowId))
          setSelectedArrowId(null)
        }
      }
      if (e.key === 'Escape') {
        if (helpOpen) { setHelpOpen(false); return }
        if (historyOpen) { setHistoryOpen(false); return }
        setColorOpen(false)
        textCancelledRef.current = true
        setActiveText(null)
        setActiveTextValue('')
        setEditingTextId(null)
        setTool('cursor')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [img, imgSize, annotations, arrows, texts, selectedId, selectedArrowId, activeText, helpOpen, historyOpen])

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
    const onMove = (e: MouseEvent): void => {
      if (isPanningRef.current) {
        const nx = panStartRef.current.offsetX + (e.clientX - panStartRef.current.mouseX)
        const ny = panStartRef.current.offsetY + (e.clientY - panStartRef.current.mouseY)
        panOffsetRef.current = { x: nx, y: ny }
        if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = `translate(${nx}px, ${ny}px)`
        return
      }

      const es = effectiveScaleRef.current
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (e.clientX - rect.left) / es
      const cy = (e.clientY - rect.top) / es

      if (draggingTextId.current) {
        textWasDragged.current = true
        setTexts(prev => prev.map(t => t.id === draggingTextId.current
          ? { ...t, x: cx - draggingTextOffset.current.x, y: cy - draggingTextOffset.current.y } : t))
      }
      if (draggingActiveText.current) {
        setActiveText({ x: cx - draggingActiveOffset.current.x, y: cy - draggingActiveOffset.current.y })
      }
      if (resizingAnnotation.current) {
        const { id, handle, startMouse, startBox } = resizingAnnotation.current
        const dx = cx - startMouse.x, dy = cy - startMouse.y
        const MIN = 20 / es
        let { x, y, w, h } = startBox
        if (handle.includes('e')) w = Math.max(MIN, startBox.w + dx)
        if (handle.includes('s')) h = Math.max(MIN, startBox.h + dy)
        if (handle.includes('w')) { x = startBox.x + dx; w = Math.max(MIN, startBox.w - dx) }
        if (handle.includes('n')) { y = startBox.y + dy; h = Math.max(MIN, startBox.h - dy) }
        setAnnotations(prev => prev.map(a => a.id === id ? { ...a, box: { x, y, w, h } } : a))
      }
      if (movingAnnotation.current) {
        const { id, startMouse, startBox, startPoint } = movingAnnotation.current
        const dx = cx - startMouse.x, dy = cy - startMouse.y
        if (!movingAnnotation.current.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD / es) return
        movingAnnotation.current.dragged = true
        if (startBox) {
          setAnnotations(prev => prev.map(a => a.id === id ? { ...a, box: { ...startBox, x: startBox.x + dx, y: startBox.y + dy } } : a))
        } else if (startPoint) {
          setAnnotations(prev => prev.map(a => a.id === id ? { ...a, point: { x: startPoint.x + dx, y: startPoint.y + dy } } : a))
        }
      }
      if (movingArrowRef.current) {
        const { id, startMouse, start } = movingArrowRef.current
        const dx = cx - startMouse.x, dy = cy - startMouse.y
        if (!movingArrowRef.current.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD / es) return
        movingArrowRef.current.dragged = true
        setArrows(prev => prev.map(a => a.id === id ? { ...a, x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy } : a))
      }
      if (resizingArrowRef.current) {
        const { id, endpoint } = resizingArrowRef.current
        setArrows(prev => prev.map(a => a.id !== id ? a : endpoint === 'start' ? { ...a, x1: cx, y1: cy } : { ...a, x2: cx, y2: cy }))
      }
    }
    const onUp = (e: MouseEvent): void => {
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (canvasRef.current) canvasRef.current.style.cursor = spaceHeldRef.current ? 'grab' : 'default'
        return
      }
      if (movingAnnotation.current) {
        if (!movingAnnotation.current.dragged) {
          setPopup({ id: movingAnnotation.current.id, sx: e.clientX, sy: e.clientY })
        }
        movingAnnotation.current = null
      }
      resizingAnnotation.current = null
      movingArrowRef.current = null
      resizingArrowRef.current = null
      draggingTextId.current = null
      draggingActiveText.current = false
      if (canvasRef.current) canvasRef.current.style.cursor = tool === 'text' ? 'text' : tool === 'cursor' ? 'default' : 'crosshair'
      if (isDown.current) { isDown.current = false; setDraft(null) }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    window.api.onUpdateStatus(({ state, version, percent }) => {
      if (state === 'checking')    { setUpdateState('checking'); setUpdateVersion('') }
      if (state === 'downloading') { setUpdateState('downloading'); setUpdatePct(percent ?? 0); if (version) setUpdateVersion(version) }
      if (state === 'ready')       { setUpdateState('ready') }
      if (state === 'uptodate')    { setUpdateState('uptodate'); if (version) setUpdateVersion(version) }
      if (state === 'error')       { setUpdateState('error'); setUpdateError(version ?? '') }
    })
  }, [])

  // ─── Image loading ────────────────────────────────────────────────────────

  function readFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => loadImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  function loadImage(dataUrl: string, restore?: { annotations?: Annotation[]; arrows?: Arrow[]; texts?: TextItem[]; imgSize?: { w: number; h: number }; color?: string; sessionId?: string }): void {
    const el = new window.Image()
    el.onload = () => {
      const maxW = window.innerWidth - PANEL_W
      const maxH = window.innerHeight - 56 - 44
      const s = Math.min(maxW / el.width, maxH / el.height, 1)
      setAnnotations(restore?.annotations ?? [])
      setArrows(restore?.arrows ?? [])
      setTexts(restore?.texts ?? [])
      if (restore?.color) setColor(restore.color)
      setZoom(1)
      undoStack.current = []
      redoStack.current = []
      setCanUndo(false)
      setCanRedo(false)
      setSelectedId(null)
      setSelectedArrowId(null)
      panOffsetRef.current = { x: 0, y: 0 }
      if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = ''
      seq.current = (restore?.annotations?.length ?? 0) + 1
      sessionIdRef.current = restore?.sessionId ?? ('session-' + Date.now())
      setImg(el)
      setImgSize(restore?.imgSize ?? { w: el.width, h: el.height })
      setScale(s)
    }
    el.src = dataUrl
  }

  // ─── Undo / redo ─────────────────────────────────────────────────────────

  function saveToHistory(): void {
    undoStack.current.push({ annotations, arrows, texts })
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }

  function undo(): void {
    if (!undoStack.current.length) return
    redoStack.current.push({ annotations, arrows, texts })
    const s = undoStack.current.pop()!
    setAnnotations(s.annotations)
    setArrows(s.arrows)
    setTexts(s.texts)
    seq.current = s.annotations.length + 1
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }

  function redo(): void {
    if (!redoStack.current.length) return
    undoStack.current.push({ annotations, arrows, texts })
    const s = redoStack.current.pop()!
    setAnnotations(s.annotations)
    setArrows(s.arrows)
    setTexts(s.texts)
    seq.current = s.annotations.length + 1
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
  }

  // ─── Canvas drawing (no text — texts are DOM overlays) ───────────────────

  function draw(): void {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    const es = effectiveScale
    canvas.width  = imgSize.w * es
    canvas.height = imgSize.h * es
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    arrows.forEach(a => {
      const sel = a.id === selectedArrowId
      ctx.strokeStyle = a.color
      ctx.lineWidth = 2
      if (sel) { ctx.shadowColor = a.color; ctx.shadowBlur = 6 }
      drawArrowShape(ctx, a.x1 * es, a.y1 * es, a.x2 * es, a.y2 * es, a.bidirectional)
      ctx.shadowBlur = 0
      if (sel) {
        [[a.x1 * es, a.y1 * es], [a.x2 * es, a.y2 * es]].forEach(([hx, hy]) => {
          ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#1a1a1a'; ctx.fill()
          ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.stroke()
        })
      }
      if (a.label) {
        const lx = (a.x1 + a.x2) / 2 * es
        const ly = (a.y1 + a.y2) / 2 * es
        ctx.font = '12px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const tw = ctx.measureText(a.label).width
        const pw = tw + 12, ph = 18, pr = 5
        ctx.fillStyle = a.color
        ctx.beginPath(); ctx.roundRect(lx - pw / 2, ly - ph / 2, pw, ph, pr); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.fillText(a.label, lx, ly)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
    })

    annotations.forEach(a => {
      const sel = a.id === selectedId
      ctx.strokeStyle = a.color
      ctx.lineWidth = sel ? 2.5 : 2
      if (sel && a.box) { ctx.shadowColor = a.color; ctx.shadowBlur = 8 }
      if (a.box) ctx.strokeRect(a.box.x * es, a.box.y * es, a.box.w * es, a.box.h * es)
      ctx.shadowBlur = 0
      const px = a.box ? a.box.x * es : a.point!.x * es
      const py = a.box ? a.box.y * es : a.point!.y * es
      drawPin(ctx, px, py, a.num, a.color)
    })

    if (draft) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      if (tool === 'box') {
        ctx.setLineDash([6, 3])
        ctx.strokeRect(draft.x1 * es, draft.y1 * es, (draft.x2 - draft.x1) * es, (draft.y2 - draft.y1) * es)
        ctx.setLineDash([])
      } else if (tool === 'arrow' || tool === 'double-arrow') {
        drawArrowShape(ctx, draft.x1 * es, draft.y1 * es, draft.x2 * es, draft.y2 * es, tool === 'double-arrow')
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

  function drawArrowShape(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, bidirectional?: boolean): void {
    const headLen = 14
    const angle = Math.atan2(y2 - y1, x2 - x1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
    if (bidirectional) {
      const ra = Math.atan2(y1 - y2, x1 - x2)
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - headLen * Math.cos(ra - Math.PI / 6), y1 - headLen * Math.sin(ra - Math.PI / 6))
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - headLen * Math.cos(ra + Math.PI / 6), y1 - headLen * Math.sin(ra + Math.PI / 6))
    }
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

  function pinHitTight(x: number, y: number): Annotation | undefined {
    return annotations.find(a => {
      const px = a.box ? a.box.x : a.point!.x
      const py = a.box ? a.box.y : a.point!.y
      return Math.hypot(px - x, py - y) <= PIN_R * 0.65 / effectiveScale
    })
  }

  const HANDLE_CURSORS: Record<string, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    w: 'w-resize', e: 'e-resize',
    sw: 'sw-resize', s: 's-resize', se: 'se-resize',
  }

  function boxBorderAt(x: number, y: number): { id: string; handle: string } | null {
    const EDGE_R = 7 / effectiveScale
    const CORNER_R = 12 / effectiveScale
    for (const a of annotations) {
      if (!a.box) continue
      const { x: bx, y: by, w: bw, h: bh } = a.box
      if (Math.hypot(x - (bx + bw), y - (by + bh)) <= CORNER_R) return { id: a.id, handle: 'se' }
      if (Math.abs(y - by)        <= EDGE_R && x >= bx && x <= bx + bw) return { id: a.id, handle: 'n' }
      if (Math.abs(y - (by + bh)) <= EDGE_R && x >= bx && x <= bx + bw) return { id: a.id, handle: 's' }
      if (Math.abs(x - bx)        <= EDGE_R && y >= by && y <= by + bh) return { id: a.id, handle: 'w' }
      if (Math.abs(x - (bx + bw)) <= EDGE_R && y >= by && y <= by + bh) return { id: a.id, handle: 'e' }
    }
    return null
  }

  function setCursor(c: string): void {
    if (canvasRef.current) canvasRef.current.style.cursor = c
  }

  function commitText(): void {
    if (!activeText) return
    if (textCancelledRef.current) { textCancelledRef.current = false; return }
    const val = activeTextValue.trim()
    if (val) {
      saveToHistory()
      if (editingTextId) {
        setTexts(prev => [...prev.filter(t => t.id !== editingTextId), { id: editingTextId, x: activeText.x, y: activeText.y, text: val, color }])
      } else {
        setTexts(prev => [...prev, { id: `text-${Date.now()}`, x: activeText.x, y: activeText.y, text: val, color }])
      }
    }
    // Chain to next text placement if queued from a simultaneous mousedown
    const next  = nextTextPos.current
    const nId   = nextEditingId.current
    const nVal  = nextEditingValue.current
    nextTextPos.current      = null
    nextEditingId.current    = null
    nextEditingValue.current = ''
    setActiveText(next)
    setActiveTextValue(nVal)
    setEditingTextId(nId)
  }

  function newSession(): void {
    setImg(null)
    setImgSize({ w: 0, h: 0 })
    setScale(1)
    setZoom(1)
    setAnnotations([])
    setArrows([])
    setTexts([])
    setSelectedId(null)
    setSelectedArrowId(null)
    setPopup(null)
    setArrowPopup(null)
    setActiveText(null)
    setActiveTextValue('')
    setDraft(null)
    seq.current = 1
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
    panOffsetRef.current = { x: 0, y: 0 }
    if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = ''
    sessionIdRef.current = 'session-' + Date.now()
    try { localStorage.removeItem('pinscribe-session') } catch (_) {}
  }

  async function showHistory(): Promise<void> {
    const items = await window.api.getAutosaves() as { path: string; thumbnail: string; savedAt: string; sessionId: string }[]
    setHistoryItems(items ?? [])
    setHistoryOpen(true)
  }

  async function loadSessionFromHistory(path: string): Promise<void> {
    const data = await window.api.openAutosave(path) as any
    if (!data?.imageDataUrl) return
    setHistoryOpen(false)
    loadImage(data.imageDataUrl, data)
  }

  function saveArrowLabel(): void {
    if (!arrowPopup) return
    saveToHistory()
    setArrows(prev => prev.map(a => a.id === arrowPopup.id ? { ...a, label: arrowLabel.trim() || undefined } : a))
    setArrowPopup(null)
    setArrowLabel('')
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = canvasPos(e)
    const hit = arrowAt(pos.x, pos.y)
    if (hit) {
      setArrowPopup({ id: hit.id, sx: e.clientX, sy: e.clientY })
      setArrowLabel(hit.label ?? '')
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (popup) return
    setColorOpen(false)

    if (spaceHeldRef.current) {
      isPanningRef.current = true
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offsetX: panOffsetRef.current.x, offsetY: panOffsetRef.current.y }
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      return
    }

    const pos = canvasPos(e)

    if (tool === 'cursor') {
      // Arrow endpoint resize (when arrow already selected)
      if (selectedArrowId) {
        const selArr = arrows.find(a => a.id === selectedArrowId)
        if (selArr) {
          const HRAD = 10 / effectiveScale
          if (Math.hypot(pos.x - selArr.x1, pos.y - selArr.y1) <= HRAD) {
            saveToHistory(); resizingArrowRef.current = { id: selectedArrowId, endpoint: 'start' }; return
          }
          if (Math.hypot(pos.x - selArr.x2, pos.y - selArr.y2) <= HRAD) {
            saveToHistory(); resizingArrowRef.current = { id: selectedArrowId, endpoint: 'end' }; return
          }
        }
      }
      // Tight pin hit → move annotation
      const pinHit = pinHitTight(pos.x, pos.y)
      if (pinHit) {
        saveToHistory()
        setSelectedId(pinHit.id); setSelectedArrowId(null)
        movingAnnotation.current = { id: pinHit.id, startMouse: pos, startBox: pinHit.box ? { ...pinHit.box } : undefined, startPoint: pinHit.point ? { ...pinHit.point } : undefined, dragged: false }
        setCursor('grabbing'); return
      }
      // Box border → resize
      const borderHit = boxBorderAt(pos.x, pos.y)
      if (borderHit) {
        const ann = annotations.find(a => a.id === borderHit.id)!
        saveToHistory()
        setSelectedId(borderHit.id); setSelectedArrowId(null)
        resizingAnnotation.current = { id: borderHit.id, handle: borderHit.handle, startMouse: pos, startBox: { ...ann.box! } }
        return
      }
      // Arrow body → move arrow
      const arrowHit = arrowAt(pos.x, pos.y)
      if (arrowHit) {
        saveToHistory()
        setSelectedArrowId(arrowHit.id); setSelectedId(null)
        movingArrowRef.current = { id: arrowHit.id, startMouse: pos, start: { x1: arrowHit.x1, y1: arrowHit.y1, x2: arrowHit.x2, y2: arrowHit.y2 }, dragged: false }
        setCursor('grabbing'); return
      }
      // Deselect
      setSelectedId(null); setSelectedArrowId(null); return
    }

    if (tool === 'text') {
      if (activeText) {
        // Another text is open — queue this position; blur will commit current then open next
        nextTextPos.current      = pos
        nextEditingId.current    = null
        nextEditingValue.current = ''
      } else {
        setActiveText({ x: pos.x, y: pos.y })
        setActiveTextValue('')
        setEditingTextId(null)
      }
      return
    }
    isDown.current = true
    setDragStart(pos)
    setDraft({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (tool === 'cursor' && !movingAnnotation.current && !resizingAnnotation.current && !movingArrowRef.current && !resizingArrowRef.current) {
      const pos = canvasPos(e)
      const border = boxBorderAt(pos.x, pos.y)
      const pinH = annotationAt(pos.x, pos.y)
      const arrowH = arrowAt(pos.x, pos.y)
      if (border) setCursor(HANDLE_CURSORS[border.handle])
      else if (pinH || arrowH) setCursor('pointer')
      else setCursor('default')
    }
    if (!isDown.current) return
    const pos = canvasPos(e)
    if ((tool === 'arrow' || tool === 'double-arrow') && e.shiftKey) {
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
      if (arrowHit) { saveToHistory(); setArrows(prev => prev.filter(a => a.id !== arrowHit.id)); return }
      if (tool === 'box') {
        saveToHistory()
        const num = seq.current++
        const id = `shape-${Date.now()}`
        setAnnotations(prev => [...prev, { id, num, comment: '', color, point: { x: draft.x1, y: draft.y1 } }])
        setPopup({ id, sx: e.clientX, sy: e.clientY })
      }
      return
    }

    const id = `shape-${Date.now()}`

    if (tool === 'arrow' || tool === 'double-arrow') {
      saveToHistory()
      setArrows(prev => [...prev, { id, x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2, color, bidirectional: tool === 'double-arrow' }])
    } else {
      saveToHistory()
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

      {/* Title bar */}
      <div style={{ height: 44, flexShrink: 0, borderBottom: '1px solid #2a2a2a', position: 'relative', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 4,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}>
          <ToolBtn active={tool === 'cursor'} onClick={() => setTool('cursor')} title="Select (Esc)">
            <IconCursor />
          </ToolBtn>

          <Divider />

          <ToolBtn active={tool === 'box'} onClick={() => setTool('box')} title="Annotation box">
            <IconPin />
          </ToolBtn>
          <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow (hold Shift to lock straight)">
            <IconArrow />
          </ToolBtn>
          <ToolBtn active={tool === 'double-arrow'} onClick={() => setTool('double-arrow')} title="Double arrow (hold Shift to lock straight)">
            <IconDoubleArrow />
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
        {/* History + Help buttons — top right */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 16, display: 'flex', alignItems: 'center', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ToolBtn active={false} onClick={showHistory} title="History">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </ToolBtn>
          <ToolBtn active={false} onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            <span style={{ fontSize: 13, fontWeight: 600 }}>?</span>
          </ToolBtn>
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Notes panel */}
        <div style={{ width: PANEL_W, flexShrink: 0, borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: 4, overflowY: 'auto' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Notes</div>
          {annotations.length === 0 && (
            <div style={{ color: '#444', fontSize: 13 }}>Annotations will appear here</div>
          )}
          {annotations.map(a => (
            <div
              key={a.id}
              onDragOver={e => { e.preventDefault(); setDragOverPinId(a.id) }}
              onDragLeave={() => setDragOverPinId(null)}
              onDrop={() => {
                if (!draggingPinId || draggingPinId === a.id) return
                saveToHistory()
                setAnnotations(prev => {
                  const from = prev.findIndex(x => x.id === draggingPinId)
                  const to   = prev.findIndex(x => x.id === a.id)
                  const next = [...prev]
                  const [moved] = next.splice(from, 1)
                  next.splice(to, 0, moved)
                  return next.map((x, i) => ({ ...x, num: i + 1 }))
                })
                seq.current = annotations.length + 1
                setDraggingPinId(null)
                setDragOverPinId(null)
              }}
              onClick={() => setPopup({ id: a.id, sx: PANEL_W + 20, sy: 120 })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                cursor: 'pointer',
                opacity: draggingPinId === a.id ? 0.4 : 1,
                borderTop: dragOverPinId === a.id && draggingPinId !== a.id ? `2px solid ${UI_COLOR}` : '2px solid transparent',
                transition: 'opacity 0.1s',
              }}
            >
              <div
                draggable
                onDragStart={e => { e.stopPropagation(); setDraggingPinId(a.id) }}
                onDragEnd={() => { setDraggingPinId(null); setDragOverPinId(null) }}
                onClick={e => e.stopPropagation()}
                style={{ color: '#444', cursor: 'grab', fontSize: 14, flexShrink: 0, userSelect: 'none', paddingRight: 2 }}
              >
                ⠿
              </div>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: a.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1, paddingTop: 2 }}>
                {a.num}
              </div>
              <div style={{ color: a.comment ? '#ddd' : '#555', fontSize: 13, lineHeight: 1.4 }}>
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
            /* Canvas wrapper — text overlays and active input are positioned relative to this */
            <div ref={canvasWrapperRef} style={{ position: 'relative', width: cw, height: ch, flexShrink: 0 }}>
              <canvas ref={canvasRef} width={cw} height={ch}
                style={{ display: 'block' }}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onDoubleClick={onDoubleClick} />

              {/* Placed text overlays */}
              {texts.map(t => (
                <div
                  key={t.id}
                  style={{
                    position: 'absolute',
                    left: t.x * effectiveScale,
                    top: t.y * effectiveScale,
                    color: t.color,
                    fontSize: 16 * effectiveScale,
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    fontWeight: 'bold',
                    maxWidth: TEXT_MAX_W * effectiveScale,
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                    cursor: 'move',
                    userSelect: 'none',
                    textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    padding: '2px 4px',
                    outline: `1.5px dashed ${t.color}`,
                    outlineOffset: 3,
                  }}
                  onMouseDown={e => {
                    e.stopPropagation()
                    textWasDragged.current = false
                    const rect = canvasRef.current!.getBoundingClientRect()
                    const es = effectiveScaleRef.current
                    draggingTextId.current = t.id
                    draggingTextOffset.current = {
                      x: (e.clientX - rect.left) / es - t.x,
                      y: (e.clientY - rect.top) / es - t.y,
                    }
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    if (textWasDragged.current) return
                    setTexts(prev => prev.filter(tx => tx.id !== t.id))
                    if (activeText) {
                      nextTextPos.current      = { x: t.x, y: t.y }
                      nextEditingId.current    = t.id
                      nextEditingValue.current = t.text
                    } else {
                      setActiveText({ x: t.x, y: t.y })
                      setActiveTextValue(t.text)
                      setEditingTextId(t.id)
                      setTool('text')
                    }
                  }}
                >
                  {t.text}
                </div>
              ))}

              {/* Active text input */}
              {activeText && (
                <div
                  style={{
                    position: 'absolute',
                    left: activeText.x * effectiveScale,
                    top: activeText.y * effectiveScale,
                    border: '1.5px dashed rgba(255,255,255,0.4)',
                    borderRadius: 4,
                    background: 'rgba(0,0,0,0.25)',
                    zIndex: 10,
                    minWidth: 80,
                  }}
                >
                  {/* Drag handle */}
                  <div
                    style={{
                      padding: '3px 8px',
                      cursor: 'grab',
                      display: 'flex',
                      justifyContent: 'center',
                      borderBottom: '1px dashed rgba(255,255,255,0.2)',
                    }}
                    onMouseDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      const rect = canvasRef.current!.getBoundingClientRect()
                      const es = effectiveScaleRef.current
                      draggingActiveText.current = true
                      draggingActiveOffset.current = {
                        x: (e.clientX - rect.left) / es - activeText.x,
                        y: (e.clientY - rect.top) / es - activeText.y,
                      }
                    }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, letterSpacing: 3 }}>• • •</span>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={activeTextValue}
                    onChange={e => setActiveTextValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() }
                      if (e.key === 'Escape') {
                        textCancelledRef.current = true
                        setActiveText(null)
                        setActiveTextValue('')
                        setEditingTextId(null)
                        setTool('cursor')
                      }
                    }}
                    onBlur={commitText}
                    autoFocus
                    style={{
                      display: 'block',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color,
                      fontSize: 16 * effectiveScale,
                      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                      fontWeight: 'bold',
                      width: TEXT_MAX_W * effectiveScale,
                      minHeight: 24 * effectiveScale,
                      height: 'auto',
                      padding: '4px 6px',
                      caretColor: color,
                      textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      resize: 'none',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {arrowPopup && (
            <div style={{ position: 'fixed', left: arrowPopup.sx, top: arrowPopup.sy, width: 240, background: '#222', border: '1px solid #444', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000, padding: 12 }}>
              <input
                value={arrowLabel}
                onChange={e => setArrowLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveArrowLabel(); if (e.key === 'Escape') { setArrowPopup(null); setArrowLabel('') } }}
                autoFocus
                placeholder="Arrow label..."
                style={{ width: '100%', background: '#111', border: '1.5px solid #555', borderRadius: 6, color: '#fff', fontSize: 13, padding: '7px 8px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button onClick={() => { setArrowPopup(null); setArrowLabel('') }} style={{ background: '#333', border: 'none', color: '#ccc', fontSize: 13, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={saveArrowLabel} style={{ background: UI_COLOR, border: 'none', color: '#fff', fontSize: 13, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
              </div>
            </div>
          )}

          {popup && (
            <CommentPopup
              pinId={popup.id} x={popup.sx} y={popup.sy}
              initialComment={annotations.find(a => a.id === popup.id)?.comment ?? ''}
              onSave={(id, comment) => { saveToHistory(); setAnnotations(prev => prev.map(a => a.id === id ? { ...a, comment } : a)); setPopup(null) }}
              onDelete={(id) => {
                saveToHistory()
                setAnnotations(prev => prev.filter(a => a.id !== id).map((a, i) => ({ ...a, num: i + 1 })))
                seq.current = annotations.filter(a => a.id !== id).length + 1
                setPopup(null)
              }}
              onClose={() => setPopup(null)}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ height: 56, flexShrink: 0, background: '#111', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px', position: 'relative' }}>
        {/* Left: zoom + undo/redo */}
        <div style={{ position: 'absolute', left: 20, display: 'flex', alignItems: 'center', gap: 8, visibility: img ? 'visible' : 'hidden' }}>
          <ZoomBtn onClick={() => setZoom(p => Math.max(p * 0.9, 0.1))}>−</ZoomBtn>
          <span style={{ color: '#666', fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(effectiveScale * 100)}%</span>
          <ZoomBtn onClick={() => setZoom(p => Math.min(p * 1.1, 5))}>+</ZoomBtn>
          <ZoomBtn onClick={() => { setZoom(1); panOffsetRef.current = { x: 0, y: 0 }; if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = '' }} style={{ fontSize: 11, width: 'auto', padding: '4px 8px', marginLeft: 4 }}>Fit</ZoomBtn>
          <div style={{ width: 1, height: 16, background: '#333', margin: '0 4px' }} />
          <ZoomBtn onClick={undo} style={{ opacity: canUndo ? 1 : 0.3 }} title="Undo ⌘Z">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5H8.5C10.4 5 12 6.6 12 8.5S10.4 12 8.5 12H4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M4.5 2.5L2 5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </ZoomBtn>
          <ZoomBtn onClick={redo} style={{ opacity: canRedo ? 1 : 0.3 }} title="Redo ⌘⇧Z">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 5H5.5C3.6 5 2 6.6 2 8.5S3.6 12 5.5 12H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M9.5 2.5L12 5l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </ZoomBtn>
        </div>
        {/* Center: Save PNG + Copy */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={() => img && window.api.savePng(renderComposite(img, imgSize, annotations, arrows, texts))}>Save PNG <Kbd>⌘S</Kbd></Btn>
          <Btn primary onClick={() => img && window.api.copyToClipboard(renderComposite(img, imgSize, annotations, arrows, texts))}>Copy <Kbd primary>⌘C</Kbd></Btn>
        </div>
        {/* Right: New */}
        <div style={{ position: 'absolute', right: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Btn onClick={newSession}>New <Kbd>⌘N</Kbd></Btn>
        </div>
      </div>

      {/* Update modal */}
      {updateState !== 'idle' && (() => {
        const titles: Record<string, string> = { checking: 'Checking for updates…', uptodate: 'Up to date', downloading: 'Downloading update…', ready: 'Update ready', installing: 'Installing update…', error: 'Update failed' }
        const subs: Record<string, string> = { uptodate: `You are on the latest version${updateVersion ? ` (v${updateVersion})` : ''}.`, downloading: updatePct > 0 ? `${updatePct}%` : '', ready: updateVersion ? `v${updateVersion} is ready to install.` : 'Ready to install.', installing: 'The app will restart shortly.', error: updateError }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 18, padding: '28px 24px 20px', width: 268, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
              <div style={{ marginBottom: 4 }}>{UPDATE_ICONS[updateState] ?? UPDATE_ICONS.checking}</div>
              <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, textAlign: 'center' }}>{titles[updateState] ?? ''}</div>
              <div style={{ color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 1.45, minHeight: 18 }}>{subs[updateState] ?? ''}</div>
              {(updateState === 'downloading' || updateState === 'installing') && (
                <div style={{ width: '100%', height: 4, background: '#333', borderRadius: 2, overflow: 'hidden', margin: '6px 0 2px' }}>
                  <div style={{ height: '100%', background: '#f59e0b', borderRadius: 2, transition: 'width 0.3s', width: updateState === 'installing' ? '100%' : `${updatePct}%` }} />
                </div>
              )}
              {updateState === 'ready' && (
                <button onClick={() => { setUpdateState('installing'); window.api.restartForUpdate() }}
                  style={{ width: '100%', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 9, padding: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}>
                  Restart to Update
                </button>
              )}
              {updateState !== 'installing' && (
                <button onClick={() => setUpdateState('idle')}
                  style={{ width: '100%', background: '#2a2a2a', color: '#ccc', border: 'none', borderRadius: 9, padding: 10, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', marginTop: updateState === 'ready' ? 6 : 8 }}>
                  Close
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Help modal */}
      {helpOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setHelpOpen(false)}>
          <div style={{ background: '#1e1e1e', border: '1px solid #444', borderRadius: 12, padding: '24px 28px', minWidth: 320, maxWidth: 400 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#fff', fontSize: 15, marginBottom: 16, fontWeight: 600 }}>Keyboard shortcuts</h3>
            {([
              ['Copy composite', '⌘C'], ['Save PNG', '⌘S'], ['New session', '⌘N'],
              ['Open image', '⌘O'], ['Paste image', '⌘V'], ['Undo', '⌘Z'],
              ['Redo', '⌘⇧Z'], ['Duplicate annotation', '⌘D'], ['Delete selected', '⌫'],
              ['Straight arrow', 'Shift+drag'], ['Pan canvas', 'Space+drag'],
              ['Label arrow', 'double-click'], ['Select/cursor', 'Esc'],
            ] as [string, string][]).map(([label, kbd]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #2a2a2a' }}>
                <span style={{ color: '#aaa', fontSize: 13 }}>{label}</span>
                <span style={{ color: '#fff', fontSize: 12, background: '#333', borderRadius: 4, padding: '2px 7px' }}>{kbd}</span>
              </div>
            ))}
            <button onClick={() => setHelpOpen(false)} style={{ marginTop: 16, width: '100%', background: '#333', border: 'none', color: '#ccc', borderRadius: 7, padding: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setHistoryOpen(false)}>
          <div style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 14, padding: '24px 28px', minWidth: 400, maxWidth: 860, width: '90vw', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>History</span>
              <button onClick={() => setHistoryOpen(false)} style={{ background: 'none', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}>✕</button>
            </div>
            {historyItems.length === 0 ? (
              <div style={{ color: '#555', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No history yet</div>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {historyItems.map(item => (
                  <div key={item.sessionId}
                    onClick={() => loadSessionFromHistory(item.path)}
                    style={{ cursor: 'pointer', borderRadius: 9, border: '2px solid transparent', overflow: 'hidden', background: '#111', width: 148, flexShrink: 0, transition: 'border-color 0.15s, transform 0.1s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = UI_COLOR; (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.02)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLDivElement).style.transform = '' }}>
                    <img src={item.thumbnail} alt="" style={{ width: 148, height: 98, objectFit: 'cover', display: 'block' }} />
                    <div style={{ color: '#666', fontSize: 11, padding: '6px 8px' }}>{relDate(item.savedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconCursor(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.5 1.5v10l2.8-2.8 2 4 1.4-.7-2-4H10z" fill="currentColor"/>
    </svg>
  )
}

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

function IconDoubleArrow(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8h12M2 8l3-2.5M2 8l3 2.5M14 8l-3-2.5M14 8l-3 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
