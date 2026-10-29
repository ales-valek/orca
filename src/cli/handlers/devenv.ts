import type {
  DevEnvDetail,
  DevEnvEnvFileView,
  DevEnvInfraState,
  DevEnvSummary
} from '../../shared/dev-env/dev-env-types'
import {
  formatDevEnvFiles,
  formatDevEnvInfra,
  formatDevEnvList,
  formatDevEnvRun,
  formatDevEnvShow
} from '../devenv-format'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
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
  'devenv bind': async ({ flags, client, json }) => {
    const provider = getRequiredStringFlag(flags, 'provider')
    const result = await client.call<{ id: string }>('devenv.bind', {
      env: env(flags),
      dependency: getRequiredStringFlag(flags, 'dependency'),
      provider: provider === 'none' ? null : provider
    })
    printResult(result, json, () => 'Bound; env files are being rendered again.')
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
