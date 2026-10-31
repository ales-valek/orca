const DEFAULT_TIER_PATTERN = /(?:^|\/)tier-(\d+)\//

/** One value for every spelling of a remote, so worktrees and clones of a repo share test identities. */
export function normalizeOriginUrl(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):(?!\d)/, '$1/')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
}

function getPathBasename(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? path
}

/** Groups runs of every worktree and clone of one repo; also the prefix of its test identities. */
export function getRepoKey(repo: { root: string; originUrl: string | null }): string {
  return repo.originUrl ? normalizeOriginUrl(repo.originUrl) : getPathBasename(repo.root)
}

/** Stable across runs, worktrees and clones of one repo. */
export function getTestIdentity(input: {
  originUrl: string | null
  repoRootName: string
  configFile: string
  project: string
  file: string
  titlePath: string[]
}): string {
  const repo = input.originUrl ? normalizeOriginUrl(input.originUrl) : input.repoRootName
  return [repo, input.configFile, input.project, input.file, input.titlePath.join(' › ')].join('|')
}

export function getTestTier(file: string, pattern: RegExp = DEFAULT_TIER_PATTERN): number | null {
  const match = pattern.exec(file)
  return match ? Number(match[1]) : null
}
