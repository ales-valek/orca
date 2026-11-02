import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { DEV_ENV_NAME_PATTERN } from '../../../shared/dev-env/dev-env-types'
import type { DevEnvOperations } from '../../dev-env/dev-env-operations'
import { DevTools } from '../../dev-env/dev-tools'
import type { Store } from '../../persistence/loading-store/store'
import { readDevEnvLogTail } from './dev-env-log-tail'

const ToolArgs = z.object({ name: z.string().regex(DEV_ENV_NAME_PATTERN) })

let devTools: DevTools | null = null

/** Desktop only: the Tools page embeds local web UIs, which neither the CLI nor mobile can use. */
export function registerDevToolsHandlers(
  store: Store,
  getOperations: () => DevEnvOperations
): void {
  const tools = (): DevTools => {
    devTools ??= new DevTools({
      dir: join(app.getPath('userData'), 'dev-envs', 'tools'),
      getSettings: () => store.getSettings(),
      infra: getOperations().infra
    })
    return devTools
  }
  const handlers: Record<string, (args: unknown) => unknown> = {
    'devTools:list': () => tools().list(),
    'devTools:open': (raw) => tools().open(ToolArgs.parse(raw).name),
    'devTools:stop': (raw) => tools().stop(ToolArgs.parse(raw).name),
    'devTools:restart': (raw) => tools().restart(ToolArgs.parse(raw).name),
    'devTools:readLog': () => readDevEnvLogTail(tools().getLogPath())
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) => handler(args))
  }
}
