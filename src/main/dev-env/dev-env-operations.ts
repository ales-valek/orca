import { buildDevEnvContext } from '../../shared/dev-env/dev-env-context'
import type {
  DevEnv,
  DevEnvDetail,
  DevEnvEnvFileView,
  DevEnvSummary
} from '../../shared/dev-env/dev-env-types'
import { getDevEnvDependencyStates } from './dev-env-dependencies'
import { DevEnvSnapshotCommands } from './dev-env-snapshot-commands'
import {
  buildDevEnvDetail,
  buildDevEnvSummary,
  getDevEnvCredentials,
  maskDevEnvFiles
} from './dev-env-views'

export type { DevEnvOperationsDeps, DevEnvStore } from './dev-env-core'

/** Dev Environments facade shared by desktop IPC and runtime RPC. */
export class DevEnvOperations extends DevEnvSnapshotCommands {
  async list(): Promise<DevEnvSummary[]> {
    return Promise.all(this.deps.store.getDevEnvs().map((env) => this.summarize(env)))
  }

  protected getAttachmentLabel(env: DevEnv): string {
    if (env.attachment.kind === 'mission') {
      return env.detached
        ? 'Mission deleted'
        : `Mission ${this.deps.store.getMission(env.attachment.missionId)?.name ?? ''}`.trim()
    }
    return env.detached
      ? 'Worktree removed'
      : (this.lookupWorktree(env.attachment.worktreeId)?.label ?? 'Worktree')
  }

  protected async summarize(env: DevEnv): Promise<DevEnvSummary> {
    const template = this.getTemplate(env)
    const settings = this.deps.getSettings()
    return buildDevEnvSummary({
      env,
      template,
      services: template
        ? await this.services.getStates(env, template, settings.devEnvProxyPort)
        : [],
      setupRunning: this.pipeline.isRunning(env.id),
      attachmentLabel: this.getAttachmentLabel(env),
      danger: Object.values(this.getRemoteTiers(env)).some((tier) => tier.danger)
    })
  }

  protected getRemoteTiers(env: DevEnv): DevEnvDetail['remoteTiers'] {
    const tiers = this.deps.getSettings().devEnvRemoteTiers
    const remote: DevEnvDetail['remoteTiers'] = {}
    for (const [dependency, binding] of Object.entries(env.bindings)) {
      const tier =
        binding.kind === 'remote' ? tiers.find((entry) => entry.id === binding.tierId) : undefined
      if (tier) {
        remote[dependency] = { tierId: tier.id, name: tier.name, danger: tier.danger }
      }
    }
    return remote
  }

  async show(id: string): Promise<DevEnvDetail> {
    const env = this.deps.store.getDevEnv(id)
    if (!env) {
      throw new Error(`Unknown Dev Environment ${id}`)
    }
    const template = this.getTemplate(env)
    const settings = this.deps.getSettings()
    const services = template
      ? await this.services.getStates(env, template, settings.devEnvProxyPort)
      : []
    const lookup = {
      getDevEnv: (envId: string) => this.deps.store.getDevEnv(envId),
      getSettings: this.deps.getSettings,
      secrets: this.secrets.getAll()
    }
    return buildDevEnvDetail({
      remoteTiers: this.getRemoteTiers(env),
      summary: await this.summarize(env),
      template,
      services,
      dependencyStates: template
        ? await getDevEnvDependencyStates(env, template, lookup, (provider, providerTemplate) =>
            this.services.getStates(provider, providerTemplate, settings.devEnvProxyPort)
          )
        : {},
      credentials: template ? getDevEnvCredentials(env, template, settings, lookup.secrets) : [],
      hostnameError: this.hostnameErrors.get(id),
      setupRunning: this.pipeline.isRunning(id)
    })
  }

  async getEnvFiles(id: string): Promise<DevEnvEnvFileView[]> {
    const { env, template } = this.requireEnv(id)
    return maskDevEnvFiles(await this.pipeline.renderEnvFiles(env, template))
  }

  async revealSecretValue(id: string, slot: string, path: string, key: string): Promise<string> {
    const { env, template } = this.requireEnv(id)
    const files = await this.pipeline.renderEnvFiles(env, template, [slot])
    const value = files
      .find((file) => file.path === path)
      ?.values.find((entry) => entry.key === key)
    if (!value) {
      throw new Error(`${slot}/${path} has no ${key}`)
    }
    return value.value
  }

  revealCredentialPassword(id: string, label: string): string {
    const { env, template } = this.requireEnv(id)
    const credential = template.credentials.find((entry) => entry.label === label)
    const settings = this.deps.getSettings()
    const context = buildDevEnvContext({
      env,
      template,
      infra: settings.devEnvInfra,
      proxyPort: settings.devEnvProxyPort,
      secrets: this.secrets.getAll(),
      dependencies: new Map()
    })
    const value = credential ? context.get(credential.passwordKey)?.value : undefined
    if (value === undefined) {
      throw new Error(`No password for ${label}`)
    }
    return value
  }

  async up(id: string, names?: string[]): Promise<{ started: string[]; errors: string[] }> {
    const { env, template } = this.requireEnv(id)
    if (env.detached) {
      throw new Error(`${env.name} is detached; its worktrees are gone`)
    }
    await this.publishRoutes(env, template)
    return this.services.start(env, template, names && names.length > 0 ? names : 'all')
  }

  async down(id: string, names?: string[]): Promise<void> {
    this.requireEnv(id)
    await this.services.stop(id, names && names.length > 0 ? names : 'all')
  }

  async restart(id: string, name: string): Promise<{ started: string[]; errors: string[] }> {
    const { env, template } = this.requireEnv(id)
    return this.services.restart(env, template, name)
  }

  /** Running services keep their old command, so they stop first and start again on the next up. */
  async setMode(id: string, mode: 'dev' | 'prod'): Promise<void> {
    this.requireEnv(id)
    await this.services.stop(id, 'all')
    this.deps.store.updateDevEnv(id, { mode })
    this.deps.notify(id)
  }

  async close(): Promise<void> {
    await this.proxy.close()
  }
}
