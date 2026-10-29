import { readFile, stat } from 'node:fs/promises'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { DEV_ENV_STEP_IDS, type DevEnvStepId } from '../../../shared/dev-env/dev-env-types'
import { DevEnvOperations } from '../../dev-env/dev-env-operations'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { eraseRpcMethods } from '../../runtime/rpc/core'
import { DEV_ENV_METHODS } from '../../runtime/rpc/methods/dev-env'
import { setRemovedWorktreeListener } from '../../worktree-removal-process-cleanup'

const LOG_TAIL_BYTES = 200 * 1024

let operations: DevEnvOperations | null = null
let notifyWindow: BrowserWindow | null = null

function getStringArg(args: unknown, key: string): string {
  const value = typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key}`)
  }
  return value
}

function isStepId(value: string): value is DevEnvStepId {
  return DEV_ENV_STEP_IDS.some((step) => step === value)
}

async function readLogTail(path: string): Promise<string> {
  try {
    const { size } = await stat(path)
    const text = await readFile(path, 'utf8')
    return size > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text
  } catch {
    return ''
  }
}

/** One DevEnvOperations per app: it owns the hostname proxy port and the service terminals. */
function getOperations(store: Store, runtime: OrcaRuntimeService): DevEnvOperations {
  operations ??= new DevEnvOperations({
    store,
    getSettings: () => store.getSettings(),
    userDataDir: app.getPath('userData'),
    terminals: runtime.getDevEnvTerminalPort(),
    notify: (devEnvId) => {
      if (notifyWindow && !notifyWindow.isDestroyed()) {
        notifyWindow.webContents.send('devEnv:changed', { devEnvId })
      }
    }
  })
  return operations
}

export function registerDevEnvHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  notifyWindow = mainWindow
  runtime.attachDevEnvOperations(() => getOperations(store, runtime))
  const devEnvs = (): DevEnvOperations => runtime.getDevEnvOperations()
  setRemovedWorktreeListener(() => void devEnvs().reconcileWorktrees())

  for (const method of eraseRpcMethods(DEV_ENV_METHODS)) {
    const channel = `devEnv:${method.name.slice('devenv.'.length)}`
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) =>
      method.handler(method.params ? method.params.parse(args) : undefined, { runtime })
    )
  }

  // Why: secrets and logs stay off RPC so neither the CLI nor paired clients can read them.
  const desktopOnly: Record<string, (args: unknown) => unknown> = {
    'devEnv:revealSecret': (args) =>
      devEnvs().revealSecretValue(
        devEnvs().resolveId(getStringArg(args, 'env')),
        getStringArg(args, 'slot'),
        getStringArg(args, 'path'),
        getStringArg(args, 'key')
      ),
    'devEnv:revealCredential': (args) =>
      devEnvs().revealCredentialPassword(
        devEnvs().resolveId(getStringArg(args, 'env')),
        getStringArg(args, 'label')
      ),
    'devEnv:secretsList': () => devEnvs().secrets.list(),
    'devEnv:secretSet': (args) =>
      devEnvs().secrets.set(getStringArg(args, 'name'), getStringArg(args, 'value')),
    'devEnv:secretDelete': (args) => devEnvs().secrets.delete(getStringArg(args, 'name')),
    'devEnv:readLog': (args) => {
      const step = getStringArg(args, 'step')
      if (step === 'infra-shared') {
        return readLogTail(devEnvs().getInfraLogPath())
      }
      if (!isStepId(step)) {
        throw new Error(`Unknown step ${step}`)
      }
      return readLogTail(devEnvs().getLogPath(devEnvs().resolveId(getStringArg(args, 'env')), step))
    }
  }
  for (const [channel, handler] of Object.entries(desktopOnly)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) => handler(args))
  }
}
