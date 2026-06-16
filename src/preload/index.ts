import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  copyToClipboard: (dataUrl: string) => ipcRenderer.send('copy-to-clipboard', dataUrl)
})
