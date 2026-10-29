import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDevEnvContext,
  type DevEnvDependencyValues
} from '../../shared/dev-env/dev-env-context'
import { renderDevEnvFile, type RenderedEnvValue } from '../../shared/dev-env/dev-env-file-render'
import { getDevEnvPortRange } from '../../shared/dev-env/dev-env-ports'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import {
  DEV_ENV_STEP_IDS,
  type DevEnv,
  type DevEnvInfraService,
  type DevEnvStepId,
  type DevEnvStepState,
  type DevEnvTemplate,
  type DevEnvTemplateSlot
} from '../../shared/dev-env/dev-env-types'
import { provisionDevEnvData } from './dev-env-data'
import type { DevEnvInfra } from './dev-env-infra'
import type { DevEnvSecretStore } from './dev-env-secret-store'
import { runDevEnvShellCommand, type DevEnvExec } from './dev-env-shell-command'

const INSTALL_TIMEOUT_MS = 30 * 60_000

export type DevEnvSetupDeps = {
  store: {
    getDevEnv(id: string): DevEnv | null
    getDevEnvs(): DevEnv[]
    updateDevEnv(id: string, updates: Partial<Omit<DevEnv, 'id'>>): DevEnv | null
  }
  getSettings: () => DevEnvGlobalSettings
  infra: Pick<DevEnvInfra, 'ensure' | 'exec'>
  secrets: Pick<DevEnvSecretStore, 'getAll'>
  resolveDependencies: (env: DevEnv) => Promise<ReadonlyMap<string, DevEnvDependencyValues>>
  exec?: DevEnvExec
  logDir: (envId: string) => string
  isGitIgnored: (worktreePath: string, relPath: string) => Promise<boolean>
  notify: (envId: string) => void
  readFile: (path: string) => Promise<string | null>
  writeFile: (path: string, text: string) => Promise<void>
}

export type DevEnvSetupOptions = { steps?: DevEnvStepId[]; slots?: string[]; withSeed?: boolean }

export type DevEnvRenderedFile = {
  slot: string
  path: string
  values: RenderedEnvValue[]
  /** Full file text including secrets; never send it to a renderer or CLI. */
  text?: string
  error?: string
}

type StepOutcome =
  | { status: 'done' | 'skipped'; detail?: string }
  | { status: 'failed'; error: string }

type StepRun = {
  env: DevEnv
  template: DevEnvTemplate
  settings: DevEnvGlobalSettings
  options: DevEnvSetupOptions
  log: (line: string) => void
  logPath: string
  signal: AbortSignal
}

/** Infra the template uses through `dependsOn` or `${infra.<name>…}`, in settings order. */
export function getReferencedDevEnvInfra(
  template: DevEnvTemplate,
  infra: DevEnvInfraService[]
): DevEnvInfraService[] {
  const text = JSON.stringify(template)
  const dependsOn = new Set(
    template.slots.flatMap((slot) => slot.services.flatMap((s) => s.dependsOn))
  )
  return infra.filter(
    (service) => dependsOn.has(service.name) || text.includes(`\${infra.${service.name}.`)
  )
}

export class DevEnvSetupPipeline {
  private readonly running = new Map<string, AbortController>()

  constructor(private readonly deps: DevEnvSetupDeps) {}

  getLogPath(envId: string, step: DevEnvStepId): string {
    return join(this.deps.logDir(envId), `${step}.log`)
  }

  isRunning(envId: string): boolean {
    return this.running.has(envId)
  }

  cancel(envId: string): void {
    this.running.get(envId)?.abort()
  }

  async run(envId: string, options: DevEnvSetupOptions = {}): Promise<void> {
    if (this.running.has(envId)) {
      throw new Error('Setup is already running')
    }
    const controller = new AbortController()
    this.running.set(envId, controller)
    try {
      await this.runSteps(envId, options, controller.signal)
    } finally {
      this.running.delete(envId)
      this.deps.notify(envId)
    }
  }

