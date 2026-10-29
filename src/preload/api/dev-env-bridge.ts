import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PreloadApi } from '../api-types'

export const devEnvApi = {
  list: () => ipcRenderer.invoke('devEnv:list'),
  show: (args) => ipcRenderer.invoke('devEnv:show', args),
  setup: (args) => ipcRenderer.invoke('devEnv:setup', args),
  up: (args) => ipcRenderer.invoke('devEnv:up', args),
  down: (args) => ipcRenderer.invoke('devEnv:down', args),
  restart: (args) => ipcRenderer.invoke('devEnv:restart', args),
  env: (args) => ipcRenderer.invoke('devEnv:env', args),
  seed: (args) => ipcRenderer.invoke('devEnv:seed', args),
  reset: (args) => ipcRenderer.invoke('devEnv:reset', args),
  bind: (args) => ipcRenderer.invoke('devEnv:bind', args),
  pinSlot: (args) => ipcRenderer.invoke('devEnv:pinSlot', args),
  create: (args) => ipcRenderer.invoke('devEnv:create', args),
  delete: (args) => ipcRenderer.invoke('devEnv:delete', args),
  infraStatus: () => ipcRenderer.invoke('devEnv:infraStatus'),
  infraUp: (args) => ipcRenderer.invoke('devEnv:infraUp', args),
  infraDown: (args) => ipcRenderer.invoke('devEnv:infraDown', args),
  revealSecret: (args) => ipcRenderer.invoke('devEnv:revealSecret', args),
  revealCredential: (args) => ipcRenderer.invoke('devEnv:revealCredential', args),
  bindRemote: (args) => ipcRenderer.invoke('devEnv:bindRemote', args),
  secretsList: () => ipcRenderer.invoke('devEnv:secretsList'),
  secretSet: (args) => ipcRenderer.invoke('devEnv:secretSet', args),
  secretDelete: (args) => ipcRenderer.invoke('devEnv:secretDelete', args),
  readLog: (args) => ipcRenderer.invoke('devEnv:readLog', args),
  onChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, event: { devEnvId: string }): void =>
      callback(event)
    ipcRenderer.on('devEnv:changed', listener)
    return () => ipcRenderer.removeListener('devEnv:changed', listener)
  }
} satisfies PreloadApi['devEnv']
