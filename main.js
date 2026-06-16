const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Tray, Menu, globalShortcut, Notification } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')

let win = null
let tray = null

// ─── Auto-updater ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-available', info => {
  autoUpdater.downloadUpdate()
  setTrayMenu('downloading')
  new Notification({
    title: 'PinScribe update available',
    body: `v${info.version} is downloading…`
  }).show()
})

autoUpdater.on('update-downloaded', () => {
  setTrayMenu('ready')
  new Notification({
    title: 'PinScribe ready to update',
    body: 'Click "Restart to Update" in the menu bar icon.'
  }).show()
})

autoUpdater.on('update-not-available', () => setTrayMenu('idle'))
autoUpdater.on('error', () => setTrayMenu('idle'))

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
  win.on('close', e => { e.preventDefault(); win.hide() })
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
  } else if (state === 'ready') {
    template.push({ label: 'Restart to Update', click: () => autoUpdater.quitAndInstall() })
  } else {
    template.push({ label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() })
  }

  template.push({ type: 'separator' }, { label: 'Quit', click: () => app.exit() })
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'resources/tray-icon.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('PinScribe')
  tray.on('click', toggleWindow)
  setTrayMenu('idle')
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('hide-window', () => win?.hide())

ipcMain.on('copy-to-clipboard', (_e, dataUrl) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
})

ipcMain.handle('paste-image', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return img.toDataURL()
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.dock.hide()

app.whenReady().then(() => {
  createWindow()
  createTray()
  globalShortcut.register('CommandOrControl+Shift+P', toggleWindow)
  setTimeout(() => autoUpdater.checkForUpdates(), 3000)
})

app.on('window-all-closed', () => {})
app.on('will-quit', () => globalShortcut.unregisterAll())
