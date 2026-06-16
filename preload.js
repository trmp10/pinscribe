const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  copyToClipboard: (dataUrl) => ipcRenderer.send('copy-to-clipboard', dataUrl),
  pasteImage: () => ipcRenderer.invoke('paste-image'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  restartForUpdate: () => ipcRenderer.send('restart-for-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data))
})
