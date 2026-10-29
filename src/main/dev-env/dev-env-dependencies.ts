import {
  buildDevEnvContext,
  getDevEnvServiceUrl,
  type DevEnvDependencyValues,
  type DevEnvExportValue
} from '../../shared/dev-env/dev-env-context'
import { interpolateDevEnvValue } from '../../shared/dev-env/dev-env-expression'
import { getDevEnvPort } from '../../shared/dev-env/dev-env-ports'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import { getRequiredDevEnvDependencies } from '../../shared/dev-env/dev-env-slot-binding'
import type {
  DevEnv,
  DevEnvRemoteTier,
  DevEnvServiceDef,
  DevEnvServiceState,
  DevEnvTemplate
} from '../../shared/dev-env/dev-env-types'

export type DevEnvDependencyState = 'up' | 'down' | 'unbound' | 'missing' | 'remote'

type DependencyLookup = {
  getDevEnv: (id: string) => DevEnv | null
  getSettings: () => DevEnvGlobalSettings
  secrets: ReadonlyMap<string, string>
}

type ProviderService = { provider: DevEnv; template: DevEnvTemplate; service: DevEnvServiceDef }

function findProviderService(
  env: DevEnv,
  dependency: string,
  lookup: DependencyLookup
): ProviderService | null {
  const binding = env.bindings[dependency]
  const provider = binding?.kind === 'local' ? lookup.getDevEnv(binding.devEnvId) : null
  const template = provider
    ? lookup.getSettings().devEnvTemplates.find((entry) => entry.id === provider.templateId)
    : undefined
  if (!provider || !template) {
    return null
  }
  for (const slot of template.slots) {
    const service = slot.services.find((entry) => entry.name === dependency)
    if (service && provider.slotWorktrees[slot.name]) {
      return { provider, template, service }
    }
  }
  return null
}

/** The tier a remote binding points at, when it still defines this dependency. */
export function findRemoteTier(
  env: DevEnv,
  dependency: string,
  lookup: DependencyLookup
): DevEnvRemoteTier | null {
  const binding = env.bindings[dependency]
  if (binding?.kind !== 'remote') {
    return null
  }
  const tier = lookup.getSettings().devEnvRemoteTiers.find((entry) => entry.id === binding.tierId)
  return tier?.dependencies[dependency] ? tier : null
}

/** Tier values are expressions over global secrets only; one that fails to resolve is left out. */
function resolveRemoteDependency(
  env: DevEnv,
  dependency: string,
  lookup: DependencyLookup
): DevEnvDependencyValues | null {
  const target = findRemoteTier(env, dependency, lookup)?.dependencies[dependency]
  if (!target) {
    return null
  }
  const context = new Map(
    [...lookup.secrets].map(([name, value]) => [
      `secret.${name}`,
      { value, source: 'secret' as const, secret: true }
    ])
  )
  const url = interpolateDevEnvValue(target.url, context)
  if ('error' in url) {
    return null
  }
  const exports: Record<string, DevEnvExportValue> = {}
  for (const [key, expression] of Object.entries(target.values)) {
    const value = interpolateDevEnvValue(expression, context)
    if (!('error' in value)) {
      exports[key] = { value: value.value, secret: value.secret }
    }
  }
  return { url: url.value, urlSecret: url.secret, exports }
}

/** Values of locally paired providers; an unbound or vanished provider resolves nothing. */
export function resolveDevEnvDependencies(
  env: DevEnv,
  template: DevEnvTemplate,
  lookup: DependencyLookup
): Map<string, DevEnvDependencyValues> {
  const settings = lookup.getSettings()
  const resolved = new Map<string, DevEnvDependencyValues>()
  for (const dependency of getRequiredDevEnvDependencies(template, env.slotWorktrees)) {
    const remote = resolveRemoteDependency(env, dependency, lookup)
    if (remote) {
      resolved.set(dependency, remote)
      continue
    }
    const found = findProviderService(env, dependency, lookup)
    if (!found) {
      continue
    }
    const port = getDevEnvPort(found.provider.portSlot, found.service.portOffset)
    // Why: exports resolve in the provider's own context, without its dependencies, so pairs cannot recurse.
    const providerContext = buildDevEnvContext({
      env: found.provider,
      template: found.template,
      infra: settings.devEnvInfra,
      proxyPort: settings.devEnvProxyPort,
      secrets: lookup.secrets,
      dependencies: new Map()
    })
    const exports: Record<string, DevEnvExportValue> = {}
    for (const [key, expression] of Object.entries(found.service.exports ?? {})) {
      const value = interpolateDevEnvValue(expression, providerContext)
      if (!('error' in value)) {
        exports[key] = { value: value.value, secret: value.secret }
      }
    }
    resolved.set(dependency, {
      url: getDevEnvServiceUrl(found.service, found.provider.key, port, settings.devEnvProxyPort),
      exports
    })
  }
  return resolved
}

export async function getDevEnvDependencyStates(
  env: DevEnv,
  template: DevEnvTemplate,
  lookup: DependencyLookup,
  getProviderStates: (provider: DevEnv, template: DevEnvTemplate) => Promise<DevEnvServiceState[]>
): Promise<Record<string, DevEnvDependencyState>> {
  const states: Record<string, DevEnvDependencyState> = {}
  for (const dependency of getRequiredDevEnvDependencies(template, env.slotWorktrees)) {
    if (!env.bindings[dependency]) {
      states[dependency] = 'unbound'
      continue
    }
    if (env.bindings[dependency]?.kind === 'remote') {
      states[dependency] = findRemoteTier(env, dependency, lookup) ? 'remote' : 'missing'
      continue
    }
    const found = findProviderService(env, dependency, lookup)
    if (!found) {
      states[dependency] = 'missing'
      continue
    }
    const providerStates = await getProviderStates(found.provider, found.template)
    const status = providerStates.find((state) => state.name === dependency)?.status
    states[dependency] = status === 'up' ? 'up' : 'down'
  }
  return states
}
