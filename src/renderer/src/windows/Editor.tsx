import React, { useEffect, useRef, useState } from 'react'
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
  checking:    <div style={{ fontSize: 40, lineHeight: 1 }}>⏳</div>,
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
  const colorBtnRef  = useRef<HTMLButtonElement>(null)
  const seq          = useRef(1)
  const isDown       = useRef(false)

  // Text drag / editing refs
  const draggingTextId      = useRef<string | null>(null)
  const draggingTextOffset  = useRef({ x: 0, y: 0 })
  const draggingActiveText  = useRef(false)
  const draggingActiveOffset = useRef({ x: 0, y: 0 })
  const textCancelledRef    = useRef(false)
  const effectiveScaleRef   = useRef(1)
  const toolRef             = useRef<Tool>('cursor')
  const nextTextPos         = useRef<{ x: number; y: number; width?: number } | null>(null)
  const nextEditingId       = useRef<string | null>(null)
  const nextEditingValue    = useRef('')
  const textWasDragged      = useRef(false)
  const resizingTextId      = useRef<string | null>(null)
  const resizingTextHandle  = useRef<'nw'|'w'|'sw'|'se'>('se')
  const resizingTextStart   = useRef({ mouseX: 0, mouseY: 0, origX: 0, origY: 0, origWidth: 0, origFontSize: 16 })
  const textOverlayRefs     = useRef<Map<string, HTMLDivElement>>(new Map())
  const undoStack           = useRef<{ annotations: Annotation[]; arrows: Arrow[]; texts: TextItem[] }[]>([])
  const redoStack           = useRef<{ annotations: Annotation[]; arrows: Arrow[]; texts: TextItem[] }[]>([])
  const movingAnnotation    = useRef<{ id: string; startMouse: {x:number;y:number}; startBox?: {x:number;y:number;w:number;h:number}; startPoint?: {x:number;y:number}; dragged: boolean } | null>(null)
  const resizingAnnotation  = useRef<{ id: string; handle: string; startMouse: {x:number;y:number}; startBox: {x:number;y:number;w:number;h:number} } | null>(null)
  const movingArrowRef      = useRef<{ id: string; startMouse: {x:number;y:number}; start: {x1:number;y1:number;x2:number;y2:number}; dragged: boolean } | null>(null)
  const sessionIdRef          = useRef('session-' + Date.now())
  const canvasInteractedRef   = useRef(false)  // true when canvas mousedown handled something meaningful
  const spaceHeldRef          = useRef(false)
  const selectedIdsRef        = useRef<string[]>([])
  const selectedArrowIdsRef   = useRef<string[]>([])
  const multiStartRef         = useRef<Annotation[]>([])
  const multiArrowStartRef    = useRef<{ id: string; x1: number; y1: number; x2: number; y2: number }[]>([])
  const multiTextStartRef     = useRef<TextItem[]>([])
  const isPanningRef        = useRef(false)
  const panStartRef         = useRef({ mouseX: 0, mouseY: 0, offsetX: 0, offsetY: 0 })
  const panOffsetRef        = useRef({ x: 0, y: 0 })
  const canvasWrapperRef    = useRef<HTMLDivElement>(null)
  const canvasAreaRef       = useRef<HTMLDivElement>(null)
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
  const [activeText, setActiveText] = useState<{ x: number; y: number; width?: number } | null>(null)
  const [activeTextValue, setActiveTextValue] = useState('')
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [canUndo, setCanUndo]             = useState(false)
  const [canRedo, setCanRedo]             = useState(false)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds]     = useState<string[]>([])
  const [selectedArrowIds, setSelectedArrowIds] = useState<string[]>([])
  const [hoveredArrowId, setHoveredArrowId] = useState<string | null>(null)
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [selectedTextIds, setSelectedTextIds] = useState<string[]>([])
  const [arrowPopup, setArrowPopup]       = useState<{ id: string; sx: number; sy: number } | null>(null)
  const [arrowLabel, setArrowLabel]       = useState('')
  const [historyOpen, setHistoryOpen]     = useState(false)
  const [historyItems, setHistoryItems]   = useState<{ path: string; thumbnail: string; savedAt: string; sessionId: string }[]>([])
  const [helpOpen, setHelpOpen]           = useState(false)
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null)
  const [dragOverPinId, setDragOverPinId] = useState<string | null>(null)
  const [dropHighlight, setDropHighlight] = useState(false)
  const [marquee, setMarquee]             = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [copied, setCopied]             = useState(false)
  const [updateState, setUpdateState]   = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error' | 'installing'>('idle')
  const [updatePct, setUpdatePct]       = useState(0)
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateError, setUpdateError]   = useState('')

  const effectiveScale = scale * zoom

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => { effectiveScaleRef.current = effectiveScale }, [effectiveScale])
  useEffect(() => { toolRef.current = tool }, [tool])

  // Stable refs for keydown handler — avoids re-subscription on every state change
  const selectedIdRef         = useRef<string | null>(null)
  const selectedArrowIdRef2   = useRef<string | null>(null)
  const selectedTextIdRef     = useRef<string | null>(null)
  const activeTextRef         = useRef<{ x: number; y: number; width?: number } | null>(null)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { selectedArrowIdRef2.current = selectedArrowId }, [selectedArrowId])
  useEffect(() => { selectedTextIdRef.current = selectedTextId }, [selectedTextId])
  const selectedTextIdsRef     = useRef<string[]>([])
  useEffect(() => { selectedTextIdsRef.current = selectedTextIds }, [selectedTextIds])
  useEffect(() => { activeTextRef.current = activeText }, [activeText])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  useEffect(() => { selectedArrowIdsRef.current = selectedArrowIds }, [selectedArrowIds])

  useEffect(() => {
    if (!canvasRef.current) return
    canvasRef.current.style.cursor = tool === 'text' ? 'text' : tool === 'cursor' ? 'default' : 'crosshair'
  }, [tool])

  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      e.preventDefault()
      setPopup(null); setArrowPopup(null); setArrowLabel(''); setColorOpen(false)
      textCancelledRef.current = true
      setActiveText(null); setActiveTextValue(''); setEditingTextId(null)
      setTool('cursor')
    }
    window.addEventListener('contextmenu', onCtx)
    return () => window.removeEventListener('contextmenu', onCtx)
  }, [])

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

  useEffect(() => { draw() }, [img, imgSize, scale, zoom, annotations, arrows, draft, color, tool, selectedId, selectedArrowId, selectedIds, selectedArrowIds, hoveredArrowId, marquee])

  // atIsArea must be declared here (before the useEffect that uses it to avoid TDZ)
  const atIsAreaEarly = !!(activeText?.width)

  // Cursor at end when editing opens
  useEffect(() => {
    if (!activeText) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  }, [!!activeText]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (!atIsAreaEarly) { el.style.width = 'auto'; el.style.width = el.scrollWidth + 'px' }
  }, [activeTextValue, effectiveScale, atIsAreaEarly])

  // localStorage save (instant, for crash recovery)
  useEffect(() => {
    if (!img) return
    try {
      localStorage.setItem('pinscribe-session', JSON.stringify({ imgSrc: img.src, imgSize, annotations, arrows, texts, color }))
    } catch (_) {}
  }, [img, imgSize, annotations, arrows, texts, color])

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
  }, [img, imgSize, annotations, arrows, texts, color])

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
      const inputFocused = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') { e.preventDefault(); window.api.hideWindow() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newSession() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); fileInputRef.current?.click() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !activeText && !inputFocused) {
        e.preventDefault(); window.api.pasteImage().then(d => { if (d) loadImage(d) })
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && img && !inputFocused) { e.preventDefault(); doCopy() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !inputFocused) { e.preventDefault(); setSelectedIds(annotations.map(a => a.id)); setSelectedArrowIds(arrows.map(a => a.id)); setSelectedTextIds(texts.map(t => t.id)); setSelectedId(annotations[0]?.id ?? null); setSelectedArrowId(arrows[0]?.id ?? null); setSelectedTextId(texts[0]?.id ?? null) }
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && !inputFocused) { e.preventDefault(); if (img) window.api.savePng(renderComposite(img, imgSize, annotations, arrows, texts)) }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); if (img) setZoom(p => Math.min(p * 1.1, 5)) }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); if (img) setZoom(p => Math.max(p * 0.9, 0.1)) }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); if (img) { setZoom(1); panOffsetRef.current = { x: 0, y: 0 }; if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = '' } }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !inputFocused) {
        const hasSelection = selectedId || selectedArrowId || selectedTextId || selectedIds.length || selectedArrowIds.length || selectedTextIds.length
        if (hasSelection) {
          e.preventDefault()
          saveToHistory()
          const off = 20 / effectiveScale
          const ts = Date.now()
          // Duplicate annotations
          const annIds = [...new Set([...(selectedId ? [selectedId] : []), ...selectedIds])]
          const newAnns: Annotation[] = annIds.map(id => {
            const src = annotations.find(a => a.id === id)!
            const newId = `shape-${ts}-${id}`
            const num = seq.current++
            return src.box ? { ...src, id: newId, num, box: { ...src.box, x: src.box.x + off, y: src.box.y + off } }
                           : { ...src, id: newId, num, point: { x: src.point!.x + off, y: src.point!.y + off } }
          })
          if (newAnns.length) { setAnnotations(prev => [...prev, ...newAnns]); setSelectedId(newAnns[0].id); setSelectedIds(newAnns.map(a => a.id)) }
          // Duplicate arrows
          const arrIds = [...new Set([...(selectedArrowId ? [selectedArrowId] : []), ...selectedArrowIds])]
          const newArrs: Arrow[] = arrIds.map(id => {
            const src = arrows.find(a => a.id === id)!
            return { ...src, id: `arrow-${ts}-${id}`, x1: src.x1 + off, y1: src.y1 + off, x2: src.x2 + off, y2: src.y2 + off }
          })
          if (newArrs.length) { setArrows(prev => [...prev, ...newArrs]); setSelectedArrowId(newArrs[0].id); setSelectedArrowIds(newArrs.map(a => a.id)) }
          // Duplicate texts
          const txtIds = [...new Set([...(selectedTextId ? [selectedTextId] : []), ...selectedTextIds])]
          const newTxts: TextItem[] = txtIds.map(id => {
            const src = texts.find(tx => tx.id === id)!
            return { ...src, id: `text-${ts}-${id}`, x: src.x + off, y: src.y + off }
          })
          if (newTxts.length) { setTexts(prev => [...prev, ...newTxts]); setSelectedTextId(newTxts[0].id); setSelectedTextIds(newTxts.map(tx => tx.id)) }
        }
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !inputFocused && !activeTextRef.current) {
        e.preventDefault()
        const sid = selectedIdRef.current
        const said = selectedArrowIdRef2.current
        const stid = selectedTextIdRef.current
        if (selectedIds.length + selectedArrowIds.length + selectedTextIds.length > 1) {
          saveToHistory()
          setAnnotations(prev => prev.filter(a => !selectedIds.includes(a.id)).map((a, i) => ({ ...a, num: i + 1 })))
          setArrows(prev => prev.filter(a => !selectedArrowIds.includes(a.id)))
          setTexts(prev => prev.filter(t => !selectedTextIds.includes(t.id)))
          seq.current = annotations.filter(a => !selectedIds.includes(a.id)).length + 1
          setSelectedIds([]); setSelectedArrowIds([]); setSelectedTextIds([]); setSelectedId(null); setSelectedArrowId(null); setSelectedTextId(null)
        } else if (stid) {
          saveToHistory()
          setTexts(prev => prev.filter(t => t.id !== stid))
          setSelectedTextId(null)
        } else if (sid) {
          saveToHistory()
          setAnnotations(prev => prev.filter(a => a.id !== sid).map((a, i) => ({ ...a, num: i + 1 })))
          seq.current = annotations.filter(a => a.id !== sid).length + 1
          setSelectedId(null)
        } else if (said) {
          saveToHistory()
          setArrows(prev => prev.filter(a => a.id !== said))
          setSelectedArrowId(null)
        }
      }
      // Tool shortcuts handled by stable listener above
      if (e.key === 'Escape') {
        if (helpOpen) { setHelpOpen(false); return }
        if (historyOpen) { setHistoryOpen(false); return }
        if (popup) { setPopup(null); return }
        if (arrowPopup) { setArrowPopup(null); setArrowLabel(''); return }
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
  }, [img, imgSize, annotations, arrows, texts, selectedId, selectedArrowId, selectedIds, selectedArrowIds, selectedTextId, activeText, helpOpen, historyOpen, popup, arrowPopup, tool, effectiveScale])

  // Stable tool shortcut handler — registered once, reads only refs
  useEffect(() => {
    const onToolKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) return
      if (activeTextRef.current) return
      const k = e.key.toLowerCase()
      if (k === 'v') setTool('cursor')
      else if (k === 'p') setTool('box')
      else if (k === 'l') setTool(toolRef.current === 'arrow' ? 'double-arrow' : 'arrow')
      else if (k === 'a') setTool('arrow')
      else if (k === 't') setTool('text')
    }
    window.addEventListener('keydown', onToolKey)
    return () => window.removeEventListener('keydown', onToolKey)
  }, [])

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

      if (draggingTextId.current && selectedTextIdsRef.current.length > 1 && selectedTextIdsRef.current.includes(draggingTextId.current)) {
        // Multi-text drag — also move annotations and arrows
        const moved = multiTextStartRef.current.find(x => x.id === draggingTextId.current)
        if (moved) {
          const tdx = cx - draggingTextOffset.current.x - moved.x
          const tdy = cy - draggingTextOffset.current.y - moved.y
          setAnnotations(prev => prev.map(a => {
            const orig = multiStartRef.current.find(x => x.id === a.id)
            if (!orig || !selectedIdsRef.current.includes(a.id)) return a
            return orig.box ? { ...a, box: { ...orig.box, x: orig.box.x + tdx, y: orig.box.y + tdy } } : { ...a, point: { x: orig.point!.x + tdx, y: orig.point!.y + tdy } }
          }))
          setArrows(prev => prev.map(a => {
            const orig = multiArrowStartRef.current.find(x => x.id === a.id)
            if (!orig || !selectedArrowIdsRef.current.includes(a.id)) return a
            return { ...a, x1: orig.x1 + tdx, y1: orig.y1 + tdy, x2: orig.x2 + tdx, y2: orig.y2 + tdy }
          }))
        }
      }
      if (resizingTextId.current) {
        const es = effectiveScaleRef.current
        const dx = (e.clientX - resizingTextStart.current.mouseX) / es
        const dy = (e.clientY - resizingTextStart.current.mouseY) / es
        const h = resizingTextHandle.current
        const { origX, origY, origWidth, origFontSize } = resizingTextStart.current
        if (e.shiftKey) {
          const newFs = Math.max(8, Math.min(120, origFontSize + (dx + dy) * 0.25))
          setTexts(prev => prev.map(t => t.id === resizingTextId.current ? { ...t, fontSize: Math.round(newFs) } : t))
        } else {
          let newX = origX, newY = origY, newW = origWidth
          if (h.includes('e')) newW = Math.max(60, origWidth + dx)
          if (h.includes('w')) { newX = origX + dx; newW = Math.max(60, origWidth - dx) }
          setTexts(prev => prev.map(t => t.id === resizingTextId.current ? { ...t, x: newX, y: newY, width: newW } : t))
        }
      } else if (draggingTextId.current) {
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
        setAnnotations(prev => prev.map(a => {
          // Move all selected annotations together
          const isMulti = selectedIdsRef.current.includes(a.id) && selectedIdsRef.current.length > 1
          if (isMulti) {
            const orig = multiStartRef.current.find(x => x.id === a.id)
            if (orig) return orig.box ? { ...a, box: { ...orig.box, x: orig.box.x + dx, y: orig.box.y + dy } } : { ...a, point: { x: orig.point!.x + dx, y: orig.point!.y + dy } }
          }
          if (a.id !== id) return a
          return startBox ? { ...a, box: { ...startBox, x: startBox.x + dx, y: startBox.y + dy } } : startPoint ? { ...a, point: { x: startPoint.x + dx, y: startPoint.y + dy } } : a
        }))
        setArrows(prev => prev.map(a => {
          const isMulti = selectedArrowIdsRef.current.includes(a.id) && selectedArrowIdsRef.current.length > 0
          if (!isMulti) return a
          const orig = multiArrowStartRef.current.find(x => x.id === a.id)
          if (!orig) return a
          return { ...a, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy }
        }))
        if (selectedTextIdsRef.current.length > 0) {
          setTexts(prev => prev.map(t => {
            const orig = multiTextStartRef.current.find(x => x.id === t.id)
            if (!orig || !selectedTextIdsRef.current.includes(t.id)) return t
            return { ...t, x: orig.x + dx, y: orig.y + dy }
          }))
        }
      }
      if (movingArrowRef.current) {
        const { id, startMouse, start } = movingArrowRef.current
        const dx = cx - startMouse.x, dy = cy - startMouse.y
        if (!movingArrowRef.current.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD / es) return
        movingArrowRef.current.dragged = true
        setArrows(prev => prev.map(a => {
          const isMulti = selectedArrowIdsRef.current.includes(a.id) && selectedArrowIdsRef.current.length > 0
          if (isMulti) {
            const orig = multiArrowStartRef.current.find(x => x.id === a.id)
            if (orig) return { ...a, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy }
          }
          if (a.id !== id) return a
          return { ...a, x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy }
        }))
        setAnnotations(prev => prev.map(a => {
          const isMulti = selectedIdsRef.current.includes(a.id) && selectedIdsRef.current.length > 0
          if (!isMulti) return a
          const orig = multiStartRef.current.find(x => x.id === a.id)
          if (!orig) return a
          return orig.box ? { ...a, box: { ...orig.box, x: orig.box.x + dx, y: orig.box.y + dy } } : { ...a, point: { x: orig.point!.x + dx, y: orig.point!.y + dy } }
        }))
        if (selectedTextIdsRef.current.length > 0) {
          setTexts(prev => prev.map(t => {
            const orig = multiTextStartRef.current.find(x => x.id === t.id)
            if (!orig || !selectedTextIdsRef.current.includes(t.id)) return t
            return { ...t, x: orig.x + dx, y: orig.y + dy }
          }))
        }
      }
      if (resizingArrowRef.current) {
        const { id, endpoint } = resizingArrowRef.current
        setArrows(prev => prev.map(a => {
          if (a.id !== id) return a
          let nx = cx, ny = cy
          if (e.shiftKey) {
            const fx = endpoint === 'start' ? a.x2 : a.x1
            const fy = endpoint === 'start' ? a.y2 : a.y1
            const dx = cx - fx, dy = cy - fy
            const dist = Math.hypot(dx, dy)
            const angle = Math.atan2(dy, dx)
            const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
            nx = fx + dist * Math.cos(snapped)
            ny = fy + dist * Math.sin(snapped)
          }
          return endpoint === 'start' ? { ...a, x1: nx, y1: ny } : { ...a, x2: nx, y2: ny }
        }))
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
          const annId = movingAnnotation.current.id
          // Use rect from canvasRef since annotations state may be stale here
          const rect = canvasRef.current?.getBoundingClientRect()
          setAnnotations(prev => {
            const ann = prev.find(a => a.id === annId)
            if (!ann) return prev
            const es = effectiveScaleRef.current
            let sx = PANEL_W + 20, sy = 120
            if (rect) {
              if (ann.box) {
                sx = rect.left + (ann.box.x + ann.box.w) * es
                sy = rect.top  + (ann.box.y + ann.box.h) * es
              } else {
                sx = rect.left + ann.point!.x * es + PIN_R + 8
                sy = rect.top  + ann.point!.y * es + PIN_R + 8
              }
            }
            setPopup({ id: annId, sx, sy })
            return prev
          })
        }
        movingAnnotation.current = null
      }
      resizingAnnotation.current = null
      movingArrowRef.current = null
      resizingArrowRef.current = null
      resizingTextId.current = null
      draggingTextId.current = null
      draggingActiveText.current = false
      if (canvasRef.current) { const t = toolRef.current; canvasRef.current.style.cursor = t === 'text' ? 'text' : t === 'cursor' ? 'default' : 'crosshair' }
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
    el.onerror = () => console.error('[PinScribe] Image failed to load — possible CSP or data URL issue')
    el.onload = () => {
      const maxW = window.innerWidth
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
      setSelectedTextId(null)
      setSelectedIds([])
      setSelectedArrowIds([])
      setSelectedTextIds([])
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
    seq.current = Math.max(...s.annotations.map(a => a.num), 0) + 1
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
    seq.current = Math.max(...s.annotations.map(a => a.num), 0) + 1
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
      const sel = a.id === selectedArrowId || selectedArrowIds.includes(a.id)
      const hov = a.id === hoveredArrowId
      const lw = Math.max(1, 2 * es)
      ctx.strokeStyle = a.color
      ctx.lineWidth = sel ? lw * 1.4 : lw
      ctx.globalAlpha = hov ? 1 : 0.85
      drawArrowShape(ctx, a.x1 * es, a.y1 * es, a.x2 * es, a.y2 * es, a.bidirectional)
      ctx.globalAlpha = 1
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
      if (sel) {
        [[a.x1 * es, a.y1 * es], [a.x2 * es, a.y2 * es]].forEach(([hx, hy]) => {
          // White ring for contrast on any background
          ctx.beginPath(); ctx.arc(hx!, hy!, 5.5, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
          // Colored fill
          ctx.beginPath(); ctx.arc(hx!, hy!, 4, 0, Math.PI * 2)
          ctx.fillStyle = a.color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1
        })
      }
    })

    annotations.forEach(a => {
      const sel = a.id === selectedId || selectedIds.includes(a.id)
      ctx.strokeStyle = a.color
      ctx.lineWidth = sel ? 2 : 1.5
      if (a.box) ctx.strokeRect(a.box.x * es, a.box.y * es, a.box.w * es, a.box.h * es)
      const rawPx = a.box ? (a.box.x + a.box.w) * es : a.point!.x * es
      const rawPy = a.box ? a.box.y * es : a.point!.y * es
      const px = Math.max(PIN_R, Math.min(rawPx, canvas.width - PIN_R))
      const py = Math.max(PIN_R, Math.min(rawPy, canvas.height - PIN_R))
      drawPin(ctx, px, py, a.num, a.color)
      // Subtle selection ring on pin
      if (sel) {
        ctx.beginPath(); ctx.arc(px, py, PIN_R + 3, 0, Math.PI * 2)
        ctx.strokeStyle = a.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.25; ctx.stroke(); ctx.globalAlpha = 1
      }
    })

    if (marquee) {
      const mx = marquee.x1 * es, my = marquee.y1 * es
      const mw = (marquee.x2 - marquee.x1) * es, mh = (marquee.y2 - marquee.y1) * es
      ctx.fillStyle = 'rgba(100,160,255,0.08)'
      ctx.fillRect(mx, my, mw, mh)
      // White outer stroke for dark backgrounds
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 2; ctx.setLineDash([4, 3])
      ctx.strokeRect(mx, my, mw, mh)
      // Blue inner stroke for light backgrounds
      ctx.strokeStyle = 'rgba(60,130,255,0.8)'
      ctx.lineWidth = 1
      ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1)
      ctx.setLineDash([])
    }

    if (draft && tool === 'text') {
      const rdx = draft.x2 - draft.x1, rdy = draft.y2 - draft.y1
      const rx = Math.min(draft.x1, draft.x2) * es
      const ry = Math.min(draft.y1, draft.y2) * es
      const rw = Math.abs(rdx) * es, rh = Math.abs(rdy) * es || 40
      if (Math.abs(rdx) > DRAG_THRESHOLD) {
        ctx.strokeStyle = 'rgba(100,180,255,0.9)'; ctx.lineWidth = 1.5
        ctx.strokeRect(rx, ry, rw, rh)
        const hs = 6
        ;[[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh],
          [rx+rw/2,ry],[rx+rw/2,ry+rh],[rx,ry+rh/2],[rx+rw,ry+rh/2]].forEach(([hx, hy]) => {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(100,180,255,0.9)'; ctx.lineWidth = 1
          ctx.fillRect(hx! - hs/2, hy! - hs/2, hs, hs)
          ctx.strokeRect(hx! - hs/2, hy! - hs/2, hs, hs)
        })
        const wPx = Math.round(Math.abs(rdx)), hPx = Math.round(Math.abs(rdy))
        const label = `${wPx} × ${hPx}`
        ctx.font = 'bold 11px -apple-system, sans-serif'
        const lw2 = ctx.measureText(label).width + 12, lh2 = 20
        const lx = rx + rw / 2 - lw2 / 2, ly = ry + rh + 8
        ctx.fillStyle = 'rgba(100,180,255,0.9)'; ctx.beginPath()
        ctx.roundRect(lx, ly, lw2, lh2, 4); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(label, rx + rw / 2, ly + lh2 / 2)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
    }

    if (draft && tool !== 'text') {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      if (tool === 'box') {
        ctx.setLineDash([6, 3])
        ctx.strokeRect(draft.x1 * es, draft.y1 * es, (draft.x2 - draft.x1) * es, (draft.y2 - draft.y1) * es)
        ctx.setLineDash([])
      } else if (tool === 'arrow' || tool === 'double-arrow') {
        ctx.lineWidth = Math.max(1, 2 * es)
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
    const lw = ctx.lineWidth
    const arrowLen = Math.hypot(x2 - x1, y2 - y1)
    const headLen = Math.min(Math.max(6, lw * 5), arrowLen / 2.2)
    const headAngle = Math.PI / 5
    const angle = Math.atan2(y2 - y1, x2 - x1)
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

  function textBorderAt(x: number, y: number): { id: string; handle: 'nw'|'w'|'sw'|'se' } | null {
    const EDGE_R = 7 / effectiveScale
    const CORNER_R = 12 / effectiveScale
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return null
    for (const t of texts) {
      const el = textOverlayRefs.current.get(t.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      const es = effectiveScale
      const tx = (r.left - canvasRect.left) / es
      const ty = (r.top  - canvasRect.top)  / es
      const tw = r.width  / es
      const th = r.height / es
      if (Math.hypot(x - tx,       y - ty)       <= CORNER_R) return { id: t.id, handle: 'nw' }
      if (Math.hypot(x - tx,       y - (ty + th)) <= CORNER_R) return { id: t.id, handle: 'sw' }
      if (Math.hypot(x - (tx + tw), y - (ty + th)) <= CORNER_R) return { id: t.id, handle: 'se' }
      if (Math.abs(x - tx) <= EDGE_R && y > ty + CORNER_R && y < ty + th - CORNER_R) return { id: t.id, handle: 'w' }
    }
    return null
  }

  function setCursor(c: string): void {
    if (canvasRef.current) canvasRef.current.style.cursor = c
  }

  function commitText(fromBlur = false): void {
    if (!activeText) return
    if (textCancelledRef.current) { textCancelledRef.current = false; return }
    const val = (textareaRef.current?.value ?? activeTextValue).trim()
    let committedId: string | null = null
    if (!val && editingTextId) {
      // User cleared text — restore original from history snapshot
      const orig = undoStack.current.length ? undoStack.current[undoStack.current.length - 1].texts.find(t => t.id === editingTextId) : null
      if (orig) setTexts(prev => [...prev.filter(t => t.id !== editingTextId), orig])
    }
    if (val) {
      saveToHistory()
      const editingItem = editingTextId ? texts.find(t => t.id === editingTextId) : null
      committedId = editingTextId ?? `text-${Date.now()}`
      const newText: TextItem = { id: committedId, x: activeText.x, y: activeText.y, text: val, color, ...(activeText.width ? { width: activeText.width } : {}), ...(editingItem?.fontSize ? { fontSize: editingItem.fontSize } : {}) }
      if (editingTextId) {
        setTexts(prev => [...prev.filter(t => t.id !== editingTextId), newText])
      } else {
        setTexts(prev => [...prev, newText])
      }
    }
    const next = nextTextPos.current
    const nId  = nextEditingId.current
    const nVal = nextEditingValue.current
    nextTextPos.current      = null
    nextEditingId.current    = null
    nextEditingValue.current = ''
    setActiveText(next)
    setActiveTextValue(nVal)
    setEditingTextId(nId)
    // After commit: select placed text and return to cursor (Figma-like)
    if (!next) {
      if (committedId) setSelectedTextId(committedId)
      if (fromBlur) setTool('cursor')
    }
  }

  function doCopy(): void {
    if (!img) return
    setCopied(true)
    setTimeout(() => {
      window.api.copyToClipboard(renderComposite(img!, imgSize, annotations, arrows, texts))
      setTimeout(() => setCopied(false), 1500)
    }, 0)
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

  function openPopupFor(annId: string, annOverride?: Annotation): void {
    const ann = annOverride ?? annotations.find(a => a.id === annId)
    if (!ann) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const POPUP_W = 300, POPUP_H = 230
    let sx = PANEL_W + 20, sy = 120
    if (rect) {
      const es = effectiveScale
      if (ann.box) {
        sx = rect.left + (ann.box.x + ann.box.w) * es
        sy = rect.top  + (ann.box.y + ann.box.h) * es
      } else {
        sx = rect.left + ann.point!.x * es + PIN_R + 12
        sy = rect.top  + ann.point!.y * es + PIN_R + 12
      }
      // Flip left if too close to right edge
      if (sx + POPUP_W > window.innerWidth - 10) sx -= POPUP_W + PIN_R * 2 + 24
      // Flip up if too close to bottom edge
      if (sy + POPUP_H > window.innerHeight - 10) sy -= POPUP_H + PIN_R * 2 + 24
    }
    setPopup({ id: annId, sx, sy })
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = canvasPos(e)
    // Check text border before arrow to prevent arrow label popup taking over overlapping text
    const textHit = textBorderAt(pos.x, pos.y)
    if (textHit) return // text resize handles don't trigger label popup
    const hit = arrowAt(pos.x, pos.y)
    if (hit) {
      setArrowPopup({ id: hit.id, sx: e.clientX, sy: e.clientY })
      setArrowLabel(hit.label ?? '')
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (popup) return
    setColorOpen(false)
    setSelectedTextId(null)
    if (!activeText) setEditingTextId(null)  // clear stale editing state
    canvasInteractedRef.current = true

    if (spaceHeldRef.current) {
      isPanningRef.current = true
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offsetX: panOffsetRef.current.x, offsetY: panOffsetRef.current.y }
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      return
    }

    const pos = canvasPos(e)

    // Arrow endpoint resize (when arrow selected, any tool)
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

    // Tight pin hit → move (all tools)
    const pinHit = pinHitTight(pos.x, pos.y)
    if (pinHit) {
      saveToHistory()
      // If this pin is part of multi-select, keep multi-select and snapshot all positions
      if (!selectedIdsRef.current.includes(pinHit.id)) {
        setSelectedIds([]); setSelectedArrowIds([])
        setSelectedId(pinHit.id); setSelectedArrowId(null)
      }
      multiStartRef.current = annotations.map(a => ({ ...a, box: a.box ? { ...a.box } : undefined, point: a.point ? { ...a.point } : undefined }))
      multiArrowStartRef.current = arrows.map(a => ({ id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }))
      multiTextStartRef.current = texts.map(t => ({ ...t }))
      movingAnnotation.current = { id: pinHit.id, startMouse: pos, startBox: pinHit.box ? { ...pinHit.box } : undefined, startPoint: pinHit.point ? { ...pinHit.point } : undefined, dragged: false }
      setCursor('grabbing'); return
    }

    // Text border → resize
    const textBorderHit = textBorderAt(pos.x, pos.y)
    if (textBorderHit) {
      const t = texts.find(tx => tx.id === textBorderHit.id)!
      resizingTextId.current = textBorderHit.id
      resizingTextHandle.current = textBorderHit.handle
      resizingTextStart.current = { mouseX: e.clientX, mouseY: e.clientY, origX: t.x, origY: t.y, origWidth: t.width ?? TEXT_MAX_W, origFontSize: t.fontSize ?? 16 }
      setSelectedTextId(textBorderHit.id)
      return
    }

    // Arrow body → move (all tools)
    const arrowHit = arrowAt(pos.x, pos.y)
    if (arrowHit) {
      saveToHistory()
      if (!selectedArrowIdsRef.current.includes(arrowHit.id)) {
        setSelectedIds([]); setSelectedArrowIds([])
        setSelectedArrowId(arrowHit.id); setSelectedId(null)
      }
      multiStartRef.current = annotations.map(a => ({ ...a, box: a.box ? { ...a.box } : undefined, point: a.point ? { ...a.point } : undefined }))
      multiArrowStartRef.current = arrows.map(a => ({ id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }))
      multiTextStartRef.current = texts.map(t => ({ ...t }))
      movingArrowRef.current = { id: arrowHit.id, startMouse: pos, start: { x1: arrowHit.x1, y1: arrowHit.y1, x2: arrowHit.x2, y2: arrowHit.y2 }, dragged: false }
      setCursor('grabbing'); return
    }

    if (tool === 'cursor') {
      // Box border → resize
      const borderHit = boxBorderAt(pos.x, pos.y)
      if (borderHit) {
        const ann = annotations.find(a => a.id === borderHit.id)!
        saveToHistory()
        setSelectedId(borderHit.id); setSelectedArrowId(null)
        resizingAnnotation.current = { id: borderHit.id, handle: borderHit.handle, startMouse: pos, startBox: { ...ann.box! } }
        return
      }
      // Box interior → move
      const boxInterior = annotations.find(a => a.box && pos.x > a.box.x && pos.x < a.box.x + a.box.w && pos.y > a.box.y && pos.y < a.box.y + a.box.h)
      if (boxInterior) {
        saveToHistory()
        setSelectedIds([]); setSelectedArrowIds([])
        setSelectedId(boxInterior.id); setSelectedArrowId(null)
        multiStartRef.current = annotations.map(a => ({ ...a, box: a.box ? { ...a.box } : undefined, point: a.point ? { ...a.point } : undefined }))
        multiArrowStartRef.current = arrows.map(a => ({ id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }))
        multiTextStartRef.current = texts.map(t => ({ ...t }))
        movingAnnotation.current = { id: boxInterior.id, startMouse: pos, startBox: { ...boxInterior.box! }, dragged: false }
        setCursor('grabbing'); return
      }
      // Deselect + start marquee
      setSelectedId(null); setSelectedArrowId(null); setSelectedIds([]); setSelectedArrowIds([])
      isDown.current = true
      setDragStart(pos)
      setMarquee({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      return
    }

    if (tool === 'text') {
      if (activeText) {
        nextTextPos.current      = pos
        nextEditingId.current    = null
        nextEditingValue.current = ''
        return
      }
      // Defer placement to mouseup — need to detect click vs drag for point vs area text
      isDown.current = true
      setDragStart(pos)
      setDraft({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      return
    }
    isDown.current = true
    setDragStart(pos)
    setDraft({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (isPanningRef.current || spaceHeldRef.current) return
    if (!movingAnnotation.current && !resizingAnnotation.current && !movingArrowRef.current && !resizingArrowRef.current) {
      const pos = canvasPos(e)
      const pinH = annotationAt(pos.x, pos.y)
      const arrowH = arrowAt(pos.x, pos.y)
      const border = boxBorderAt(pos.x, pos.y)
      const newArrow = arrowH?.id ?? null
      if (newArrow !== hoveredArrowId) setHoveredArrowId(newArrow)
      const textBorder = textBorderAt(pos.x, pos.y)
      if (pinH || arrowH) {
        setCursor('pointer')
      } else if (textBorder) {
        const TC: Record<string, string> = { nw: 'nw-resize', w: 'w-resize', sw: 'sw-resize', se: 'se-resize' }
        setCursor(TC[textBorder.handle] ?? 'default')
      } else if (tool === 'cursor') {
        if (border) setCursor(HANDLE_CURSORS[border.handle])
        else setCursor('default')
      }
    }
    if (!isDown.current) return
    const pos = canvasPos(e)
    if (tool === 'cursor' && marquee) {
      setMarquee({ x1: dragStart.x, y1: dragStart.y, x2: pos.x, y2: pos.y })
      return
    }
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
    if (tool === 'cursor' && marquee) {
      const mx1 = Math.min(marquee.x1, marquee.x2), mx2 = Math.max(marquee.x1, marquee.x2)
      const my1 = Math.min(marquee.y1, marquee.y2), my2 = Math.max(marquee.y1, marquee.y2)
      const dx = mx2 - mx1, dy = my2 - my1
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        const hitAnns = annotations.filter(a => {
          if (a.box) {
            // Box: center point inside marquee
            return (a.box.x + a.box.w / 2) >= mx1 && (a.box.x + a.box.w / 2) <= mx2 &&
                   (a.box.y + a.box.h / 2) >= my1 && (a.box.y + a.box.h / 2) <= my2
          }
          // Point pin: pin position inside marquee (with PIN_R tolerance)
          const pinR = PIN_R / effectiveScale
          return a.point!.x >= mx1 - pinR && a.point!.x <= mx2 + pinR &&
                 a.point!.y >= my1 - pinR && a.point!.y <= my2 + pinR
        })
        const hitArrows = arrows.filter(a => {
          const amx = (a.x1 + a.x2) / 2, amy = (a.y1 + a.y2) / 2
          return amx >= mx1 && amx <= mx2 && amy >= my1 && amy <= my2
        })
        const hitTexts = texts.filter(t => {
          const tw = t.width ?? TEXT_MAX_W, th = t.height ?? 40
          return t.x < mx2 && (t.x + tw) > mx1 && t.y < my2 && (t.y + th) > my1
        })
        setSelectedIds(hitAnns.map(a => a.id))
        setSelectedArrowIds(hitArrows.map(a => a.id))
        setSelectedTextIds(hitTexts.map(t => t.id))
        setSelectedId(hitAnns[0]?.id ?? null)
        setSelectedArrowId(hitArrows[0]?.id ?? null)
        setSelectedTextId(hitTexts[0]?.id ?? null)
      }
      setMarquee(null)
      return
    }
    if (!draft) return
    const dx = Math.abs(draft.x2 - draft.x1)
    const dy = Math.abs(draft.y2 - draft.y1)

    // Text tool: click = point text, drag = area text
    if (tool === 'text') {
      setDraft(null)
      if (dx > DRAG_THRESHOLD) {
        // Area text — use drag width
        const x = Math.min(draft.x1, draft.x2)
        const y = Math.min(draft.y1, draft.y2)
        setActiveText({ x, y, width: dx })
      } else {
        // Point text — no container
        setActiveText({ x: draft.x1, y: draft.y1 })
      }
      setActiveTextValue('')
      setEditingTextId(null)
      return
    }

    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
      setDraft(null)
      const hit = annotationAt(draft.x1, draft.y1)
      if (hit) { openPopupFor(hit.id); return }
      if (tool === 'box') {
        saveToHistory()
        const num = seq.current++
        const id = `shape-${Date.now()}`
        const newAnn: Annotation = { id, num, comment: '', color, point: { x: draft.x1, y: draft.y1 } }
        setAnnotations(prev => [...prev, newAnn])
        openPopupFor(id, newAnn)
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
      const newBoxAnn: Annotation = { id, num, comment: '', color, box }
      setAnnotations(prev => [...prev, newBoxAnn])
      openPopupFor(id, newBoxAnn)
    }
    setDraft(null)
  }


  // ─── Render ───────────────────────────────────────────────────────────────

  const cw = imgSize.w * effectiveScale
  const ch = imgSize.h * effectiveScale

  // Pre-compute update modal strings (avoids IIFE in JSX which breaks esbuild)
  const updateTitles: Record<string, string> = { checking: 'Checking for updates...', uptodate: 'Up to date', downloading: 'Downloading update…', ready: 'Update ready', installing: 'Installing update…', error: 'Update failed' }
  const updateSubs: Record<string, string> = { checking: 'Looking for a new version', uptodate: `You are on the latest version${updateVersion ? ` (v${updateVersion})` : ''}.`, downloading: updatePct > 0 ? `${updatePct}%` : '', ready: updateVersion ? `v${updateVersion} is ready to install.` : 'Ready to install.', installing: 'The app will restart shortly.', error: updateError }

  // Pre-compute color picker position
  const colorBtnRect = colorBtnRef.current?.getBoundingClientRect()
  const colorPickerTop = colorBtnRect ? colorBtnRect.bottom + 8 : 52
  const colorPickerLeft = colorBtnRect ? colorBtnRect.left + colorBtnRect.width / 2 : 0

  // Pre-compute active text props
  const atEs = effectiveScale
  const sharedTextStyle: React.CSSProperties = {
    display: 'block', background: 'transparent', border: 'none', outline: 'none',
    color, fontSize: 16 * effectiveScale, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontWeight: 'bold', caretColor: color, textShadow: 'none',
    resize: 'none', lineHeight: 1.4, overflow: 'hidden',
  }
  const sharedTextareaHandlers = {
    value: activeTextValue,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setActiveTextValue(e.target.value)
      // Auto-grow width for point text (no container)
      if (!atIsAreaEarly) { e.target.style.width = 'auto'; e.target.style.width = e.target.scrollWidth + 'px' }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(true) }
      if (e.key === 'Escape') { textCancelledRef.current = true; setActiveText(null); setActiveTextValue(''); setEditingTextId(null); setTool('cursor') }
    },
    onBlur: () => commitText(true),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100vh', overflow: 'hidden', background: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />

      {/* Left: Notes sidebar — full height */}
      <div style={{ width: PANEL_W, flexShrink: 0, borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', padding: '52px 16px 20px 12px', gap: 4, overflowY: 'auto', position: 'relative' }}>
          {/* Drag zone — top strip where macOS traffic lights sit */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, WebkitAppRegion: 'drag' } as React.CSSProperties} />
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
              onClick={() => openPopupFor(a.id)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0',
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
              <div style={{ color: a.comment ? '#ddd' : '#555', fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word', overflowWrap: 'break-word', flex: 1, minWidth: 0, whiteSpace: 'pre-line', paddingTop: 3 }}>
                {a.comment || 'Add note...'}
              </div>
            </div>
          ))}
        </div>

      {/* Right column: toolbar + canvas + bottom bar */}
      <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'grid', gridTemplateRows: '44px 1fr 56px' }}>

        {/* Toolbar */}
        <div style={{ borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <ToolBtn active={tool === 'cursor'} onClick={() => setTool('cursor')} title="Select (V)"><IconCursor /></ToolBtn>
            <Divider />
            <ToolBtn active={tool === 'box'} onClick={() => setTool('box')} title="Annotation box (P)"><IconPin /></ToolBtn>
            <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow (A) — hold Shift to lock straight"><IconArrow /></ToolBtn>
            <ToolBtn active={tool === 'double-arrow'} onClick={() => setTool('double-arrow')} title="Double arrow — hold Shift to lock straight"><IconDoubleArrow /></ToolBtn>
            <ToolBtn active={tool === 'text'} onClick={() => { if (tool === 'text' && activeText) { textCancelledRef.current = true; setActiveText(null); setActiveTextValue(''); setEditingTextId(null); isDown.current = false; setDraft(null) } setTool('text') }} title="Text (T)">
              <span style={{ fontWeight: 'bold', fontSize: 14, fontFamily: '-apple-system, sans-serif', lineHeight: 1 }}>T</span>
            </ToolBtn>
            <Divider />
            <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button ref={colorBtnRef} onClick={() => setColorOpen(p => !p)} title="Annotation colour"
                style={{ width: 22, height: 22, borderRadius: '50%', background: color, border: colorOpen ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }} />
            </div>
          </div>
          <div style={{ position: 'absolute', right: 8, display: 'flex', alignItems: 'center', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <ToolBtn active={false} onClick={showHistory} title="History">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </ToolBtn>
            <ToolBtn active={false} onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
              <span style={{ fontSize: 13, fontWeight: 600 }}>?</span>
            </ToolBtn>
          </div>
        </div>

        {/* Canvas area */}
        <div
          ref={canvasAreaRef}
          style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 0, background: '#1a1a1a' }}
          onWheel={e => {
            if (!img) return
            e.preventDefault()
            const cx = e.clientX, cy = e.clientY
            const factor = e.deltaY < 0 ? 1.1 : 0.9
            setZoom(p => {
              const newZoom = Math.min(Math.max(p * factor, 0.1), 5)
              const ratio = newZoom / p
              const rect = canvasAreaRef.current?.getBoundingClientRect()
              if (rect) {
                const mx = cx - rect.left - rect.width / 2
                const my = cy - rect.top - rect.height / 2
                const nx = mx * (1 - ratio) + panOffsetRef.current.x * ratio
                const ny = my * (1 - ratio) + panOffsetRef.current.y * ratio
                panOffsetRef.current = { x: nx, y: ny }
                if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = `translate(${nx}px, ${ny}px)`
              }
              return newZoom
            })
          }}
          onClick={() => {
            setColorOpen(false)
            // Only deselect if click wasn't on the canvas element (which sets the flag)
            if (canvasInteractedRef.current) { canvasInteractedRef.current = false; return }
            setSelectedId(null); setSelectedArrowId(null); setSelectedTextId(null)
            setSelectedIds([]); setSelectedArrowIds([]); setSelectedTextIds([])
          }}
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
                  ref={el => { if (el) textOverlayRefs.current.set(t.id, el); else textOverlayRefs.current.delete(t.id) }}
                  style={{
                    position: 'absolute',
                    left: t.x * effectiveScale,
                    top: t.y * effectiveScale,
                    color: t.color,
                    fontSize: (t.fontSize ?? 16) * effectiveScale,
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    fontWeight: 'bold',
                    width: t.width ? t.width * effectiveScale : undefined,
                    maxWidth: TEXT_MAX_W * effectiveScale,
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                    cursor: tool === 'cursor' ? 'default' : 'move',
                    userSelect: 'none',
                    textShadow: 'none',
                    padding: '2px 4px',
                    outline: (selectedTextId === t.id || selectedTextIds.includes(t.id)) ? `2px solid ${t.color}` : 'none',
                    outlineOffset: 3,
                    paddingRight: 12, // space for resize handle
                  }}
                  onMouseDown={e => {
                    e.stopPropagation()
                    textWasDragged.current = false
                    const rect = canvasRef.current!.getBoundingClientRect()
                    const es = effectiveScaleRef.current
                    draggingTextId.current = t.id
                    multiTextStartRef.current = texts.map(x => ({ ...x }))
                    multiStartRef.current = annotations.map(a => ({ ...a, box: a.box ? { ...a.box } : undefined, point: a.point ? { ...a.point } : undefined }))
                    multiArrowStartRef.current = arrows.map(a => ({ id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }))
                    draggingTextOffset.current = {
                      x: (e.clientX - rect.left) / es - t.x,
                      y: (e.clientY - rect.top) / es - t.y,
                    }
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    // Single click always selects — never edits
                    setSelectedTextId(t.id)
                    setSelectedTextIds([])
                    setSelectedId(null)
                    setSelectedArrowId(null)
                  }}
                  onDoubleClick={e => {
                    e.stopPropagation()
                    if (textWasDragged.current) return
                    // Double-click: remove from array + open editing (clean state prevents duplicates)
                    setTexts(prev => prev.filter(tx => tx.id !== t.id))
                    setSelectedTextId(null)
                    setEditingTextId(null)  // clear any stale editingTextId first
                    if (activeText) {
                      nextTextPos.current      = { x: t.x, y: t.y, ...(t.width ? { width: t.width } : {}) }
                      nextEditingId.current    = t.id
                      nextEditingValue.current = t.text
                    } else {
                      setActiveText({ x: t.x, y: t.y, ...(t.width ? { width: t.width } : {}) })
                      setActiveTextValue(t.text)
                      setEditingTextId(t.id)
                      setTool('text')
                    }
                  }}
                >
                  {t.text}
                  {/* No DOM handles — resize detected canvas-side like annotation boxes */}
                </div>
              ))}

              {/* Active text input */}
              {activeText && (atIsAreaEarly ? (
                // Area text — blue outline container
                <div
                  style={{ position: 'absolute', left: activeText.x * atEs, top: activeText.y * atEs, border: '1.5px solid rgba(100,180,255,0.8)', borderRadius: 2, zIndex: 10, width: activeText.width! * atEs, cursor: 'grab' }}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation()
                    const rect = canvasRef.current!.getBoundingClientRect()
                    const esc = effectiveScaleRef.current
                    draggingActiveText.current = true
                    draggingActiveOffset.current = { x: (e.clientX - rect.left) / esc - activeText.x, y: (e.clientY - rect.top) / esc - activeText.y }
                  }}>
                  <textarea ref={textareaRef} {...sharedTextareaHandlers} autoFocus
                    style={{ ...sharedTextStyle, fontSize: 16 * atEs, width: '100%', minHeight: 24 * atEs, height: 'auto', padding: '4px 6px' }} />
                </div>
              ) : (
                // Point text — no container
                <textarea ref={textareaRef} {...sharedTextareaHandlers} autoFocus
                  style={{ ...sharedTextStyle, overflow: 'visible', fontSize: 16 * atEs, position: 'absolute', left: activeText.x * atEs, top: activeText.y * atEs, minWidth: 4, minHeight: 24 * atEs, width: 'auto', height: 'auto', padding: '0 2px', zIndex: 10, whiteSpace: 'nowrap' }} />
              ))}
            </div>
          )}

          {copied && <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 13, padding: '6px 16px', borderRadius: 8, zIndex: 500, pointerEvents: 'none', fontFamily: '-apple-system,sans-serif' }}>✓ Copied to clipboard</div>}
          {popup && <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setPopup(null)} />}
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
              initialColor={annotations.find(a => a.id === popup.id)?.color ?? color}
              onSave={(id, comment) => { saveToHistory(); setAnnotations(prev => prev.map(a => a.id === id ? { ...a, comment } : a)); setPopup(null) }}
              onColorChange={(id, c) => { setAnnotations(prev => prev.map(a => a.id === id ? { ...a, color: c } : a)) }}
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

        {/* Bottom bar */}
        <div style={{ background: '#111', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8 }}>
          {/* Left: zoom + undo/redo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, visibility: img ? 'visible' : 'hidden' }}>
            <ZoomBtn onClick={() => setZoom(p => Math.max(p * 0.9, 0.1))} title="Zoom out">−</ZoomBtn>
            <span style={{ color: '#555', fontSize: 12, minWidth: 36, textAlign: 'center' }}>{Math.round(effectiveScale * 100)}%</span>
            <ZoomBtn onClick={() => setZoom(p => Math.min(p * 1.1, 5))} title="Zoom in">+</ZoomBtn>
            <ZoomBtn onClick={() => { setZoom(1); panOffsetRef.current = { x: 0, y: 0 }; if (canvasWrapperRef.current) canvasWrapperRef.current.style.transform = '' }} style={{ fontSize: 12, width: 'auto', padding: '4px 8px' }} title="Fit ⌘0">Fit</ZoomBtn>
            <div style={{ width: 1, height: 14, background: '#2a2a2a', margin: '0 2px' }} />
            <ZoomBtn onClick={undo} style={{ opacity: canUndo ? 1 : 0.25 }} title="Undo ⌘Z">
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M2 5H8.5C10.4 5 12 6.6 12 8.5S10.4 12 8.5 12H4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M4.5 2.5L2 5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </ZoomBtn>
            <ZoomBtn onClick={redo} style={{ opacity: canRedo ? 1 : 0.25 }} title="Redo ⌘⇧Z">
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M12 5H5.5C3.6 5 2 6.6 2 8.5S3.6 12 5.5 12H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M9.5 2.5L12 5l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </ZoomBtn>
          </div>
          {/* Center: Save PNG + Copy (flex spacer trick) */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Btn onClick={() => img && window.api.savePng(renderComposite(img, imgSize, annotations, arrows, texts))}>Save PNG <Kbd>⌘S</Kbd></Btn>
            <Btn primary onClick={doCopy}>{copied ? '✓ Copied!' : <>Copy <Kbd primary>⌘C</Kbd></>}</Btn>
          </div>
          {/* Right: New */}
          <Btn onClick={newSession}>New <Kbd>⌘N</Kbd></Btn>
        </div>

      </div>{/* end right column */}

      {/* Update modal */}
      {updateState !== 'idle' && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 18, padding: '28px 24px 20px', width: 268, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
              <div style={{ marginBottom: 4 }}>{UPDATE_ICONS[updateState] ?? UPDATE_ICONS.checking}</div>
              <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, textAlign: 'center' }}>{updateTitles[updateState] ?? ''}</div>
              <div style={{ color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 1.45, minHeight: 18 }}>{updateSubs[updateState] ?? ''}</div>
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
      )}

      {/* Color picker — fixed so it always renders above canvas */}
      {colorOpen && (
          <div style={{ position: 'fixed', top: colorPickerTop, left: colorPickerLeft, transform: 'translateX(-50%)', background: '#222', border: '1px solid #444', borderRadius: 10, padding: 10, display: 'flex', gap: 8, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            onMouseDown={e => e.stopPropagation()}>
            {COLORS.map(c => (
              <button key={c.value} title={c.label} onClick={() => {
                const newColor = c.value
                setColor(newColor); setColorOpen(false)
                const allArrowIds = [...new Set([...(selectedArrowId ? [selectedArrowId] : []), ...selectedArrowIds])]
                const allAnnIds   = [...new Set([...(selectedId ? [selectedId] : []), ...selectedIds])]
                const allTextIds  = [...new Set([...(selectedTextId ? [selectedTextId] : []), ...selectedTextIds])]
                if (allArrowIds.length || allAnnIds.length || allTextIds.length) saveToHistory()
                if (allArrowIds.length) setArrows(prev => prev.map(a => allArrowIds.includes(a.id) ? { ...a, color: newColor } : a))
                if (allAnnIds.length)   setAnnotations(prev => prev.map(a => allAnnIds.includes(a.id) ? { ...a, color: newColor } : a))
                if (allTextIds.length)  setTexts(prev => prev.map(t => allTextIds.includes(t.id) ? { ...t, color: newColor } : t))
              }}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c.value, cursor: 'pointer', border: color === c.value ? '2px solid #fff' : '2px solid transparent', padding: 0 }} />
            ))}
          </div>
      )}

      {/* Help modal */}
      {helpOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setHelpOpen(false)}>
          <div style={{ background: '#1e1e1e', border: '1px solid #444', borderRadius: 12, padding: '24px 28px', minWidth: 320, maxWidth: 400 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#fff', fontSize: 15, marginBottom: 16, fontWeight: 600 }}>Keyboard shortcuts</h3>
            {([
              ['Select tool', 'V'], ['Annotation tool', 'P'], ['Arrow / double arrow', 'A / L'], ['Text tool', 'T'],
              ['Copy composite', '⌘C'], ['Save PNG', '⌘S'], ['New session', '⌘N'],
              ['Open image', '⌘O'], ['Paste image', '⌘V'], ['Undo', '⌘Z'],
              ['Redo', '⌘⇧Z'], ['Duplicate annotation', '⌘D'], ['Delete selected', '⌫'],
              ['Straight arrow', 'Shift+drag'], ['Pan canvas', 'Space+drag'],
              ['Label arrow', 'double-click'], ['Return to cursor', 'Esc'],
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 12 }}>
                {historyItems.map(item => (
                  <div key={item.sessionId}
                    style={{ cursor: 'pointer', borderRadius: 9, border: '2px solid transparent', overflow: 'hidden', background: '#111', transition: 'border-color 0.15s', position: 'relative' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = UI_COLOR }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent' }}>
                    <img src={item.thumbnail} alt="" onClick={() => loadSessionFromHistory(item.path)} style={{ width: '100%', height: 98, objectFit: 'cover', display: 'block' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
                      <span style={{ color: '#666', fontSize: 11 }}>{relDate(item.savedAt)}</span>
                      <button
                        onClick={async e => { e.stopPropagation(); await window.api.deleteAutosave(item.path); setHistoryItems(prev => prev.filter(x => x.path !== item.path)) }}
                        style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = UI_COLOR }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#444' }}>
                        ✕
                      </button>
                    </div>
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

// ─── UI primitives ────────────────────────────────────────────────────────────

function Divider(): React.ReactElement {
  return <div style={{ width: 1, height: 16, background: '#333', marginLeft: 2, marginRight: 2 }} />
}

function ToolBtn({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title: string }): React.ReactElement {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? '#3a3a3a' : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fff' : '#666',
        border: 'none',
        outline: 'none',
        boxShadow: 'none',
        borderRadius: 6,
        width: 32, height: 32,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
        transition: 'background 0.1s, color 0.1s',
      }}>
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
