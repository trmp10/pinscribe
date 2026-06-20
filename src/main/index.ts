import { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog, net } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, createWriteStream } from 'fs'
import { tmpdir } from 'os'
import { execFile } from 'child_process'

let win: BrowserWindow | null = null
let allowQuit = false

// ─── Updater ──────────────────────────────────────────────────────────────────

const API_URL = 'https://api.github.com/repos/trmp10/pinscribe/releases/latest'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms))
  ])
}

async function fetchJson(url: string): Promise<any> {
  const res = await withTimeout(net.fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'PinScribe-Updater' } }), 8000)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function downloadFile(url: string, destPath: string, onProgress?: (pct: number) => void): Promise<void> {
  const res = await withTimeout(net.fetch(url, { headers: { 'User-Agent': 'PinScribe-Updater' } }), 120000)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = parseInt(res.headers.get('content-length') || '0', 10)
  let received = 0
  const file = createWriteStream(destPath)
  const reader = res.body!.getReader()
  const pump = async (): Promise<void> => {
    const { done, value } = await reader.read()
    if (done) { file.end(); return }
    received += value.length
    file.write(Buffer.from(value))
    if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100))
    return pump()
  }
  await pump()
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
  if (manual) win?.webContents.send('update-checking')
  try {
    const data = await fetchJson(API_URL)
    const latest = (data.tag_name as string).replace(/^v/, '')
    if (compareVersions(latest, app.getVersion()) <= 0) {
      if (manual) win?.webContents.send('update-not-available', app.getVersion())
      return
    }
    const asset = (data.assets as any[]).find((a: any) => a.name.endsWith('-arm64.dmg'))
    if (!asset) throw new Error('No DMG found in release assets')
    const dmgUrl: string = asset.browser_download_url
    win?.webContents.send('update-available', latest)
    await downloadAndInstall(dmgUrl, manual)
  } catch (e) {
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
    win?.webContents.send('update-downloaded')
  } catch (e) {
    try { unlinkSync(tmpDmg) } catch {}
    execFile('hdiutil', ['detach', mountPoint, '-quiet'], () => {})
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

  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.once('ready-to-show', () => { win?.show() })
  win.on('close', e => { if (!allowQuit) { e.preventDefault(); win?.hide() } })
  win.on('closed', () => { win = null })
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

ipcMain.handle('delete-autosave', (_e, filePath: string) => {
  try { unlinkSync(filePath); return true } catch { return false }
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()
  setTimeout(() => checkForUpdates(false), 3000)
})

app.on('activate', () => { win?.show(); win?.focus() })
app.on('before-quit', () => { allowQuit = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
