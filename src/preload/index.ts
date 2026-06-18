import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  copyToClipboard: (dataUrl: string) => ipcRenderer.send('copy-to-clipboard', dataUrl),
  pasteImage: (): Promise<string | null> => ipcRenderer.invoke('paste-image'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  savePng: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('save-png', dataUrl),
  autoSave: (data: object): Promise<boolean> => ipcRenderer.invoke('auto-save', data),
  getAutosaves: (): Promise<object[]> => ipcRenderer.invoke('get-autosaves'),
  openAutosave: (filePath: string): Promise<object | null> => ipcRenderer.invoke('open-autosave', filePath),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (cb: (version: string) => void) => ipcRenderer.on('update-available', (_e, version) => cb(version)),
  onUpdateProgress: (cb: (pct: number) => void) => ipcRenderer.on('update-progress', (_e, pct) => cb(pct)),
  onUpdateDownloaded: (cb: () => void) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateNotAvailable: (cb: () => void) => ipcRenderer.on('update-not-available', () => cb()),
  onUpdateError: (cb: (msg: string) => void) => ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
})
