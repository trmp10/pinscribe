interface Window {
  api: {
    copyToClipboard: (dataUrl: string) => void
    pasteImage: () => Promise<string | null>
    hideWindow: () => void
    savePng: (dataUrl: string) => Promise<boolean>
    autoSave: (data: object) => Promise<boolean>
    getAutosaves: () => Promise<object[]>
    openAutosave: (filePath: string) => Promise<object | null>
    deleteAutosave: (filePath: string) => Promise<boolean>
    restartForUpdate: () => void
    onUpdateStatus: (cb: (data: { state: string; version?: string; percent?: number }) => void) => void
  }
}
