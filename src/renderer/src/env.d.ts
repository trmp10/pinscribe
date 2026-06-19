interface Window {
  api: {
    copyToClipboard: (dataUrl: string) => void
    pasteImage: () => Promise<string | null>
    hideWindow: () => void
    savePng: (dataUrl: string) => Promise<boolean>
    autoSave: (data: object) => Promise<boolean>
    getAutosaves: () => Promise<object[]>
    openAutosave: (filePath: string) => Promise<object | null>
    checkForUpdates: () => void
    installUpdate: () => void
    onUpdateAvailable: (cb: (version: string) => void) => void
    onUpdateProgress: (cb: (pct: number) => void) => void
    onUpdateDownloaded: (cb: () => void) => void
    onUpdateNotAvailable: (cb: () => void) => void
    onUpdateError: (cb: (msg: string) => void) => void
    onUpdateStatus: (cb: (data: { state: string; version?: string; percent?: number }) => void) => void
    restartForUpdate: () => void
  }
}
