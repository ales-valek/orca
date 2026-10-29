import type {
  DevEnvDetail,
  DevEnvEnvFileView,
  DevEnvInfraState,
  DevEnvSnapshot,
  DevEnvSummary
} from '../../shared/dev-env/dev-env-types'
import {
  formatDevEnvFiles,
  formatDevEnvInfra,
  formatDevEnvList,
  formatDevEnvRun,
  formatDevEnvShow,
  formatDevEnvSnapshots
} from '../devenv-format'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime/types'

type RunResult = { started: string[]; errors: string[] }

function env(flags: Map<string, string | boolean>): string {
  return getRequiredStringFlag(flags, 'env')
}

export const DEVENV_HANDLERS: Record<string, CommandHandler> = {
  'devenv list': async ({ client, json }) => {
    const result = await client.call<{ envs: DevEnvSummary[] }>('devenv.list')
    printResult(result, json, formatDevEnvList)
  },
  'devenv show': async ({ flags, client, json }) => {
    const result = await client.call<DevEnvDetail>('devenv.show', { env: env(flags) })
    printResult(result, json, formatDevEnvShow)
  },
  'devenv setup': async ({ flags, client, json }) => {
    const result = await client.call<{ started: boolean }>('devenv.setup', {
      env: env(flags),
      step: getOptionalStringFlag(flags, 'step'),
      slot: getOptionalStringFlag(flags, 'slot'),
      ...(flags.get('seed') === true ? { seed: true } : {})
    })
    printResult(result, json, () => 'Setup started; follow it with `orca devenv show`.')
  },
  'devenv up': async ({ flags, client, json }) => {
    const result = await client.call<RunResult>('devenv.up', {
      env: env(flags),
      service: getOptionalStringFlag(flags, 'service')
    })
    printResult(result, json, formatDevEnvRun)
  },
  'devenv down': async ({ flags, client, json }) => {
    const result = await client.call<{ stopped: boolean }>('devenv.down', {
      env: env(flags),
      service: getOptionalStringFlag(flags, 'service')
    })
    printResult(result, json, () => 'Stopped.')
  },
  'devenv restart': async ({ flags, client, json }) => {
    const result = await client.call<RunResult>('devenv.restart', {
      env: env(flags),
      service: getRequiredStringFlag(flags, 'service')
    })
    printResult(result, json, formatDevEnvRun)
  },
  'devenv url': async ({ flags, client, json }) => {
    const result = await client.call<{ url: string | null }>('devenv.url', {
      env: env(flags),
      service: getRequiredStringFlag(flags, 'service')
    })
    printResult(result, json, (value) => value.url ?? '')
  },
  'devenv env': async ({ flags, client, json }) => {
    const result = await client.call<{ files: DevEnvEnvFileView[] }>('devenv.env', {
      env: env(flags),
      file: getOptionalStringFlag(flags, 'file')
    })
    printResult(result, json, formatDevEnvFiles)
  },
  'devenv seed': async ({ flags, client, json }) => {
    const result = await client.call<{ started: boolean }>('devenv.seed', { env: env(flags) })
    printResult(result, json, () => 'Seed started.')
  },
  'devenv reset': async ({ flags, client, json }) => {
    if (flags.get('yes') !== true) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Resetting drops this environment data; pass --yes to confirm'
      )
    }
    const result = await client.call<{ started: boolean }>('devenv.reset', {
      env: env(flags),
      reseed: flags.get('reseed') === true,
      confirm: true
    })
    printResult(result, json, () => 'Data dropped; provisioning started.')
  },
  'devenv mode': async ({ flags, client, json }) => {
    const mode = getRequiredStringFlag(flags, 'mode')
    if (mode !== 'dev' && mode !== 'prod') {
      throw new RuntimeClientError('invalid_argument', 'Expected mode dev or prod')
    }
    const result = await client.call<{ mode: string }>('devenv.mode', { env: env(flags), mode })
    printResult(result, json, () => `Services stopped; the next up runs ${mode} commands.`)
  },
  'devenv snapshots': async ({ flags, client, json }) => {
    const result = await client.call<{ snapshots: DevEnvSnapshot[] }>('devenv.snapshots', {
      env: env(flags)
    })
    printResult(result, json, formatDevEnvSnapshots)
  },
  'devenv snapshot': async ({ flags, client, json }) => {
    const result = await client.call<DevEnvSnapshot>('devenv.snapshot', {
      env: env(flags),
      name: getRequiredStringFlag(flags, 'name')
    })
    printResult(result, json, (snapshot) => `Saved snapshot ${snapshot.name}.`)
  },
  'devenv restore': async ({ flags, client, json }) => {
    if (flags.get('yes') !== true) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Restoring replaces this environment data; pass --yes to confirm'
      )
    }
    const result = await client.call<{ restored: boolean }>('devenv.restore', {
      env: env(flags),
      name: getRequiredStringFlag(flags, 'name'),
      confirm: true
    })
    printResult(result, json, () => 'Restored; services that were up are starting again.')
  },
  'devenv bind': async ({ flags, client, json }) => {
    const provider = getRequiredStringFlag(flags, 'provider')
    const result = await client.call<{ id: string }>('devenv.bind', {
      env: env(flags),
      dependency: getRequiredStringFlag(flags, 'dependency'),
      provider: provider === 'none' ? null : provider
    })
    printResult(result, json, () => 'Bound; env files are being rendered again.')
  },
  'devenv create': async ({ flags, client, json }) => {
    const mission = getOptionalStringFlag(flags, 'mission')
    const worktree = getOptionalStringFlag(flags, 'worktree')
    if (Boolean(mission) === Boolean(worktree)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass exactly one of --mission or --worktree'
      )
    }
    const binds = getRepeatedStringFlag(flags, 'bind')
    const bindings: Record<string, string> = {}
    for (const bind of binds) {
      const split = bind.indexOf('=')
      if (split < 1 || split === bind.length - 1) {
        throw new RuntimeClientError(
          'invalid_argument',
          `Invalid --bind "${bind}"; expected <service>=<env>`
        )
      }
      bindings[bind.slice(0, split)] = bind.slice(split + 1)
    }
    const result = await client.call<{ id: string; key: string; name: string }>('devenv.create', {
      mission,
      worktree,
      template: getRequiredStringFlag(flags, 'template'),
      bindings: binds.length > 0 ? bindings : undefined
    })
    printResult(result, json, (env) => `Created ${env.name} (${env.key}); setup is running.`)
  },
  'devenv infra': async ({ flags, client, json }) => {
    const action = getRequiredStringFlag(flags, 'action')
    const service = getOptionalStringFlag(flags, 'service')
    if (action === 'status') {
      const result = await client.call<{ services: DevEnvInfraState[]; error?: string }>(
        'devenv.infraStatus'
      )
      printResult(result, json, formatDevEnvInfra)
      return
    }
    if (action !== 'up' && action !== 'down') {
      throw new RuntimeClientError('invalid_argument', 'Expected infra status, up or down')
    }
    const result = await client.call<{ ok: boolean; error?: string }>(
      action === 'up' ? 'devenv.infraUp' : 'devenv.infraDown',
      { service }
    )
    printResult(result, json, (value) => (value.ok ? 'Done.' : (value.error ?? 'Failed.')))
  }
}
