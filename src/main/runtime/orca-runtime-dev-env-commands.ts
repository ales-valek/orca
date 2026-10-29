import type { DevEnvTerminalPort } from '../dev-env/dev-env-services'
import type { DevEnvOperations } from '../dev-env/dev-env-operations'
import { OrcaRuntimeWithMissionOwnership } from './orca-runtime-mission-ownership'

/** POSIX shells exit with the service, so a crash shows as an exited terminal with its code. */
function getServiceShellCommand(command: string): string {
  return process.platform === 'win32' ? command : `${command}; exit $?`
}

export abstract class OrcaRuntimeWithDevEnvCommands extends OrcaRuntimeWithMissionOwnership {
  private devEnvOperations: DevEnvOperations | null = null
  private devEnvOperationsFactory: (() => DevEnvOperations) | null = null

  /** Built on first use so attaching a window never touches app paths or binds the proxy. */
  attachDevEnvOperations(factory: () => DevEnvOperations): void {
    this.devEnvOperationsFactory = factory
  }

  getDevEnvOperations(): DevEnvOperations {
    if (!this.devEnvOperations) {
      if (!this.devEnvOperationsFactory) {
        // Why: environments own terminals and a hostname proxy that only the desktop app runs.
        throw new Error('Dev Environments are only available in the Orca desktop app')
      }
      this.devEnvOperations = this.devEnvOperationsFactory()
    }
    return this.devEnvOperations
  }

  /** Service terminals for Dev Environments, created in the background without stealing focus. */
  getDevEnvTerminalPort(): DevEnvTerminalPort {
    return {
      create: async (worktreeId, opts) => {
        const result = await this.createTerminal(`id:${worktreeId}`, {
          command: getServiceShellCommand(opts.command),
          title: opts.title,
          cwd: opts.cwd,
          focus: false,
          activate: false
        })
        return { handle: result.handle }
      },
      isAlive: async (handle) => {
        try {
          const { exitCause } = await this.showTerminal(handle)
          if (!exitCause) {
            return { alive: true, exitCode: null }
          }
          return { alive: false, exitCode: exitCause.kind === 'exited' ? exitCause.exitCode : null }
        } catch {
          return { alive: false, exitCode: null }
        }
      },
      close: async (handle) => {
        await this.closeTerminal(handle).catch(() => {})
      },
      findByTitle: async (worktreeId, title) => {
        const { terminals } = await this.listTerminals(`id:${worktreeId}`)
        return (
          terminals.find((terminal) => terminal.title === title && !terminal.exitCause)?.handle ??
          null
        )
      }
    }
  }
}
