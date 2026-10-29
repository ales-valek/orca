import type { StepOutcome, StepRun } from './dev-env-setup-pipeline'
import {
  DEV_ENV_COMMAND_TIMEOUT_MS,
  runDevEnvShellCommand,
  type DevEnvExec
} from './dev-env-shell-command'

export async function runDevEnvSeedStep(run: StepRun, exec?: DevEnvExec): Promise<StepOutcome> {
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
      timeoutMs: DEV_ENV_COMMAND_TIMEOUT_MS,
      signal: run.signal
    },
    exec
  )
  return result.ok
    ? { status: 'done', detail: seed.command }
    : { status: 'failed', error: `"${seed.command}" failed (exit ${String(result.code)})` }
}
