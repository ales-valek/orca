import { ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { eraseRpcMethods, type RpcMethod } from '../../runtime/rpc/core'
import { HULY_METHODS } from '../../runtime/rpc/methods/huly'
import { MISSION_METHODS } from '../../runtime/rpc/methods/missions'

// Mission import and refresh run in the runtime, so the desktop reaches them beside huly.*.
const MISSION_HULY_CHANNELS: Record<string, string> = {
  'mission.createFromHuly': 'huly:createMission',
  'mission.refresh': 'huly:refreshMission'
}

function getIpcChannel(method: RpcMethod): string | null {
  if (method.name.startsWith('huly.')) {
    return `huly:${method.name.slice('huly.'.length)}`
  }
  return MISSION_HULY_CHANNELS[method.name] ?? null
}

/** Serves the Huly RPC methods over IPC so desktop and remote clients share one implementation. */
export function registerHulyHandlers(runtime: OrcaRuntimeService): void {
  const methods = eraseRpcMethods([...HULY_METHODS, ...MISSION_METHODS])
  for (const method of methods) {
    const channel = getIpcChannel(method)
    if (!channel) {
      continue
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) => {
      const params = method.params ? method.params.parse(args) : undefined
      return method.handler(params, { runtime })
    })
  }
}
