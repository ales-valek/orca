import { z } from 'zod'
import { OptionalString, requiredString } from './rpc-param-primitives'

const EnvSelector = requiredString('Missing Dev Environment')

export const DevEnvSelectorParams = z.object({ env: EnvSelector })

export const DevEnvSetupParams = z.object({
  env: EnvSelector,
  step: z.enum(['ports', 'env', 'install', 'infra', 'data', 'seed']).optional(),
  slot: OptionalString,
  seed: z.boolean().optional()
})

export const DevEnvServiceParams = z.object({ env: EnvSelector, service: OptionalString })

export const DevEnvRequiredServiceParams = z.object({
  env: EnvSelector,
  service: requiredString('Missing service')
})

export const DevEnvFileParams = z.object({ env: EnvSelector, file: OptionalString })

/** Dropping data needs an explicit confirmation from the caller (UI dialog or `--yes`). */
export const DevEnvResetParams = z.object({
  env: EnvSelector,
  reseed: z.boolean().optional(),
  confirm: z.literal(true, {
    message: 'Resetting data requires confirm: true (orca devenv reset --yes)'
  })
})

/** Local providers only; remote tiers are bound from the desktop UI in a later delivery. */
export const DevEnvBindParams = z.object({
  env: EnvSelector,
  dependency: requiredString('Missing dependency'),
  provider: z.string().min(1).nullable()
})

export const DevEnvPinSlotParams = z.object({
  env: EnvSelector,
  slot: requiredString('Missing slot'),
  worktree: z.string().min(1).nullable()
})

export const DevEnvCreateParams = z
  .object({
    mission: OptionalString,
    worktree: OptionalString,
    template: requiredString('Missing Dev Environment template'),
    bindings: z.record(z.string(), z.string()).optional()
  })
  .refine((params) => Boolean(params.mission) !== Boolean(params.worktree), {
    message: 'Pass exactly one of mission or worktree'
  })

export const DevEnvDeleteParams = z.object({ env: EnvSelector, dropData: z.boolean() })

const SnapshotName = requiredString('Missing snapshot name')

export const DevEnvSnapshotParams = z.object({ env: EnvSelector, name: SnapshotName })

/** Restore and delete overwrite or drop data, so the caller confirms (UI dialog or `--yes`). */
export const DevEnvConfirmedSnapshotParams = z.object({
  env: EnvSelector,
  name: SnapshotName,
  confirm: z.literal(true, {
    message: 'This replaces data and requires confirm: true (orca devenv restore --yes)'
  })
})

export const DevEnvModeParams = z.object({ env: EnvSelector, mode: z.enum(['dev', 'prod']) })

export const DevEnvInfraParams = z.object({ service: OptionalString })
