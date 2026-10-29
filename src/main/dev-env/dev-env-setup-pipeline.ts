import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnvDependencyValues } from '../../shared/dev-env/dev-env-context'
import { getReferencedDevEnvInfra } from '../../shared/dev-env/dev-env-infra-references'
import { getDevEnvPortRange } from '../../shared/dev-env/dev-env-ports'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import {
  DEV_ENV_STEP_IDS,
  type DevEnv,
  type DevEnvStepId,
  type DevEnvStepState,
  type DevEnvTemplate,
  type DevEnvTemplateSlot
} from '../../shared/dev-env/dev-env-types'
import { provisionDevEnvData } from './dev-env-data'
import { runDevEnvSeedStep } from './dev-env-seed-step'
import { renderDevEnvFiles, type DevEnvRenderedFile } from './dev-env-file-writer'
import type { DevEnvInfra } from './dev-env-infra'
import type { DevEnvSecretStore } from './dev-env-secret-store'
import {
  DEV_ENV_COMMAND_TIMEOUT_MS,
  runDevEnvShellCommand,
  type DevEnvExec
} from './dev-env-shell-command'

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

export type StepOutcome =
  | { status: 'done' | 'skipped'; detail?: string }
  | { status: 'failed'; error: string }

export type StepRun = {
  env: DevEnv
  template: DevEnvTemplate
  settings: DevEnvGlobalSettings
  options: DevEnvSetupOptions
  log: (line: string) => void
  logPath: string
  signal: AbortSignal
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
        return runDevEnvSeedStep(run, this.deps.exec)
    }
  }

  renderEnvFiles(
    env: DevEnv,
    template: DevEnvTemplate,
    slots?: string[]
  ): Promise<DevEnvRenderedFile[]> {
    return renderDevEnvFiles({ ...this.deps, env, template, slots })
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
          {
            cwd: path,
            logPath: run.logPath,
            timeoutMs: DEV_ENV_COMMAND_TIMEOUT_MS,
            signal: run.signal
          },
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
}
