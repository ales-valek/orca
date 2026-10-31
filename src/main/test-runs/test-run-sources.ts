import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_PATTERN = /^playwright(\.[\w-]+)?\.config\.(ts|js|mjs|cjs)$/

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
  return readdirSync(dir)
    .filter((name) => CONFIG_PATTERN.test(name))
    .toSorted(
      (a, b) =>
        Number(!a.startsWith('playwright.config.')) - Number(!b.startsWith('playwright.config.')) ||
        a.localeCompare(b)
    )
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
