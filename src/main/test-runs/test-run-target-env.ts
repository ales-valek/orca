import type { DevEnv } from '../../shared/dev-env/dev-env-types'
import type { TestRunTarget } from '../../shared/test-runs/test-run-launch-types'
import type { TestRunSettings } from '../../shared/test-runs/test-run-settings'

/** Same key shape the run lock derives for runs started in a terminal. */
export function getTargetLockKey(target: TestRunTarget): string {
  return target.kind === 'dev-env' ? `dev-env:${target.devEnvId}` : `preset:${target.name}`
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

/** The workspace whose Tests panel shows the run: the environment's own worktree. */
export function getTargetWorktreeId(target: TestRunTarget, envs: DevEnv[]): string | null {
  if (target.kind !== 'dev-env') {
    return null
  }
  const env = envs.find((entry) => entry.id === target.devEnvId)
  if (!env) {
    return null
  }
  if (env.attachment.kind === 'worktree') {
    return env.attachment.worktreeId
  }
  return Object.values(env.slotWorktrees).find((slot) => slot !== null)?.worktreeId ?? null
}
