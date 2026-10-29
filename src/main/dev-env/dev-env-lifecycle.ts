import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { getReferencedDevEnvInfra } from '../../shared/dev-env/dev-env-infra-references'
import {
  getMovedDevEnvSlots,
  resolveMissionSlotWorktrees,
  resolveStandaloneSlotWorktrees
} from '../../shared/dev-env/dev-env-slot-binding'
import type { DevEnv, DevEnvSlotWorktree, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'
import { DevEnvCore } from './dev-env-core'
import { dropDevEnvData } from './dev-env-data'

/** Creating, re-binding and removing environments as missions and worktrees change. */
export abstract class DevEnvLifecycle extends DevEnvCore {
  protected async createRecord(input: {
    name: string
    template: DevEnvTemplate
    attachment: DevEnv['attachment']
    slotWorktrees: Record<string, DevEnvSlotWorktree | null>
    bindings?: Record<string, string>
  }): Promise<DevEnv> {
    const bindings: DevEnv['bindings'] = {}
    for (const [dependency, providerId] of Object.entries(input.bindings ?? {})) {
      if (this.deps.store.getDevEnv(providerId)) {
        bindings[dependency] = { kind: 'local', devEnvId: providerId }
      }
    }
    const env = this.deps.store.createDevEnv({
      id: randomUUID(),
      key: this.getUniqueKey(input.name),
      name: input.name,
      templateId: input.template.id,
      attachment: input.attachment,
      portSlot: await this.allocatePortSlot(input.template),
      slotPins: {},
      slotWorktrees: input.slotWorktrees,
      bindings,
      setup: {},
      createdAt: Date.now()
    })
    await this.publishRoutes(env, input.template)
    this.deps.notify(env.id)
    this.startSetup(env.id)
    return env
  }

  async createForMission(missionId: string, templateId: string): Promise<DevEnv> {
    const template = this.requireTemplate(templateId)
    const mission = this.deps.store.getMission(missionId)
    if (!mission) {
      throw new Error(`Unknown mission ${missionId}`)
    }
    if (
      this.deps.store
        .getDevEnvs()
        .some((env) => env.attachment.kind === 'mission' && env.attachment.missionId === missionId)
    ) {
      throw new Error(`${mission.name} already has a Dev Environment`)
    }
    this.requireLocalRepos(mission.members.map((member) => member.repoId))
    return this.createRecord({
      name: mission.name,
      template,
      attachment: { kind: 'mission', missionId },
      slotWorktrees: resolveMissionSlotWorktrees(mission, template, {}, this.lookupWorktree)
    })
  }

  async createForWorktree(
    worktreeId: string,
    templateId: string,
    bindings?: Record<string, string>
  ): Promise<DevEnv> {
    const template = this.requireTemplate(templateId)
    const worktree = this.lookupWorktree(worktreeId)
    if (!worktree) {
      throw new Error(`Unknown worktree ${worktreeId}`)
    }
    if (
      this.deps.store
        .getDevEnvs()
        .some(
          (env) => env.attachment.kind === 'worktree' && env.attachment.worktreeId === worktreeId
        )
    ) {
      throw new Error(`${worktree.label} already has a Dev Environment`)
    }
    this.requireLocalRepos([worktree.repoId])
    return this.createRecord({
      name: worktree.label,
      template,
      attachment: { kind: 'worktree', worktreeId },
      slotWorktrees: resolveStandaloneSlotWorktrees({ id: worktreeId, ...worktree }, template),
      bindings
    })
  }

  bind(id: string, dependency: string, providerId: string | null): DevEnv {
    const { env } = this.requireEnv(id)
    const bindings = { ...env.bindings }
    if (providerId === null) {
      delete bindings[dependency]
    } else {
      if (providerId === id || !this.deps.store.getDevEnv(providerId)) {
        throw new Error(`Unknown Dev Environment ${providerId}`)
      }
      bindings[dependency] = { kind: 'local', devEnvId: providerId }
    }
    const updated = this.deps.store.updateDevEnv(id, { bindings }) ?? env
    this.deps.notify(id)
    this.startSetup(id, { steps: ['env'] })
    return updated
  }

  async pinSlot(id: string, slot: string, worktreeId: string | null): Promise<DevEnv> {
    const { env } = this.requireEnv(id)
    const slotPins = { ...env.slotPins }
    if (worktreeId === null) {
      delete slotPins[slot]
    } else {
      slotPins[slot] = worktreeId
    }
    this.deps.store.updateDevEnv(id, { slotPins })
    await this.reconcileMissions()
    return this.deps.store.getDevEnv(id) ?? env
  }

  async reset(id: string, options: { reseed: boolean }): Promise<void> {
    const { env, template } = this.requireEnv(id)
    if (this.pipeline.isRunning(id)) {
      throw new Error('Setup is already running')
    }
    await this.services.stop(id, 'all')
    const dropped = await dropDevEnvData({
      env,
      services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
      infra: this.infra,
      logPath: this.pipeline.getLogPath(id, 'data')
    })
    if (!dropped.ok) {
      throw new Error(dropped.error)
    }
    this.startSetup(id, {
      steps: options.reseed ? ['data', 'seed'] : ['data'],
      withSeed: options.reseed
    })
  }

  async delete(id: string, options: { dropData: boolean }): Promise<void> {
    const env = this.deps.store.getDevEnv(id)
    if (!env) {
      return
    }
    this.pipeline.cancel(id)
    await this.services.stop(id, 'all')
    this.proxy.clearRoutes(id)
    const template = this.getTemplate(env)
    if (options.dropData && template) {
      const dropped = await dropDevEnvData({
        env,
        services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
        infra: this.infra,
        logPath: this.pipeline.getLogPath(id, 'data')
      })
      if (!dropped.ok) {
        throw new Error(dropped.error)
      }
    }
    this.deps.store.deleteDevEnv(id)
    this.services.forget(id)
    this.hostnameErrors.delete(id)
    rmSync(join(this.deps.userDataDir, 'dev-envs', 'envs', id), { recursive: true, force: true })
    this.deps.notify(id)
  }

  protected async detach(env: DevEnv): Promise<void> {
    if (env.detached) {
      return
    }
    await this.services.stop(env.id, 'all')
    this.proxy.clearRoutes(env.id)
    this.deps.store.updateDevEnv(env.id, { detached: true })
    this.deps.notify(env.id)
  }

  /** Follows previews appearing or disappearing and detaches envs whose mission is gone. */
  async reconcileMissions(): Promise<void> {
    for (const env of this.deps.store.getDevEnvs()) {
      if (env.attachment.kind !== 'mission') {
        continue
      }
      const mission = this.deps.store.getMission(env.attachment.missionId)
      if (!mission) {
        await this.detach(env)
        continue
      }
      const template = this.getTemplate(env)
      if (!template) {
        continue
      }
      const after = resolveMissionSlotWorktrees(
        mission,
        template,
        env.slotPins,
        this.lookupWorktree
      )
      const moved = getMovedDevEnvSlots(env.slotWorktrees, after)
      if (moved.length === 0) {
        continue
      }
      await this.services.markMoved(env, template, moved)
      const updated = this.deps.store.updateDevEnv(env.id, { slotWorktrees: after }) ?? env
      await this.publishRoutes(updated, template)
      const rebound = moved.filter((slot) => after[slot])
      if (rebound.length > 0) {
        this.startSetup(env.id, { steps: ['env', 'install'], slots: rebound })
      }
      this.deps.notify(env.id)
    }
  }

  async reconcileWorktrees(): Promise<void> {
    for (const env of this.deps.store.getDevEnvs()) {
      if (env.attachment.kind === 'worktree' && !this.lookupWorktree(env.attachment.worktreeId)) {
        await this.detach(env)
      }
    }
  }
}
