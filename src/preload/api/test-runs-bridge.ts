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
  }
} satisfies PreloadApi['testRuns']
