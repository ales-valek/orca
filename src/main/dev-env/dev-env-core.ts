import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { buildDevEnvContext, getDevEnvServiceHost } from '../../shared/dev-env/dev-env-context'
import { interpolateDevEnvValue } from '../../shared/dev-env/dev-env-expression'
import { DEV_ENV_MAX_PORT_SLOT, getDevEnvPort } from '../../shared/dev-env/dev-env-ports'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnvWorktreeLookup } from '../../shared/dev-env/dev-env-slot-binding'
import type { DevEnv, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'
import type { Mission } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import { resolveDevEnvDependencies } from './dev-env-dependencies'
import { isDevEnvFileGitIgnored } from './dev-env-git-ignore'
import { DevEnvHostProxy } from './dev-env-host-proxy'
import { DevEnvInfra } from './dev-env-infra'
import { isPortFree, isPortListening, probeHttpReady } from './dev-env-port-owner'
import { DevEnvSecretStore } from './dev-env-secret-store'
import { DevEnvServices, type DevEnvTerminalPort } from './dev-env-services'
import { DevEnvSetupPipeline, type DevEnvSetupOptions } from './dev-env-setup-pipeline'

export type DevEnvStore = {
  getDevEnvs(): DevEnv[]
  getDevEnv(id: string): DevEnv | null
  createDevEnv(env: DevEnv): DevEnv
  updateDevEnv(id: string, updates: Partial<Omit<DevEnv, 'id'>>): DevEnv | null
  deleteDevEnv(id: string): boolean
  getMission(id: string): Mission | null
  getMissions(): Mission[]
  getWorktreeMeta(id: string): WorktreeMeta | undefined
  getRepo(id: string): Repo | undefined
}

export type DevEnvOperationsDeps = {
  store: DevEnvStore
  getSettings: () => DevEnvGlobalSettings
  userDataDir: string
  terminals: DevEnvTerminalPort
  notify: (envId: string) => void
  components?: Partial<{
    infra: DevEnvInfra
    secrets: DevEnvSecretStore
    proxy: DevEnvHostProxy
    services: DevEnvServices
    pipeline: DevEnvSetupPipeline
    isPortFree: (port: number) => Promise<boolean>
    worktreeExists: (path: string) => boolean
  }>
}

export function slugifyDevEnvKey(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  return slug || 'env'
}

export abstract class DevEnvCore {
  readonly infra: DevEnvInfra
  readonly secrets: DevEnvSecretStore
  protected readonly proxy: DevEnvHostProxy
  protected readonly services: DevEnvServices
  protected readonly pipeline: DevEnvSetupPipeline
  protected readonly isPortFree: (port: number) => Promise<boolean>
  protected readonly worktreeExists: (path: string) => boolean
  protected readonly hostnameErrors = new Map<string, string>()
  protected readonly pendingSlotRuns = new Map<string, Set<string>>()

  constructor(protected readonly deps: DevEnvOperationsDeps) {
    const root = join(deps.userDataDir, 'dev-envs')
    const parts = deps.components ?? {}
    this.isPortFree = parts.isPortFree ?? isPortFree
    this.worktreeExists = parts.worktreeExists ?? existsSync
    this.secrets = parts.secrets ?? new DevEnvSecretStore(join(root, 'secrets'))
    this.infra =
      parts.infra ??
      new DevEnvInfra({
        dir: join(root, 'infra'),
        getServices: () => deps.getSettings().devEnvInfra
      })
    this.proxy =
      parts.proxy ?? new DevEnvHostProxy({ getPort: () => deps.getSettings().devEnvProxyPort })
    this.services =
      parts.services ??
      new DevEnvServices({
        terminals: deps.terminals,
        probePort: isPortListening,
        probeHttp: probeHttpReady,
        notify: deps.notify,
        renderCommand: (env, template, command) => this.renderCommand(env, template, command)
      })
    this.pipeline =
      parts.pipeline ??
      new DevEnvSetupPipeline({
        store: deps.store,
        getSettings: deps.getSettings,
        infra: this.infra,
        secrets: this.secrets,
        resolveDependencies: async (env) => this.resolveDependencies(env),
        logDir: (envId) => join(root, 'envs', envId, 'logs'),
        isGitIgnored: (path, rel) => isDevEnvFileGitIgnored(path, rel),
        notify: deps.notify,
        readFile: (path) => readFile(path, 'utf8').catch(() => null),
        writeFile: (path, text) => writeFile(path, text)
      })
  }

  getLogPath(envId: string, step: Parameters<DevEnvSetupPipeline['getLogPath']>[1]): string {
    return this.pipeline.getLogPath(envId, step)
  }

  getTemplate(env: DevEnv): DevEnvTemplate | null {
    return (
      this.deps.getSettings().devEnvTemplates.find((entry) => entry.id === env.templateId) ?? null
    )
  }

  requireEnv(id: string): { env: DevEnv; template: DevEnvTemplate } {
    const env = this.deps.store.getDevEnv(id)
    if (!env) {
      throw new Error(`Unknown Dev Environment ${id}`)
    }
    const template = this.getTemplate(env)
    if (!template) {
      throw new Error(`Template "${env.templateId}" no longer exists`)
    }
    return { env, template }
  }

  protected readonly lookupWorktree: DevEnvWorktreeLookup = (worktreeId) => {
    const parsed = splitWorktreeId(worktreeId)
    const meta = this.deps.store.getWorktreeMeta(worktreeId)
    if (!parsed || !meta || !this.worktreeExists(parsed.worktreePath)) {
      return null
    }
    return {
      path: parsed.worktreePath,
      repoId: parsed.repoId,
      label: meta.displayName || basename(parsed.worktreePath)
    }
  }

  protected resolveDependencies(env: DevEnv) {
    const template = this.getTemplate(env)
    return template
      ? resolveDevEnvDependencies(env, template, {
          getDevEnv: (id) => this.deps.store.getDevEnv(id),
          getSettings: this.deps.getSettings,
          secrets: this.secrets.getAll()
        })
      : new Map()
  }

  protected async renderCommand(
    env: DevEnv,
    template: DevEnvTemplate,
    command: string
  ): Promise<string> {
    const settings = this.deps.getSettings()
    const context = buildDevEnvContext({
      env,
      template,
      infra: settings.devEnvInfra,
      proxyPort: settings.devEnvProxyPort,
      secrets: this.secrets.getAll(),
      dependencies: this.resolveDependencies(env)
    })
    const result = interpolateDevEnvValue(command, context)
    return 'error' in result ? command : result.value
  }

  protected async allocatePortSlot(template: DevEnvTemplate): Promise<number> {
    const used = new Set(this.deps.store.getDevEnvs().map((env) => env.portSlot))
    const offsets = template.slots.flatMap((slot) =>
      slot.services.map((service) => service.portOffset)
    )
    for (let slot = 1; slot <= DEV_ENV_MAX_PORT_SLOT; slot++) {
      if (used.has(slot)) {
        continue
      }
      const free = await Promise.all(
        offsets.map((offset) => this.isPortFree(getDevEnvPort(slot, offset)))
      )
      if (free.every(Boolean)) {
        return slot
      }
    }
    throw new Error('No free port block (slots 1–99)')
  }

  protected getUniqueKey(name: string): string {
    const taken = new Set(this.deps.store.getDevEnvs().map((env) => env.key))
    const base = slugifyDevEnvKey(name)
    let key = base
    for (let index = 2; taken.has(key); index++) {
      key = `${base}-${index}`
    }
    return key
  }

  protected requireTemplate(templateId: string): DevEnvTemplate {
    const template = this.deps
      .getSettings()
      .devEnvTemplates.find((entry) => entry.id === templateId || entry.name === templateId)
    if (!template) {
      throw new Error(`Unknown Dev Environment template ${templateId}`)
    }
    return template
  }

  protected requireLocalRepos(repoIds: string[]): void {
    if (
      repoIds.some((repoId) => (this.deps.store.getRepo(repoId)?.connectionId ?? null) !== null)
    ) {
      throw new Error('Dev Environments support local repos only')
    }
  }

  protected async publishRoutes(env: DevEnv, template: DevEnvTemplate): Promise<void> {
    const routes = template.slots.flatMap((slot) =>
      env.slotWorktrees[slot.name]
        ? slot.services.flatMap((service) => {
            const host = getDevEnvServiceHost(service, env.key)
            const port = getDevEnvPort(env.portSlot, service.portOffset)
            return host ? [{ host, targetUrl: `http://127.0.0.1:${port}` }] : []
          })
        : []
    )
    const result = await this.proxy.setRoutes(env.id, routes)
    if (result.ok) {
      this.hostnameErrors.delete(env.id)
    } else {
      this.hostnameErrors.set(env.id, result.error)
    }
  }

  /** Starts setup in the background; a run already in progress picks the slots up afterwards. */
  startSetup(envId: string, options: DevEnvSetupOptions = {}): void {
    if (this.pipeline.isRunning(envId)) {
      const pending = this.pendingSlotRuns.get(envId) ?? new Set<string>()
      for (const slot of options.slots ?? []) {
        pending.add(slot)
      }
      this.pendingSlotRuns.set(envId, pending)
      return
    }
    void this.pipeline.run(envId, options).then(() => {
      const pending = this.pendingSlotRuns.get(envId)
      this.pendingSlotRuns.delete(envId)
      if (pending && pending.size > 0) {
        this.startSetup(envId, { steps: ['env', 'install'], slots: [...pending] })
      }
    })
  }
}
