import type { DevEnv } from '../../shared/dev-env/dev-env-types'
import { getDevEnvForWorktree } from './test-run-targets'
import type { TestRunTarget } from '../../shared/test-runs/test-run-launch-types'
import type { TestRunSettings } from '../../shared/test-runs/test-run-settings'

/** Same key shape the run lock derives for runs started in a terminal. */
export function getTargetLockKey(target: TestRunTarget): string {
  return target.kind === 'dev-env' ? `dev-env:${target.devEnvId}` : `preset:${target.name}`
}

/** Folder of Orca's checkout of `repoId` for one target. */
export function getCheckoutKey(repoId: string, target: TestRunTarget): string {
  return `${repoId}__${getTargetLockKey(target)}`.replace(/[^\w.-]+/g, '-')
}

export function getTargetEnv(
  target: TestRunTarget,
  settings: TestRunSettings
): { env: Record<string, string> } | { error: string } {
  if (target.kind === 'dev-env') {
    return { env: settings.localEnv }
  }
  const preset = settings.presets.find((entry) => entry.name === target.name)
  return preset
    ? { env: preset.env }
    : { error: `Preset ${target.name} is not defined in Settings → Dev Environments.` }
}

/**
 * A worktree source brings its own rendered env files; against a Dev Environment it must be
 * one of that environment's worktrees, or the run would hit another, unlocked environment.
 */
export function getSourceTargetError(input: {
  sourceWorktreeId: string | null
  target: TestRunTarget
  envs: DevEnv[]
}): string | null {
  const { sourceWorktreeId, target, envs } = input
  if (target.kind !== 'dev-env' || sourceWorktreeId === null) {
    return null
  }
  const owner = getDevEnvForWorktree(envs, sourceWorktreeId)
  if (owner?.id === target.devEnvId) {
    return null
  }
  const targetName = envs.find((env) => env.id === target.devEnvId)?.name ?? target.devEnvId
  return `This worktree belongs to ${owner?.name ?? 'no Dev Environment'}, so its tests would not run against ${targetName}. Pick the repo @ origin/main or a worktree of ${targetName}.`
}
