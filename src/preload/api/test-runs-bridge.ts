import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const testRunsApi = {
  listRuns: (args) => ipcRenderer.invoke('testRuns:listRuns', args),
  getLatestResults: (args) => ipcRenderer.invoke('testRuns:getLatestResults', args),
  getHistory: (args) => ipcRenderer.invoke('testRuns:getHistory', args),
  getArtifactUrl: (args) => ipcRenderer.invoke('testRuns:getArtifactUrl', args),
  openTrace: (args) => ipcRenderer.invoke('testRuns:openTrace', args),
  onChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('testRuns:changed', listener)
    return () => ipcRenderer.removeListener('testRuns:changed', listener)
  },
  listTargets: () => ipcRenderer.invoke('testRuns:listTargets'),
  listSources: () => ipcRenderer.invoke('testRuns:listSources'),
  launch: (request) => ipcRenderer.invoke('testRuns:launch', request),
  stopLaunch: (args) => ipcRenderer.invoke('testRuns:stopLaunch', args),
  listLaunches: () => ipcRenderer.invoke('testRuns:listLaunches'),
  readLaunchLog: (args) => ipcRenderer.invoke('testRuns:readLaunchLog', args),
  onLaunchesChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('testRuns:launchesChanged', listener)
    return () => ipcRenderer.removeListener('testRuns:launchesChanged', listener)
  }
} satisfies PreloadApi['testRuns']
