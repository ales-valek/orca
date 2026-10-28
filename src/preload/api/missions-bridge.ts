import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const missionsApi = {
  list: () => ipcRenderer.invoke('missions:list'),
  create: (args) => ipcRenderer.invoke('missions:create', args),
  update: (args) => ipcRenderer.invoke('missions:update', args),
  delete: (args) => ipcRenderer.invoke('missions:delete', args),
  addMembers: (args) => ipcRenderer.invoke('missions:addMembers', args),
  removeMember: (args) => ipcRenderer.invoke('missions:removeMember', args),
  recreateMemberWorktree: (args) => ipcRenderer.invoke('missions:recreateMemberWorktree', args),
  recreateSlotWorktree: (args) => ipcRenderer.invoke('missions:recreateSlotWorktree', args),
  ensureSession: (args) => ipcRenderer.invoke('missions:ensureSession', args),
  inspectStacks: (args) => ipcRenderer.invoke('missions:inspectStacks', args),
  addTask: (args) => ipcRenderer.invoke('missions:addTask', args),
  removeTask: (args) => ipcRenderer.invoke('missions:removeTask', args),
  restack: (args) => ipcRenderer.invoke('missions:restack', args),
  absorb: (args) => ipcRenderer.invoke('missions:absorb', args),
  createStackPullRequests: (args) => ipcRenderer.invoke('missions:createStackPullRequests', args),
  pushStack: (args) => ipcRenderer.invoke('missions:pushStack', args),
  onStacksChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: { missionId: string }) =>
      callback(event)
    ipcRenderer.on('missions:stacksChanged', listener)
    return () => ipcRenderer.removeListener('missions:stacksChanged', listener)
  }
} satisfies PreloadApi['missions']
