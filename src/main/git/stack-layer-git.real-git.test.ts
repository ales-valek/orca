import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectConflictOperation } from './source-control/git-conflict-operation'
import {
  autosquashLayer,
  commitFixup,
  isWorktreeClean,
  rebaseLayerOnto,
  resetPreviewKeep
} from './stack-layer-git'

const tempRoots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function commitFile(cwd: string, file: string, content: string, message: string) {
  await writeFile(path.join(cwd, file), content, 'utf8')
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', message])
}

async function createRepo(): Promise<{
  root: string
  addWorktree: (branch: string, from: string) => string
}> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'orca-stack-layer-')))
  tempRoots.push(parent)
  const root = path.join(parent, 'repo')
  git(parent, ['init', '-q', '-b', 'main', root])
  git(root, ['config', 'user.email', 'ada@example.com'])
  git(root, ['config', 'user.name', 'Ada Lovelace'])
  git(root, ['config', 'commit.gpgSign', 'false'])
  await commitFile(root, 'f.txt', 'base\n', 'base')
  await commitFile(root, 'g.txt', 'base\n', 'base g')
  const addWorktree = (branch: string, from: string): string => {
    const target = path.join(parent, branch)
    git(root, ['worktree', 'add', '-q', '-b', branch, target, from])
    return target
  }
  return { root, addWorktree }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('isWorktreeClean', () => {
  it('reports untracked files as dirty', async () => {
    const { root } = await createRepo()
    expect(await isWorktreeClean(root)).toBe(true)
    await writeFile(path.join(root, 'new.txt'), 'x\n', 'utf8')
    expect(await isWorktreeClean(root)).toBe(false)
  })
})

describe('rebaseLayerOnto', () => {
  it('replays only the layer commits onto the moved parent', async () => {
    const { addWorktree } = await createRepo()
    const wtA = addWorktree('A', 'main')
    await commitFile(wtA, 'a.txt', 'a\n', 'A1')
    const oldA = git(wtA, ['rev-parse', 'HEAD'])
    const wtB = addWorktree('B', 'A')
    await commitFile(wtB, 'b.txt', 'b\n', 'B1')
    await writeFile(path.join(wtA, 'a.txt'), 'a\na2\n', 'utf8')
    git(wtA, ['commit', '-q', '--amend', '-a', '-m', 'A1 amended'])
    const newA = git(wtA, ['rev-parse', 'HEAD'])

    await expect(rebaseLayerOnto(wtB, newA, oldA)).resolves.toEqual({ status: 'rebased' })

    expect(git(wtB, ['log', '--format=%s', `${newA}..B`]).split('\n')).toEqual(['B1'])
  })

  it('returns conflict and leaves the rebase in progress', async () => {
    const { addWorktree } = await createRepo()
    const wtA = addWorktree('A', 'main')
    await commitFile(wtA, 'a.txt', 'a\n', 'A1')
    const oldA = git(wtA, ['rev-parse', 'HEAD'])
    const wtB = addWorktree('B', 'A')
    await commitFile(wtB, 'a.txt', 'from B\n', 'B1')
    await writeFile(path.join(wtA, 'a.txt'), 'from A\n', 'utf8')
    git(wtA, ['commit', '-q', '--amend', '-a', '-m', 'A1 amended'])
    const newA = git(wtA, ['rev-parse', 'HEAD'])

    await expect(rebaseLayerOnto(wtB, newA, oldA)).resolves.toEqual({ status: 'conflict' })

    expect(await detectConflictOperation(wtB)).toBe('rebase')
  })

  it('rethrows failures that are not conflicts', async () => {
    const { addWorktree } = await createRepo()
    const wtA = addWorktree('A', 'main')
    const tip = git(wtA, ['rev-parse', 'HEAD'])

    await expect(rebaseLayerOnto(wtA, 'refs/heads/does-not-exist', tip)).rejects.toThrow()
  })
})

