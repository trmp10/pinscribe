const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require('electron')
const path = require('path')

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'PinScribe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  win.loadFile('index.html')
  win.on('closed', () => { win = null })
}

ipcMain.on('copy-to-clipboard', (_e, dataUrl) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
})

ipcMain.handle('paste-image', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return img.toDataURL()
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (!win) createWindow() })
