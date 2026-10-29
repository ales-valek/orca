export type DevEnvInfraPort = { name: string; host: number; container: number }

export type DevEnvInfraService = {
  name: string
  image?: string
  build?: { context: string; dockerfile?: string }
  ports: DevEnvInfraPort[]
  environment: Record<string, string>
  command?: string[]
  /** "<named volume>:/path" */
  volumes: string[]
  healthcheck?: { test: string[]; intervalSec?: number; retries?: number }
  /** Shell run inside the container; may use ${devEnv.key} and ${devEnv.slot}. */
  resource?: { create: string; drop: string }
}

export type DevEnvEnvLine = { key: string; value: string }

export type DevEnvEnvFile = {
  path: string
  base?: string
  /** Personal values file outside the repos (`~` allowed), read at render time as secrets. */
  valuesFile?: string
  lines: DevEnvEnvLine[]
}

export type DevEnvServiceDef = {
  name: string
  command: string
  portOffset: number
  /** e.g. "admin.${devEnv.key}" or "*.eshop.${devEnv.key}" */
  host?: string
  /** Service or infra names. */
  dependsOn: string[]
  ready?: { httpPath?: string }
  /** Keys a paired environment reads as ${dep.<service>.<key>}. */
  exports?: Record<string, string>
}

export type DevEnvTemplateSlot = {
  name: string
  repoId: string | null
  install: string[]
  envFiles: DevEnvEnvFile[]
  services: DevEnvServiceDef[]
}

export type DevEnvCredential = { label: string; userKey: string; passwordKey: string }

export type DevEnvTemplate = {
  id: string
  name: string
  slots: DevEnvTemplateSlot[]
  dependencies: string[]
  seed?: { slot: string; command: string; enabledByDefault: boolean }
  credentials: DevEnvCredential[]
}

export type DevEnvAttachment =
  | { kind: 'mission'; missionId: string }
  | { kind: 'worktree'; worktreeId: string }

export type DevEnvStepId = 'ports' | 'env' | 'install' | 'infra' | 'data' | 'seed'

export const DEV_ENV_STEP_IDS: readonly DevEnvStepId[] = [
  'ports',
  'env',
  'install',
  'infra',
  'data',
  'seed'
]

export type DevEnvStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type DevEnvStepState = {
  status: DevEnvStepStatus
  detail?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export type DevEnvBinding = { kind: 'local'; devEnvId: string }

export type DevEnvSlotWorktree = { worktreeId: string; path: string; label: string }

export type DevEnv = {
  id: string
  /** Slug used in hostnames and database names. */
  key: string
  name: string
  templateId: string
  attachment: DevEnvAttachment
  /** The attachment target no longer exists. */
  detached?: boolean
  portSlot: number
  /** Slot name -> pinned worktree id (a task layer). */
  slotPins: Record<string, string>
  /** Last resolved worktree per slot. */
  slotWorktrees: Record<string, DevEnvSlotWorktree | null>
  bindings: Record<string, DevEnvBinding>
  setup: Partial<Record<DevEnvStepId, DevEnvStepState>>
  createdAt: number
}

export type DevEnvServiceStatus = 'stopped' | 'starting' | 'up' | 'crashed' | 'moved' | 'unbound'

export type DevEnvServiceState = {
  name: string
  slot: string
  status: DevEnvServiceStatus
  port: number
  url: string | null
  exitCode?: number | null
  terminalHandle?: string
  worktreeLabel?: string
}

export type DevEnvInfraState = {
  name: string
  status: 'missing' | 'running' | 'stopped' | 'unhealthy'
  ports: number[]
}

export type DevEnvBadge = {
  envId: string
  state: 'setting-up' | 'running' | 'partial' | 'failed' | 'stopped'
  up: number
  total: number
}

export type DevEnvSummary = DevEnv & {
  templateName: string
  badge: DevEnvBadge
  portRange: { first: number; last: number }
  attachmentLabel: string
}

export type DevEnvDetail = DevEnvSummary & {
  services: DevEnvServiceState[]
  requiredDependencies: string[]
  dependencyStates: Record<string, 'up' | 'down' | 'unbound' | 'missing'>
  /** Passwords are always masked; the desktop UI reveals them over IPC only. */
  credentials: { label: string; user: string; password: string }[]
  hostnameError?: string
  setupRunning: boolean
}

export type DevEnvEnvFileView = {
  slot: string
  path: string
  values: {
    key: string
    value: string
    section: 'STATIC' | 'SECRET' | 'DYNAMIC' | 'LOCAL'
    sources: string[]
    secret: boolean
  }[]
  error?: string
}

export const DEV_ENV_MASK = '••••••'
