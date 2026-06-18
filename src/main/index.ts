import { app, BrowserWindow, ipcMain, clipboard, nativeImage, Tray, Menu, globalShortcut, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, createWriteStream } from 'fs'
import { get as httpsGetRaw } from 'https'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import type { IncomingMessage } from 'http'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let trayContextMenu: Electron.Menu | null = null
let allowQuit = false

// ─── Updater ──────────────────────────────────────────────────────────────────

const YML_URL = 'https://github.com/trmp10/pinscribe/releases/latest/download/latest-mac.yml'

function httpsGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    httpsGetRaw(url, { headers: { 'User-Agent': 'pinscribe-updater' } }, res => {
      const status = res.statusCode ?? 0
      if ([301, 302, 307, 308].includes(status) && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject)
      }
      resolve(res)
    }).on('error', reject)
  })
}

async function fetchText(url: string): Promise<string> {
  const res = await httpsGet(url)
  return new Promise((resolve, reject) => {
    let data = ''
    res.on('data', (chunk: Buffer) => { data += chunk })
    res.on('end', () => resolve(data))
    res.on('error', reject)
  })
}

function downloadFile(url: string, destPath: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await httpsGet(url)
      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let received = 0
      const file = createWriteStream(destPath)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        file.write(chunk)
        if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100))
      })
      res.on('end', () => { file.end(); resolve() })
      res.on('error', (err: Error) => { file.destroy(); reject(err) })
    } catch (e) { reject(e) }
  })
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => err ? reject(err) : resolve(stdout || ''))
  })
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

async function checkForUpdates(manual: boolean): Promise<void> {
  if (manual) setTrayMenu('checking')
  try {
    const yml = await fetchText(YML_URL)
    const versionMatch = yml.match(/^version:\s*(.+)$/m)
    if (!versionMatch) throw new Error('Could not parse version from update manifest')
    const latest = versionMatch[1].trim()
    if (compareVersions(latest, app.getVersion()) <= 0) {
      if (manual) {
        setTrayMenu('uptodate')
        win?.webContents.send('update-not-available')
      } else {
        setTrayMenu('idle')
      }
      return
    }
    const pathMatch = yml.match(/^path:\s*(.+\.dmg)/m)
    if (!pathMatch) throw new Error('No DMG found in update manifest')
    const dmgName = pathMatch[1].trim()
    const dmgUrl = `https://github.com/trmp10/pinscribe/releases/latest/download/${encodeURIComponent(dmgName)}`
    if (manual) {
      setTrayMenu('downloading')
      win?.webContents.send('update-available', latest)
    }
    await downloadAndInstall(dmgUrl, manual)
  } catch (e) {
    setTrayMenu('idle')
    if (manual) win?.webContents.send('update-error', (e as Error).message)
  }
}