  private async runSteps(
    envId: string,
    options: DevEnvSetupOptions,
    signal: AbortSignal
  ): Promise<void> {
    const steps = DEV_ENV_STEP_IDS.filter((step) => !options.steps || options.steps.includes(step))
    for (const step of steps) {
      const env = this.deps.store.getDevEnv(envId)
      if (!env) {
        return
      }
      const settings = this.deps.getSettings()
      const template = settings.devEnvTemplates.find((entry) => entry.id === env.templateId)
      const startedAt = Date.now()
      this.setStep(envId, step, { status: 'running', startedAt })
      const logPath = this.getLogPath(envId, step)
      mkdirSync(this.deps.logDir(envId), { recursive: true })
      writeFileSync(logPath, '')
      const log = (line: string): void => writeFileSync(logPath, `${line}\n`, { flag: 'a' })
      let outcome: StepOutcome
      try {
        outcome = template
          ? await this.runStep(step, { env, template, settings, options, log, logPath, signal })
          : { status: 'failed', error: `Template "${env.templateId}" no longer exists` }
      } catch (error) {
        outcome = {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        }
      }
      if (outcome.status === 'failed') {
        log(`error: ${outcome.error}`)
      }
      this.setStep(envId, step, { ...outcome, startedAt, finishedAt: Date.now() })
      if (outcome.status === 'failed') {
        return
      }
    }
  }

  private setStep(envId: string, step: DevEnvStepId, state: DevEnvStepState): void {
    const env = this.deps.store.getDevEnv(envId)
    if (env) {
      this.deps.store.updateDevEnv(envId, { setup: { ...env.setup, [step]: state } })
      this.deps.notify(envId)
    }
  }

  private boundSlots(run: StepRun): { slot: DevEnvTemplateSlot; path: string }[] {
    return run.template.slots.flatMap((slot) => {
      const worktree = run.env.slotWorktrees[slot.name]
      const selected = !run.options.slots || run.options.slots.includes(slot.name)
      return worktree && selected ? [{ slot, path: worktree.path }] : []
    })
  }

  private runStep(step: DevEnvStepId, run: StepRun): Promise<StepOutcome> {
    switch (step) {
      case 'ports': {
        const range = getDevEnvPortRange(run.env.portSlot)
        return Promise.resolve({ status: 'done', detail: `${range.first}–${range.last}` })
      }
      case 'env':
        return this.renderEnvStep(run)
      case 'install':
        return this.installStep(run)
      case 'infra':
        return this.infraStep(run)
      case 'data':
        return this.dataStep(run)
      case 'seed':
        return this.seedStep(run)
    }
  }

  async renderEnvFiles(
    env: DevEnv,
    template: DevEnvTemplate,
    slots?: string[]
  ): Promise<DevEnvRenderedFile[]> {
    const settings = this.deps.getSettings()
    const context = buildDevEnvContext({
      env,
      template,
      infra: settings.devEnvInfra,
      proxyPort: settings.devEnvProxyPort,
      secrets: this.deps.secrets.getAll(),
      dependencies: await this.deps.resolveDependencies(env)
    })
    const files: DevEnvRenderedFile[] = []
    for (const slot of template.slots) {
      const worktree = env.slotWorktrees[slot.name]
      if (!worktree || (slots && !slots.includes(slot.name))) {
        continue
      }
      for (const file of slot.envFiles) {
        const result = renderDevEnvFile({
          file,
          baseText: file.base ? await this.deps.readFile(join(worktree.path, file.base)) : null,
          currentText: await this.deps.readFile(join(worktree.path, file.path)),
          context,
          envLabel: env.key
        })
        files.push(
          'error' in result
            ? { slot: slot.name, path: file.path, values: [], error: result.error }
            : { slot: slot.name, path: file.path, values: result.values, text: result.text }
        )
      }
    }
    return files
  }

