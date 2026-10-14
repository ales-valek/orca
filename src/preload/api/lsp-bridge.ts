import { ipcRenderer } from 'electron'
import type {
  LspChangeDocumentArgs,
  LspCloseDocumentArgs,
  LspDiagnosticsPayload,
  LspOpenDocumentArgs,
  LspRequestArgs
} from '../../shared/lsp-types'
import type { PreloadApi } from '../api-types'

export const lspApi = {
  openDocument: (args: LspOpenDocumentArgs) => ipcRenderer.invoke('lsp:openDocument', args),
  changeDocument: (args: LspChangeDocumentArgs) => ipcRenderer.invoke('lsp:changeDocument', args),
  closeDocument: (args: LspCloseDocumentArgs) => ipcRenderer.invoke('lsp:closeDocument', args),
  request: (args: LspRequestArgs) => ipcRenderer.invoke('lsp:request', args),
  onDiagnostics: (callback: (payload: LspDiagnosticsPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LspDiagnosticsPayload): void =>
      callback(payload)
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  }
} satisfies PreloadApi['lsp']
