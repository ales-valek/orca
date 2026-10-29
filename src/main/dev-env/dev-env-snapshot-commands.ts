import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { getReferencedDevEnvInfra } from '../../shared/dev-env/dev-env-infra-references'
import { DEV_ENV_NAME_PATTERN, type DevEnvSnapshot } from '../../shared/dev-env/dev-env-types'
import { DevEnvLifecycle } from './dev-env-lifecycle'
import { getDevEnvRestoreProblem, restoreDevEnvData, snapshotDevEnvData } from './dev-env-snapshots'

export abstract class DevEnvSnapshotCommands extends DevEnvLifecycle {
  private getSnapshotDir(envId: string, name: string): string {
    if (!DEV_ENV_NAME_PATTERN.test(name)) {
      throw new Error('Snapshot name must be lowercase letters, digits and dashes')
    }
    return join(this.deps.userDataDir, 'dev-envs', 'envs', envId, 'snapshots', name)
  }

  /** One data operation per env; setup requests made meanwhile run once it ends. */
  private async runExclusive<T>(id: string, label: string, work: () => Promise<T>): Promise<T> {
    this.assertDataIdle(id)
    if (this.pipeline.isRunning(id)) {
      throw new Error('Setup is already running')
    }
    this.dataBusy.set(id, label)
    try {
      return await work()
    } finally {
      this.dataBusy.delete(id)
      this.startPendingSetup(id)
    }
  }

  listSnapshots(id: string): DevEnvSnapshot[] {
    return this.requireEnv(id).env.snapshots ?? []
  }

  async snapshot(id: string, name: string): Promise<DevEnvSnapshot> {
    const { env, template } = this.requireEnv(id)
    const dir = this.getSnapshotDir(id, name)
    const result = await this.runExclusive(id, 'snapshot', () =>
      snapshotDevEnvData({
        env,
        services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
        infra: this.infra,
        dir,
        logPath: this.pipeline.getLogPath(id, 'data')
      })
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    const snapshot: DevEnvSnapshot = {
      name,
      createdAt: Date.now(),
      sizeBytes: result.sizeBytes,
      services: result.services
    }
    this.saveSnapshots(id, [snapshot, ...this.listSnapshots(id).filter((s) => s.name !== name)])
    return snapshot
  }

  /** Stops the services, restores, then restarts the ones that were up; a failure leaves them stopped. */
  async restoreSnapshot(id: string, name: string): Promise<{ errors: string[] }> {
    const { env, template } = this.requireEnv(id)
    const snapshot = this.listSnapshots(id).find((entry) => entry.name === name)
    if (!snapshot) {
      throw new Error(`No snapshot ${name}`)
    }
    const input = {
      env,
      services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
      infra: this.infra,
      dir: this.getSnapshotDir(id, name),
      logPath: this.pipeline.getLogPath(id, 'data'),
      names: snapshot.services
    }
    const problem = getDevEnvRestoreProblem(input)
    if (problem) {
      throw new Error(problem)
    }
    return this.runExclusive(id, 'restore', async () => {
      const states = await this.services.getStates(
        env,
        template,
        this.deps.getSettings().devEnvProxyPort
      )
      const wereUp = states
        .filter((state) => state.status === 'up' || state.status === 'starting')
        .map((state) => state.name)
      await this.services.stop(id, 'all')
      const result = await restoreDevEnvData(input)
      if (!result.ok) {
        throw new Error(result.error)
      }
      return wereUp.length > 0 ? this.services.start(env, template, wereUp) : { errors: [] }
    })
  }

  deleteSnapshot(id: string, name: string): void {
    this.assertDataIdle(id)
    rmSync(this.getSnapshotDir(id, name), { recursive: true, force: true })
    this.saveSnapshots(
      id,
      this.listSnapshots(id).filter((entry) => entry.name !== name)
    )
  }

  private saveSnapshots(id: string, snapshots: DevEnvSnapshot[]): void {
    this.deps.store.updateDevEnv(id, {
      snapshots: snapshots.toSorted((a, b) => b.createdAt - a.createdAt)
    })
    this.deps.notify(id)
  }
}
