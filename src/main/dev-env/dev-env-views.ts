import { buildDevEnvContext } from '../../shared/dev-env/dev-env-context'
import { getDevEnvPortRange } from '../../shared/dev-env/dev-env-ports'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import { getRequiredDevEnvDependencies } from '../../shared/dev-env/dev-env-slot-binding'
import {
  DEV_ENV_MASK,
  type DevEnv,
  type DevEnvBadge,
  type DevEnvDetail,
  type DevEnvEnvFileView,
  type DevEnvServiceState,
  type DevEnvSummary,
  type DevEnvTemplate
} from '../../shared/dev-env/dev-env-types'
import type { DevEnvDependencyState } from './dev-env-dependencies'
import type { DevEnvRenderedFile } from './dev-env-file-writer'

export function getDevEnvBadge(
  env: DevEnv,
  services: DevEnvServiceState[],
  setupRunning: boolean
): DevEnvBadge {
  const bound = services.filter((service) => service.status !== 'unbound')
  const up = bound.filter((service) => service.status === 'up').length
  const base = { envId: env.id, up, total: bound.length }
  if (setupRunning) {
    return { ...base, state: 'setting-up' }
  }
  if (Object.values(env.setup).some((step) => step?.status === 'failed')) {
    return { ...base, state: 'failed' }
  }
  if (up === 0) {
    return { ...base, state: 'stopped' }
  }
  return { ...base, state: up === bound.length ? 'running' : 'partial' }
}

export function buildDevEnvSummary(input: {
  env: DevEnv
  template: DevEnvTemplate | null
  services: DevEnvServiceState[]
  setupRunning: boolean
  attachmentLabel: string
}): DevEnvSummary {
  return {
    ...input.env,
    templateName: input.template?.name ?? 'Missing template',
    badge: getDevEnvBadge(input.env, input.services, input.setupRunning),
    portRange: getDevEnvPortRange(input.env.portSlot),
    attachmentLabel: input.attachmentLabel
  }
}

/** Credential users show in clear; passwords stay masked until an explicit IPC reveal. */
export function getDevEnvCredentials(
  env: DevEnv,
  template: DevEnvTemplate,
  settings: DevEnvGlobalSettings,
  secrets: ReadonlyMap<string, string>
): { label: string; user: string; password: string }[] {
  const context = buildDevEnvContext({
    env,
    template,
    infra: settings.devEnvInfra,
    proxyPort: settings.devEnvProxyPort,
    secrets,
    dependencies: new Map()
  })
  return template.credentials.map((credential) => ({
    label: credential.label,
    user: context.get(credential.userKey)?.value ?? '',
    password: context.has(credential.passwordKey) ? DEV_ENV_MASK : ''
  }))
}

export function buildDevEnvDetail(input: {
  summary: DevEnvSummary
  template: DevEnvTemplate | null
  services: DevEnvServiceState[]
  dependencyStates: Record<string, DevEnvDependencyState>
  credentials: DevEnvDetail['credentials']
  hostnameError?: string
  setupRunning: boolean
  remoteTiers?: DevEnvDetail['remoteTiers']
}): DevEnvDetail {
  return {
    ...input.summary,
    services: input.services,
    requiredDependencies: input.template
      ? getRequiredDevEnvDependencies(input.template, input.summary.slotWorktrees)
      : [],
    dependencyStates: input.dependencyStates,
    credentials: input.credentials,
    ...(input.hostnameError ? { hostnameError: input.hostnameError } : {}),
    setupRunning: input.setupRunning,
    mode: input.summary.mode ?? 'dev',
    snapshots: input.summary.snapshots ?? [],
    remoteTiers: input.remoteTiers ?? {}
  }
}

export function maskDevEnvFiles(files: DevEnvRenderedFile[]): DevEnvEnvFileView[] {
  return files.map((file) => ({
    slot: file.slot,
    path: file.path,
    values: file.values.map((value) => ({
      key: value.key,
      value: value.secret ? DEV_ENV_MASK : value.value,
      section: value.section,
      sources: value.sources,
      secret: value.secret
    })),
    ...(file.error ? { error: file.error } : {})
  }))
}
