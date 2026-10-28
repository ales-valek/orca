import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'

export const HulyConnectParams = z.object({
  serverUrl: requiredString('Missing Huly server URL'),
  workspace: requiredString('Missing Huly workspace'),
  token: requiredString('Missing Huly token')
})

export const HulyProjectParams = z.object({
  project: requiredString('Missing Huly project')
})

/** Huly issue identifier -> Orca repo id. */
export const HulyRepoOverrides = z.record(z.string(), z.string()).optional()

/** Orca repo id -> issue identifiers in stack order. */
export const HulyOrderOverrides = z.record(z.string(), z.array(z.string())).optional()

export const HulyMilestonePlanParams = z.object({
  project: requiredString('Missing Huly project'),
  milestoneId: requiredString('Missing Huly milestone'),
  repoOverrides: HulyRepoOverrides,
  orderOverrides: HulyOrderOverrides
})
