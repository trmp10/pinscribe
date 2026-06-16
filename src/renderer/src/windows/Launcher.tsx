import React, { useState } from 'react'

export default function Launcher(): React.ReactElement {
  const [dragOver, setDragOver] = useState(false)

  function onDragEnter(e: React.DragEvent): void { e.preventDefault(); setDragOver(true) }
  function onDragOver(e: React.DragEvent): void { e.preventDefault() }
  function onDragLeave(): void { setDragOver(false) }
  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => window.api.dropImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        width: '100vw',
        height: '100vh',
        background: dragOver ? '#2a1a1e' : '#1c1c1e',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        outline: dragOver ? '2px solid #e8334a' : 'none',
        transition: 'background 0.1s'
      }}
    >
      {/* Drag handle / title */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 72,
          gap: 8,
          WebkitAppRegion: 'drag',
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        } as React.CSSProperties}
      >
        <span style={{ fontSize: 14 }}>📌</span>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>
          PinScribe
        </span>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <LaunchButton
          label="Open image"
          shortcut="⌘O"
          onClick={() => window.api.launchOpen()}
        />
        <LaunchButton
          label="Paste image"
          shortcut="⌘V"
          onClick={() => window.api.launchPaste()}
        />
      </div>
    </div>
  )
}

function LaunchButton({
  label,
  shortcut,
  onClick
}: {
  label: string
  shortcut: string
  onClick: () => void
}): React.ReactElement {
  const [hover, setHover] = React.useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '9px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'background 0.1s'
      }}
    >
      <span style={{ color: '#fff', fontSize: 13 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{shortcut}</span>
    </button>
  )
}
