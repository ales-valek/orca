import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const devToolsApi = {
  list: () => ipcRenderer.invoke('devTools:list'),
  open: (args) => ipcRenderer.invoke('devTools:open', args),
  stop: (args) => ipcRenderer.invoke('devTools:stop', args),
  restart: (args) => ipcRenderer.invoke('devTools:restart', args),
  readLog: () => ipcRenderer.invoke('devTools:readLog')
} satisfies PreloadApi['devTools']
