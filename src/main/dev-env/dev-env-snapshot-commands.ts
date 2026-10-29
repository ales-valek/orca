import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { getReferencedDevEnvInfra } from '../../shared/dev-env/dev-env-infra-references'
import { DEV_ENV_NAME_PATTERN, type DevEnvSnapshot } from '../../shared/dev-env/dev-env-types'
import { DevEnvLifecycle } from './dev-env-lifecycle'
import { restoreDevEnvData, snapshotDevEnvData } from './dev-env-snapshots'

export abstract class DevEnvSnapshotCommands extends DevEnvLifecycle {
  private getSnapshotDir(envId: string, name: string): string {
    if (!DEV_ENV_NAME_PATTERN.test(name)) {
      throw new Error('Snapshot name must be lowercase letters, digits and dashes')
    }
    return join(this.deps.userDataDir, 'dev-envs', 'envs', envId, 'snapshots', name)
  }

  listSnapshots(id: string): DevEnvSnapshot[] {
    return this.requireEnv(id).env.snapshots ?? []
  }

  async snapshot(id: string, name: string): Promise<DevEnvSnapshot> {
    const { env, template } = this.requireEnv(id)
    const result = await snapshotDevEnvData({
      env,
      services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
      infra: this.infra,
      dir: this.getSnapshotDir(id, name),
      logPath: this.pipeline.getLogPath(id, 'data')
    })
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
  async restoreSnapshot(id: string, name: string): Promise<void> {
    const { env, template } = this.requireEnv(id)
    const snapshot = this.listSnapshots(id).find((entry) => entry.name === name)
    if (!snapshot) {
      throw new Error(`No snapshot ${name}`)
    }
    if (this.pipeline.isRunning(id)) {
      throw new Error('Setup is already running')
    }
    const states = await this.services.getStates(
      env,
      template,
      this.deps.getSettings().devEnvProxyPort
    )
    const wereUp = states.filter((state) => state.status === 'up').map((state) => state.name)
    await this.services.stop(id, 'all')
    const result = await restoreDevEnvData({
      env,
      services: getReferencedDevEnvInfra(template, this.deps.getSettings().devEnvInfra),
      infra: this.infra,
      dir: this.getSnapshotDir(id, name),
      logPath: this.pipeline.getLogPath(id, 'data'),
      names: snapshot.services
    })
    if (!result.ok) {
      throw new Error(result.error)
    }
    if (wereUp.length > 0) {
      await this.services.start(env, template, wereUp)
    }
  }

  deleteSnapshot(id: string, name: string): void {
    const dir = this.getSnapshotDir(id, name)
    rmSync(dir, { recursive: true, force: true })
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