  private async renderEnvStep(run: StepRun): Promise<StepOutcome> {
    const bound = this.boundSlots(run)
    for (const { slot, path } of bound) {
      for (const file of slot.envFiles) {
        if (!(await this.deps.isGitIgnored(path, file.path))) {
          return {
            status: 'failed',
            error: `${slot.name}/${file.path} is tracked by git; Orca only writes ignored files`
          }
        }
      }
    }
    const rendered = await this.renderEnvFiles(
      run.env,
      run.template,
      bound.map(({ slot }) => slot.name)
    )
    const failed = rendered.find((file) => file.error)
    if (failed) {
      return { status: 'failed', error: `${failed.slot}/${failed.path}: ${failed.error}` }
    }
    for (const file of rendered) {
      const worktree = run.env.slotWorktrees[file.slot]
      if (worktree && file.text !== undefined) {
        await this.deps.writeFile(join(worktree.path, file.path), file.text)
        run.log(`wrote ${file.slot}/${file.path}`)
      }
    }
    const unbound = run.template.slots.filter((slot) => !run.env.slotWorktrees[slot.name])
    const repos = new Set(rendered.map((file) => file.slot)).size
    const detail = `${rendered.length} files in ${repos} repos`
    return {
      status: 'done',
      detail:
        unbound.length > 0
          ? `${detail}; unbound: ${unbound.map((slot) => slot.name).join(', ')}`
          : detail
    }
  }

  private async installStep(run: StepRun): Promise<StepOutcome> {
    const finished: string[] = []
    for (const { slot, path } of this.boundSlots(run)) {
      this.setDetail(
        run,
        [...finished.map((name) => `${name} ✓`), `${slot.name} running`].join(' · ')
      )
      for (const command of slot.install) {
        const result = await runDevEnvShellCommand(
          command,
          { cwd: path, logPath: run.logPath, timeoutMs: INSTALL_TIMEOUT_MS, signal: run.signal },
          this.deps.exec
        )
        if (run.signal.aborted) {
          return { status: 'failed', error: 'Cancelled' }
        }
        if (!result.ok) {
          const exit = result.timedOut ? 'timed out' : `exit ${String(result.code)}`
          return { status: 'failed', error: `${slot.name}: "${command}" failed (${exit})` }
        }
      }
      finished.push(slot.name)
    }
    return {
      status: 'done',
      detail: finished.map((name) => `${name} ✓`).join(' · ') || 'nothing to install'
    }
  }

  private setDetail(run: StepRun, detail: string): void {
    const env = this.deps.store.getDevEnv(run.env.id)
    const current = env?.setup.install
    if (env && current) {
      this.deps.store.updateDevEnv(run.env.id, {
        setup: { ...env.setup, install: { ...current, detail } }
      })
      this.deps.notify(run.env.id)
    }
  }

  private async infraStep(run: StepRun): Promise<StepOutcome> {
    const names = getReferencedDevEnvInfra(run.template, run.settings.devEnvInfra).map(
      (service) => service.name
    )
    const result = await this.deps.infra.ensure(names, run.logPath)
    if (!result.ok) {
      return { status: 'failed', error: result.error }
    }
    return {
      status: 'done',
      detail: result.started.length > 0 ? `started ${result.started.join(', ')}` : 'already running'
    }
  }

  private async dataStep(run: StepRun): Promise<StepOutcome> {
    const result = await provisionDevEnvData({
      env: run.env,
      services: getReferencedDevEnvInfra(run.template, run.settings.devEnvInfra),
      infra: this.deps.infra,
      logPath: run.logPath
    })
    if (!result.ok) {
      return { status: 'failed', error: result.error }
    }
    return {
      status: 'done',
      detail: result.created.length > 0 ? result.created.join(', ') : 'no resources'
    }
  }

  private async seedStep(run: StepRun): Promise<StepOutcome> {
    const seed = run.template.seed
    if (!seed) {
      return { status: 'skipped', detail: 'no seed in template' }
    }
    if (!run.options.withSeed && !seed.enabledByDefault) {
      return { status: 'skipped', detail: 'off in template' }
    }
    const worktree = run.env.slotWorktrees[seed.slot]
    if (!worktree) {
      return { status: 'failed', error: `Seed slot "${seed.slot}" has no worktree` }
    }
    const result = await runDevEnvShellCommand(
      seed.command,
      {
        cwd: worktree.path,
        logPath: run.logPath,
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal: run.signal
      },
      this.deps.exec
    )
    return result.ok
      ? { status: 'done', detail: seed.command }
      : { status: 'failed', error: `"${seed.command}" failed (exit ${String(result.code)})` }
  }
}
