import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteOrcaOwnedBranch, listLocalBranchesUnder } from './mission-branch-refs'

const roots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function createRepo(): Promise<string> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'orca-branch-refs-')))
  roots.push(parent)
  const repo = path.join(parent, 'repo')
  git(parent, ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'ada@example.com'])
  git(repo, ['config', 'user.name', 'Ada Lovelace'])
  git(repo, ['config', 'commit.gpgSign', 'false'])
  await writeFile(path.join(repo, 'base.txt'), 'base\n', 'utf8')
  git(repo, ['add', 'base.txt'])
  git(repo, ['commit', '-q', '-m', 'base'])
  return repo
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mission branch refs', () => {
  it('lists only the local branches under a prefix', async () => {
    const repo = await createRepo()
    git(repo, ['branch', 'mission-task/x/omp-1'])
    git(repo, ['branch', 'mission-task/x/omp-1-2'])
    git(repo, ['branch', 'mission-task/xy/other'])

    expect(await listLocalBranchesUnder(repo, 'mission-task/x/')).toEqual(
      new Set(['mission-task/x/omp-1', 'mission-task/x/omp-1-2'])
    )
  })

  it('deletes a preview branch whose tip a task branch still contains', async () => {
    const repo = await createRepo()
    git(repo, ['checkout', '-q', '-b', 'mission-task/x/t1'])
    git(repo, ['commit', '-q', '--allow-empty', '-m', 't1'])
    git(repo, ['branch', 'mission-preview/x'])
    git(repo, ['checkout', '-q', 'main'])

    expect(await deleteOrcaOwnedBranch(repo, 'mission-preview/x')).toBe('deleted')
    expect(git(repo, ['branch', '--list', 'mission-preview/x'])).toBe('')
    expect(await deleteOrcaOwnedBranch(repo, 'mission-preview/x')).toBe('missing')
  })

  it('keeps a preview branch with a commit no other branch contains', async () => {
    const repo = await createRepo()
    git(repo, ['checkout', '-q', '-b', 'mission-preview/x'])
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'preview only'])
    const tip = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['checkout', '-q', 'main'])

    expect(await deleteOrcaOwnedBranch(repo, 'mission-preview/x')).toBe('kept')
    expect(git(repo, ['rev-parse', 'mission-preview/x'])).toBe(tip)
  })
})
