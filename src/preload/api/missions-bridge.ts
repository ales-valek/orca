import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const missionsApi = {
  list: () => ipcRenderer.invoke('missions:list'),
  create: (args) => ipcRenderer.invoke('missions:create', args),
  update: (args) => ipcRenderer.invoke('missions:update', args),
  delete: (args) => ipcRenderer.invoke('missions:delete', args),
  addMembers: (args) => ipcRenderer.invoke('missions:addMembers', args),
  removeMember: (args) => ipcRenderer.invoke('missions:removeMember', args),
  recreateMemberWorktree: (args) => ipcRenderer.invoke('missions:recreateMemberWorktree', args)
} satisfies PreloadApi['missions']
