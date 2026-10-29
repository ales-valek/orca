import { readFile, stat } from 'node:fs/promises'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
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

const Text = z.string().min(1)
const RevealSecretArgs = z.object({ env: Text, slot: Text, path: Text, key: Text })
const RevealCredentialArgs = z.object({ env: Text, label: Text })
const SecretSetArgs = z.object({ name: Text, value: Text })
const SecretNameArgs = z.object({ name: Text })
const ReadLogArgs = z.object({ env: Text.optional(), step: Text })

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
  // Why: service terminals outlive Orca in the daemon; their hostnames must answer again without a click.
  void Promise.resolve()
    .then(() => devEnvs().restore())
    .catch((error: unknown) => console.error('[dev-env] restore failed', error))

  for (const method of eraseRpcMethods(DEV_ENV_METHODS)) {
    const channel = `devEnv:${method.name.slice('devenv.'.length)}`
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) =>
      method.handler(method.params ? method.params.parse(args) : undefined, { runtime })
    )
  }

  // Why: secrets and logs stay off RPC so neither the CLI nor paired clients can read them.
  const desktopOnly: Record<string, (args: unknown) => unknown> = {
    'devEnv:revealSecret': (raw) => {
      const args = RevealSecretArgs.parse(raw)
      return devEnvs().revealSecretValue(
        devEnvs().resolveId(args.env),
        args.slot,
        args.path,
        args.key
      )
    },
    'devEnv:revealCredential': (raw) => {
      const args = RevealCredentialArgs.parse(raw)
      return devEnvs().revealCredentialPassword(devEnvs().resolveId(args.env), args.label)
    },
    'devEnv:secretsList': () => devEnvs().secrets.list(),
    'devEnv:secretSet': (raw) => {
      const args = SecretSetArgs.parse(raw)
      devEnvs().secrets.set(args.name, args.value)
    },
    'devEnv:secretDelete': (raw) => devEnvs().secrets.delete(SecretNameArgs.parse(raw).name),
    'devEnv:readLog': (raw) => {
      const args = ReadLogArgs.parse(raw)
      if (args.step === 'infra-shared') {
        return readLogTail(devEnvs().getInfraLogPath())
      }
      if (!isStepId(args.step) || !args.env) {
        throw new Error(`Unknown step ${args.step}`)
      }
      return readLogTail(devEnvs().getLogPath(devEnvs().resolveId(args.env), args.step))
    }
  }
  for (const [channel, handler] of Object.entries(desktopOnly)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, args: unknown) => handler(args))
  }
}
