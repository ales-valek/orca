import type {
  DevEnv,
  DevEnvDetail,
  DevEnvEnvFileView,
  DevEnvInfraState,
  DevEnvStepId,
  DevEnvSummary
} from '../../shared/dev-env/dev-env-types'

type EnvArgs = { env: string }
type ServiceRunResult = { started: string[]; errors: string[] }

export type DevEnvApi = {
  list: () => Promise<{ envs: DevEnvSummary[] }>
  show: (args: EnvArgs) => Promise<DevEnvDetail>
  setup: (
    args: EnvArgs & { step?: DevEnvStepId; slot?: string; seed?: boolean }
  ) => Promise<{ started: boolean }>
  up: (args: EnvArgs & { service?: string }) => Promise<ServiceRunResult>
  down: (args: EnvArgs & { service?: string }) => Promise<{ stopped: boolean }>
  restart: (args: EnvArgs & { service: string }) => Promise<ServiceRunResult>
  env: (args: EnvArgs & { file?: string }) => Promise<{ files: DevEnvEnvFileView[] }>
  seed: (args: EnvArgs) => Promise<{ started: boolean }>
  reset: (args: EnvArgs & { reseed?: boolean; confirm: true }) => Promise<{ started: boolean }>
  bind: (args: EnvArgs & { dependency: string; provider: string | null }) => Promise<DevEnv>
  pinSlot: (args: EnvArgs & { slot: string; worktree: string | null }) => Promise<DevEnv>
  create: (args: {
    mission?: string
    worktree?: string
    template: string
    bindings?: Record<string, string>
  }) => Promise<DevEnv>
  delete: (args: EnvArgs & { dropData: boolean }) => Promise<{ deleted: boolean }>
  infraStatus: () => Promise<{ services: DevEnvInfraState[]; error?: string }>
  infraUp: (args: { service?: string }) => Promise<{ ok: boolean; error?: string }>
  infraDown: (args: { service?: string }) => Promise<{ ok: boolean }>
  /** Desktop only: never exposed over RPC. */
  revealSecret: (args: EnvArgs & { slot: string; path: string; key: string }) => Promise<string>
  revealCredential: (args: EnvArgs & { label: string }) => Promise<string>
  /** Desktop only: remote tiers are never bound over RPC or the CLI. */
  bindRemote: (
    args: EnvArgs & { dependency: string; tierId: string; confirmation?: string }
  ) => Promise<DevEnv>
  secretsList: () => Promise<string[]>
  secretSet: (args: { name: string; value: string }) => Promise<void>
  secretDelete: (args: { name: string }) => Promise<boolean>
  /** `step: 'infra-shared'` reads the shared infra log. */
  readLog: (args: { env?: string; step: DevEnvStepId | 'infra-shared' }) => Promise<string>
  onChanged: (callback: (event: { devEnvId: string }) => void) => () => void
}
