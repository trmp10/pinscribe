import { app, BrowserWindow, ipcMain, clipboard, nativeImage } from 'electron'
import { join } from 'path'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'PinScribe',
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

  win.on('closed', () => { win = null })
}

ipcMain.on('copy-to-clipboard', (_e, dataUrl: string) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (!win) createWindow() })
