import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runDevEnvExec, type DevEnvExec } from './dev-env-shell-command'

const DYNAMIC_MARKER = '# --- DYNAMIC ('

/** `git check-ignore`; folder workspaces only accept files Orca already owns or that don't exist. */
export async function isDevEnvFileGitIgnored(
  worktreePath: string,
  relPath: string,
  exec: DevEnvExec = runDevEnvExec
): Promise<boolean> {
  if (!existsSync(join(worktreePath, '.git'))) {
    const path = join(worktreePath, relPath)
    return !existsSync(path) || readFileSync(path, 'utf8').includes(DYNAMIC_MARKER)
  }
  const result = await exec('git', ['check-ignore', '-q', relPath], {
    cwd: worktreePath,
    timeoutMs: 10_000
  })
  return result.code === 0
}