async function downloadAndInstall(dmgUrl: string, manual: boolean): Promise<void> {
  const tmpDmg = join(tmpdir(), `pinscribe-update-${Date.now()}.dmg`)
  const mountPoint = join(tmpdir(), `pinscribe-mount-${Date.now()}`)
  try {
    await downloadFile(dmgUrl, tmpDmg, pct => {
      if (manual) win?.webContents.send('update-progress', pct)
    })
    await execFileAsync('hdiutil', ['attach', '-nobrowse', '-quiet', '-mountpoint', mountPoint, tmpDmg])
    await execFileAsync('ditto', [join(mountPoint, 'PinScribe.app'), '/Applications/PinScribe.app'])
    await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {})
    try { unlinkSync(tmpDmg) } catch {}
    setTrayMenu('ready')
    win?.webContents.send('update-downloaded')
  } catch (e) {
    try { unlinkSync(tmpDmg) } catch {}
    execFile('hdiutil', ['detach', mountPoint, '-quiet'], () => {})
    setTrayMenu('idle')
    if (manual) win?.webContents.send('update-error', (e as Error).message)
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'PinScribe',
    icon: join(__dirname, '../../resources/icon.icns'),
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => win?.show())
  win.on('close', e => { if (!allowQuit) { e.preventDefault(); win?.hide() } })
  win.on('closed', () => { win = null })
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function setTrayMenu(state: string): void {
  if (!tray) return
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'Open PinScribe', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
  ]

  if (state === 'downloading') {
    template.push({ label: 'Downloading update…', enabled: false })
  } else if (state === 'updating') {
    template.push({ label: 'Installing update…', enabled: false })
  } else if (state === 'ready') {
    template.push({ label: 'Restart to Update', click: () => { allowQuit = true; app.relaunch(); app.exit() } })
  } else if (state === 'uptodate') {
    template.push({ label: `Up to date — v${app.getVersion()}`, enabled: false })
    template.push({ label: 'Check for Updates', click: () => checkForUpdates(true) })
  } else if (state === 'checking') {
    template.push({ label: 'Checking for updates…', enabled: false })
  } else {
    template.push({ label: 'Check for Updates', click: () => checkForUpdates(true) })
  }

  template.push({ type: 'separator' }, { label: 'Quit', click: () => app.exit() })
  trayContextMenu = Menu.buildFromTemplate(template)
  tray.setContextMenu(null)
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray-icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('PinScribe')
  tray.on('click', toggleWindow)
  tray.on('right-click', () => { if (trayContextMenu) tray?.popUpContextMenu(trayContextMenu) })
  setTrayMenu('idle')
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('hide-window', () => win?.hide())

ipcMain.on('copy-to-clipboard', (_e, dataUrl: string) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
})

ipcMain.handle('paste-image', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return img.toDataURL()
})

ipcMain.on('check-for-updates', () => checkForUpdates(true))
ipcMain.on('install-update', () => { allowQuit = true; app.relaunch(); app.exit() })

// ─── Save PNG ─────────────────────────────────────────────────────────────────

ipcMain.handle('save-png', async (_e, dataUrl: string) => {
  if (!win) return false
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Save as PNG',
    defaultPath: 'annotation.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  })
  if (canceled || !filePath) return false
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return true
})

// ─── Auto-save ────────────────────────────────────────────────────────────────

function autosavesDir(): string {
  return join(app.getPath('userData'), 'autosaves')
}

function ensureAutosavesDir(): void {
  const dir = autosavesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

ipcMain.handle('auto-save', (_e, data: { sessionId: string; savedAt: string; thumbnail: string }) => {
  try {
    ensureAutosavesDir()
    const file = join(autosavesDir(), `${data.sessionId}.json`)
    writeFileSync(file, JSON.stringify(data), 'utf8')
    const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000
    const files = readdirSync(autosavesDir())
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, mtime: statSync(join(autosavesDir(), f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    files.forEach((f, i) => {
      if (i >= 30 || f.mtime < cutoff) {
        try { unlinkSync(join(autosavesDir(), f.name)) } catch {}
      }
    })
    return true
  } catch { return false }
})

ipcMain.handle('get-autosaves', () => {
  try {
    ensureAutosavesDir()
    const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000
    return readdirSync(autosavesDir())
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw = readFileSync(join(autosavesDir(), f), 'utf8')
          const d = JSON.parse(raw)
          return { path: join(autosavesDir(), f), thumbnail: d.thumbnail, savedAt: d.savedAt, sessionId: d.sessionId }
        } catch { return null }
      })
      .filter(Boolean)
      .filter((item: any) => new Date(item.savedAt).getTime() > cutoff)
      .sort((a: any, b: any) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      .slice(0, 30)
  } catch { return [] }
})

ipcMain.handle('open-autosave', (_e, filePath: string) => {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) } catch { return null }
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.dock?.hide()

app.whenReady().then(() => {
  createWindow()
  createTray()
  globalShortcut.register('CommandOrControl+Shift+P', toggleWindow)
  setTimeout(() => checkForUpdates(false), 3000)
})

app.on('window-all-closed', () => { if (allowQuit) app.quit() })
app.on('will-quit', () => globalShortcut.unregisterAll())
