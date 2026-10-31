import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFeatureScope } from './test-feature-scope'

let dir: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function commit(cwd: string, file: string, content = 'x'): void {
  mkdirSync(join(cwd, file, '..'), { recursive: true })
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', '.')
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file)
}

describe('getFeatureScope', () => {
  let repo: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-feature-scope-'))
    const origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    const seed = join(dir, 'seed')
    git(dir, 'clone', '-q', origin, seed)
    commit(seed, 'tests/a.spec.ts')
    git(seed, 'push', '-q', 'origin', 'HEAD:main')
    repo = join(dir, 'repo')
    git(dir, 'clone', '-q', origin, repo)
    git(repo, 'checkout', '-qb', 'feature')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists changed spec and other files since the merge base', async () => {
    commit(repo, 'tests/b.spec.ts')
    commit(repo, 'src/pages/cart.ts')
    const scope = await getFeatureScope({ path: repo })
    expect(scope.changedSpecFiles).toEqual(['tests/b.spec.ts'])
    expect(scope.changedOtherFiles).toEqual(['src/pages/cart.ts'])
    expect(scope.baseCommit).toBe(git(repo, 'rev-parse', 'origin/main').trim())
    expect(scope.since).toBe(
      Number(git(repo, 'show', '-s', '--format=%ct', 'origin/main').trim()) * 1000
    )
  })

  it('includes uncommitted changes', async () => {
    writeFileSync(join(repo, 'tests', 'a.spec.ts'), 'changed')
    expect((await getFeatureScope({ path: repo })).changedSpecFiles).toEqual(['tests/a.spec.ts'])
  })

  it('returns an empty change set without a merge base', async () => {
    const folder = join(dir, 'folder')
    mkdirSync(folder)
    await expect(getFeatureScope({ path: folder })).resolves.toEqual({
      baseCommit: null,
      since: null,
      changedSpecFiles: [],
      changedOtherFiles: []
    })
  })
})
