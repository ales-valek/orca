import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnv } from '../../shared/dev-env/dev-env-types'

function getSlotWorktreeIds(env: DevEnv): string[] {
  return Object.values(env.slotWorktrees).flatMap((slot) => (slot ? [slot.worktreeId] : []))
}

/** Same rule as the renderer's findDevEnvForWorktree: the attachment wins over a slot. */
export function getDevEnvForWorktree(envs: DevEnv[], worktreeId: string): DevEnv | null {
  return (
    envs.find(
      (env) => env.attachment.kind === 'worktree' && env.attachment.worktreeId === worktreeId
    ) ??
    envs.find((env) => getSlotWorktreeIds(env).includes(worktreeId)) ??
    null
  )
}

/** Every worktree that belongs to an environment, mapped to that environment's id. */
export function buildTestRunTargetMap(envs: DevEnv[]): Record<string, string> {
  const worktreeIds = new Set(
    envs.flatMap((env) => [
      ...(env.attachment.kind === 'worktree' ? [env.attachment.worktreeId] : []),
      ...getSlotWorktreeIds(env)
    ])
  )
  return Object.fromEntries(
    [...worktreeIds].flatMap((worktreeId) => {
      const env = getDevEnvForWorktree(envs, worktreeId)
      return env ? [[worktreeId, env.id]] : []
    })
  )
}

/** Read by the run lock and the reporter, which run inside test repos and cannot ask Orca. */
export function writeTestRunTargetMap(dir: string, envs: DevEnv[]): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'targets.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(buildTestRunTargetMap(envs), null, 2))
  renameSync(`${file}.tmp`, file)
}
