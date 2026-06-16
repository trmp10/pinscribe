import React, { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export default function CaptureOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [start, setStart] = useState({ x: 0, y: 0 })
  const [rect, setRect] = useState<Rect | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    window.api.onScreenshot((dataUrl: string) => {
      setScreenshot(dataUrl)
      const img = new Image()
      img.src = dataUrl
      img.onload = () => {
        imgRef.current = img
        draw(img, null)
      }
    })

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.captureCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function draw(img: HTMLImageElement, selection: Rect | null): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (selection && selection.w > 0 && selection.h > 0) {
      const { x, y, w, h } = normalizeRect(selection)
      // Cut out the selected area (show original screenshot)
      ctx.drawImage(img, x, y, w, h, x, y, w, h)
      // Border
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)

      // Size label
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillRect(x, y - 22, 80, 20)
      ctx.fillStyle = '#fff'
      ctx.font = '11px -apple-system'
      ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + 4, y - 7)
    }
  }

  function normalizeRect(r: Rect): Rect {
    return {
      x: r.w < 0 ? r.x + r.w : r.x,
      y: r.h < 0 ? r.y + r.h : r.y,
      w: Math.abs(r.w),
      h: Math.abs(r.h)
    }
  }

  function onMouseDown(e: React.MouseEvent): void {
    setDragging(true)
    setStart({ x: e.clientX, y: e.clientY })
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  function onMouseMove(e: React.MouseEvent): void {
    if (!dragging || !imgRef.current) return
    const r = { x: start.x, y: start.y, w: e.clientX - start.x, h: e.clientY - start.y }
    setRect(r)
    draw(imgRef.current, r)
  }

  function onMouseUp(): void {
    if (!dragging || !rect || !imgRef.current) return
    setDragging(false)

    const nr = normalizeRect(rect)
    if (nr.w < 10 || nr.h < 10) return

    // Crop the screenshot to the selected area
    const canvas = document.createElement('canvas')
    canvas.width = nr.w
    canvas.height = nr.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(imgRef.current, nr.x, nr.y, nr.w, nr.h, 0, 0, nr.w, nr.h)
    const cropDataUrl = canvas.toDataURL('image/png')
    window.api.captureDone(cropDataUrl)
  }

  if (!screenshot) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.01)' }} />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        display: 'block'
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    />
  )
}
