import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDefaultBaseRefViaExec } from '../../shared/git/refs/git-default-base-ref'
import { PLAYWRIGHT_CONFIG_FILE_PATTERN } from '../../shared/test-runs/test-run-launch-types'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'

export type TestRunSource =
  | { kind: 'origin-main'; repoId: string; repoPath: string; label: string }
  | { kind: 'worktree'; repoId: string; worktreeId: string; path: string; label: string }

/** The repo's own Playwright CLI; Orca runs it with its own Node. */
export function findPlaywrightCli(dir: string): string | null {
  const candidates = [
    join(dir, 'node_modules', 'playwright', 'cli.js'),
    join(dir, 'node_modules', '@playwright', 'test', 'cli.js')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Root-level Playwright configs, `playwright.config.*` first. */
export function findPlaywrightConfigs(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return sortConfigs(readdirSync(dir))
}

function sortConfigs(names: string[]): string[] {
  return names
    .filter((name) => PLAYWRIGHT_CONFIG_FILE_PATTERN.test(name))
    .toSorted(
      (a, b) =>
        Number(!a.startsWith('playwright.config.')) - Number(!b.startsWith('playwright.config.')) ||
        a.localeCompare(b)
    )
}

/** Configs on the default branch, which Orca's origin/main checkout will have. */
export async function listPlaywrightConfigsAtDefaultBranch(repoPath: string): Promise<string[]> {
  const git = async (argv: string[]): Promise<{ stdout: string }> =>
    gitExecFileAsync(argv, { cwd: repoPath })
  try {
    const ref = await resolveDefaultBaseRefViaExec(git)
    if (ref) {
      return sortConfigs((await git(['ls-tree', '--name-only', ref])).stdout.split('\n'))
    }
  } catch {
    // Without a readable default branch, the working copy's configs are the best guess.
  }
  return findPlaywrightConfigs(repoPath)
}

/** Local repos with a Playwright config: their origin/main plus each of their worktrees. */
export function listTestRunSources(input: {
  repos: { id: string; path: string; name: string; connectionId?: string | null }[]
  worktrees: { id: string; repoId: string; path: string; label: string }[]
}): TestRunSource[] {
  return input.repos
    .filter((repo) => !repo.connectionId && findPlaywrightConfigs(repo.path).length > 0)
    .flatMap((repo): TestRunSource[] => [
      {
        kind: 'origin-main',
        repoId: repo.id,
        repoPath: repo.path,
        label: `${repo.name} @ origin/main`
      },
      ...input.worktrees
        .filter((worktree) => worktree.repoId === repo.id)
        .map((worktree): TestRunSource => ({
          kind: 'worktree',
          repoId: repo.id,
          worktreeId: worktree.id,
          path: worktree.path,
          label: `${repo.name} · ${worktree.label}`
        }))
    ])
}