describe('resetPreviewKeep', () => {
  it('moves HEAD and keeps a local edit in an untouched file', async () => {
    const { root, addWorktree } = await createRepo()
    const wtT = addWorktree('target', 'main')
    await commitFile(wtT, 'g.txt', 'changed\n', 'touch g')
    const target = git(wtT, ['rev-parse', 'HEAD'])
    const preview = addWorktree('preview', 'main')
    await writeFile(path.join(preview, 'f.txt'), 'local edit\n', 'utf8')

    await expect(resetPreviewKeep(preview, target)).resolves.toEqual({ status: 'moved' })

    expect(git(preview, ['rev-parse', 'HEAD'])).toBe(target)
    expect(await readFile(path.join(preview, 'f.txt'), 'utf8')).toBe('local edit\n')
    expect(git(root, ['rev-parse', 'main'])).not.toBe(target)
  })

  it('is blocked when the edited file differs in the target', async () => {
    const { addWorktree } = await createRepo()
    const wtT = addWorktree('target', 'main')
    await commitFile(wtT, 'f.txt', 'upstream\n', 'touch f')
    const target = git(wtT, ['rev-parse', 'HEAD'])
    const preview = addWorktree('preview', 'main')
    const before = git(preview, ['rev-parse', 'HEAD'])
    await writeFile(path.join(preview, 'f.txt'), 'local edit\n', 'utf8')

    const result = await resetPreviewKeep(preview, target)

    expect(result.status).toBe('blocked')
    expect(git(preview, ['rev-parse', 'HEAD'])).toBe(before)
    expect(await readFile(path.join(preview, 'f.txt'), 'utf8')).toBe('local edit\n')
  })

  it('is blocked when an untracked file would be overwritten by the target', async () => {
    const { addWorktree } = await createRepo()
    const wtT = addWorktree('target', 'main')
    await commitFile(wtT, 'new.txt', 'upstream\n', 'add new')
    const target = git(wtT, ['rev-parse', 'HEAD'])
    const preview = addWorktree('preview', 'main')
    const before = git(preview, ['rev-parse', 'HEAD'])
    await writeFile(path.join(preview, 'new.txt'), 'untracked mine\n', 'utf8')

    const result = await resetPreviewKeep(preview, target)

    expect(result.status).toBe('blocked')
    expect(git(preview, ['rev-parse', 'HEAD'])).toBe(before)
    expect(await readFile(path.join(preview, 'new.txt'), 'utf8')).toBe('untracked mine\n')
  })
})

describe('commitFixup and autosquashLayer', () => {
  async function createLayerWithTwoCommits() {
    const repo = await createRepo()
    const parentBase = git(repo.root, ['rev-parse', 'main'])
    const layer = repo.addWorktree('layer', 'main')
    await commitFile(layer, 'x.txt', 'one\n', 'L1')
    const first = git(layer, ['rev-parse', 'HEAD'])
    await commitFile(layer, 'y.txt', 'two\n', 'L2')
    await writeFile(path.join(layer, 'x.txt'), 'one\npatched\n', 'utf8')
    const patch = `${git(layer, ['diff'])}\n`
    git(layer, ['checkout', '--', 'x.txt'])
    return { layer, first, parentBase, patch }
  }

  it('folds a fixup into its target commit and keeps the commit count', async () => {
    const { layer, first, parentBase, patch } = await createLayerWithTwoCommits()

    await commitFixup(layer, patch, { fixupOf: first })
    expect(git(layer, ['rev-list', '--count', `${parentBase}..HEAD`])).toBe('3')
    await expect(autosquashLayer(layer, parentBase)).resolves.toEqual({ status: 'squashed' })

    expect(git(layer, ['rev-list', '--count', `${parentBase}..HEAD`])).toBe('2')
    const firstCommit = git(layer, ['rev-list', '--reverse', `${parentBase}..HEAD`]).split('\n')[0]
    expect(git(layer, ['show', `${firstCommit}:x.txt`])).toContain('patched')
    expect(await isWorktreeClean(layer)).toBe(true)
  })

  it('commits a patch with an explicit message', async () => {
    const { layer, patch } = await createLayerWithTwoCommits()

    await commitFixup(layer, patch, { message: 'L3 patch' })

    expect(git(layer, ['log', '-1', '--format=%s'])).toBe('L3 patch')
    expect(git(layer, ['show', 'HEAD:x.txt'])).toContain('patched')
  })
})
