import React, { useEffect, useRef, useState } from 'react'

interface Props {
  pinId: string
  x: number
  y: number
  initialComment: string
  initialColor: string
  onSave: (pinId: string, comment: string) => void
  onColorChange: (pinId: string, color: string) => void
  onDelete: (pinId: string) => void
  onClose: () => void
}

export default function CommentPopup({
  pinId, x, y, initialComment, initialColor,
  onSave, onColorChange, onDelete, onClose
}: Props): React.ReactElement {
  const [text, setText] = useState(initialComment)
  const [activeColor, setActiveColor] = useState(initialColor)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(pinId, text) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [text, pinId, onSave, onClose])

  const popupW = 300
  const px = Math.max(10, Math.min(x, window.innerWidth - popupW - 10))
  const py = Math.max(10, Math.min(y, window.innerHeight - 230 - 10))

  return (
    <div
      style={{ position: 'fixed', left: px, top: py, width: popupW, background: '#222', border: '1px solid #444', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000, padding: 14, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Note</div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a comment..."
        style={{ width: '100%', height: 72, background: '#111', border: '1.5px solid #555', borderRadius: 6, color: '#fff', fontSize: 13, padding: 8, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {['#e8334a','#3b82f6','#22c55e','#f59e0b','#a855f7'].map(c => (
          <button key={c} title={c}
            onClick={() => { setActiveColor(c); onColorChange(pinId, c) }}
            style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: activeColor === c ? '2px solid #fff' : '2px solid transparent', padding: 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        <button onClick={() => onDelete(pinId)}
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}>
          Delete
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ background: '#333', border: 'none', color: '#ccc', fontSize: 13, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={() => onSave(pinId, text)}
            style={{ background: '#e8334a', border: 'none', color: '#fff', fontSize: 13, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
