const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  copyToClipboard: (dataUrl) => ipcRenderer.send('copy-to-clipboard', dataUrl),
  pasteImage: () => ipcRenderer.invoke('paste-image')
})
