const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Tray, Menu, globalShortcut, Notification, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')

let win = null
let tray = null
let allowQuit = false

// ─── Auto-updater ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.channel = 'latest'

autoUpdater.on('update-available', info => {
  autoUpdater.downloadUpdate()
  setTrayMenu('downloading')
  win?.webContents.send('update-status', { state: 'downloading', version: info.version, percent: 0 })
})

autoUpdater.on('download-progress', p => {
  win?.webContents.send('update-status', { state: 'downloading', percent: Math.round(p.percent) })
})

autoUpdater.on('update-downloaded', info => {
  setTrayMenu('ready')
  win?.webContents.send('update-status', { state: 'ready', version: info.version })
})

autoUpdater.on('update-not-available', () => {
  setTrayMenu('uptodate')
  win?.webContents.send('update-status', { state: 'uptodate', version: app.getVersion() })
})

function checkForUpdates() {
  win?.show(); win?.focus()
  setTrayMenu('checking')
  win?.webContents.send('update-status', { state: 'checking' })
  autoUpdater.checkForUpdates()
}
autoUpdater.on('error', (err) => {
  setTrayMenu('idle')
  new Notification({ title: 'Update check failed', body: err?.message || 'Could not reach update server.' }).show()
})

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'PinScribe',
    icon: path.join(__dirname, 'resources/icon.icns'),
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  win.loadFile('index.html')
  win.once('ready-to-show', () => win.show())
  win.on('close', e => { if (!allowQuit) { e.preventDefault(); win.hide() } })
}

function toggleWindow() {
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function setTrayMenu(state) {
  if (!tray) return
  const template = [
    { label: 'Open PinScribe', click: () => { win.show(); win.focus() } },
    { type: 'separator' },
  ]

  if (state === 'downloading') {
    template.push({ label: 'Downloading update…', enabled: false })
  } else if (state === 'updating') {
    template.push({ label: 'Installing update…', enabled: false })
  } else if (state === 'ready') {
    template.push({ label: 'Restart to Update', click: () => { allowQuit = true; autoUpdater.quitAndInstall(false, true) } })
  } else if (state === 'uptodate') {
    template.push({ label: `Up to date — v${app.getVersion()}`, enabled: false })
    template.push({ label: 'Check for Updates', click: () => checkForUpdates() })
  } else if (state === 'checking') {
    template.push({ label: 'Checking for updates…', enabled: false })
  } else {
    template.push({ label: 'Check for Updates', click: () => checkForUpdates() })
  }

  template.push({ type: 'separator' }, { label: 'Quit', click: () => app.exit() })
  tray._contextMenu = Menu.buildFromTemplate(template)
  tray.setContextMenu(null)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'resources/tray-icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('PinScribe')
  tray.on('click', toggleWindow)
  tray.on('right-click', () => tray.popUpContextMenu(tray._contextMenu))
  setTrayMenu('idle')
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('hide-window', () => win?.hide())
ipcMain.on('restart-for-update', () => {
  setTrayMenu('updating')
  win?.webContents.send('update-status', { state: 'installing' })
  allowQuit = true
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.on('copy-to-clipboard', (_e, dataUrl) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
})

ipcMain.handle('paste-image', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return img.toDataURL()
})

// ─── Save PNG ─────────────────────────────────────────────────────────────────

ipcMain.handle('save-png', async (_e, dataUrl) => {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Save as PNG',
    defaultPath: 'annotation.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  })
  if (canceled || !filePath) return false
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return true
})

// ─── Auto-save ────────────────────────────────────────────────────────────────

function autosavesDir() {
  return path.join(app.getPath('userData'), 'autosaves')
}

function ensureAutosavesDir() {
  const dir = autosavesDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

ipcMain.handle('auto-save', (_e, data) => {
  try {
    ensureAutosavesDir()
    const file = path.join(autosavesDir(), `${data.sessionId}.json`)
    fs.writeFileSync(file, JSON.stringify(data), 'utf8')
    const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000
    const files = fs.readdirSync(autosavesDir())
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(autosavesDir(), f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    files.forEach((f, i) => {
      if (i >= 30 || f.mtime < cutoff) {
        try { fs.unlinkSync(path.join(autosavesDir(), f.name)) } catch {}
      }
    })
    return true
  } catch { return false }
})

ipcMain.handle('get-autosaves', () => {
  try {
    ensureAutosavesDir()
    const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000
    return fs.readdirSync(autosavesDir())
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw = fs.readFileSync(path.join(autosavesDir(), f), 'utf8')
          const d = JSON.parse(raw)
          return { path: path.join(autosavesDir(), f), thumbnail: d.thumbnail, savedAt: d.savedAt, sessionId: d.sessionId }
        } catch { return null }
      })
      .filter(Boolean)
      .filter(item => new Date(item.savedAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
      .slice(0, 30)
  } catch { return [] }
})

ipcMain.handle('open-autosave', (_e, filePath) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.dock.hide()

app.whenReady().then(() => {
  createWindow()
  createTray()
  globalShortcut.register('CommandOrControl+Shift+P', toggleWindow)
  setTimeout(() => autoUpdater.checkForUpdates(), 3000)
})

app.on('window-all-closed', () => { if (allowQuit) app.quit() })
app.on('will-quit', () => globalShortcut.unregisterAll())
