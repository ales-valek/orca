import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hulyApi = {
  connect: (args) => ipcRenderer.invoke('huly:connect', args),
  disconnect: () => ipcRenderer.invoke('huly:disconnect'),
  status: () => ipcRenderer.invoke('huly:status'),
  listProjects: () => ipcRenderer.invoke('huly:listProjects'),
  listMilestones: (args) => ipcRenderer.invoke('huly:listMilestones', args),
  listStatuses: (args) => ipcRenderer.invoke('huly:listStatuses', args),
  listComponents: (args) => ipcRenderer.invoke('huly:listComponents', args),
  getMilestonePlan: (args) => ipcRenderer.invoke('huly:getMilestonePlan', args),
  createMission: (args) => ipcRenderer.invoke('huly:createMission', args),
  refreshMission: (args) => ipcRenderer.invoke('huly:refreshMission', args)
} satisfies PreloadApi['huly']
