import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getCommitsAheadCount, getRemoteTrackingTip, pushStackBranch } from './stack-branch-push'

const roots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function commit(cwd: string, file: string): Promise<string> {
  await writeFile(path.join(cwd, file), file, 'utf8')
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', file])
  return git(cwd, ['rev-parse', 'HEAD'])
}

async function createRepoWithBareRemote(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'stack-push-'))
  roots.push(root)
  const remote = path.join(root, 'remote.git')
  const repo = path.join(root, 'repo')
  git(root, ['init', '-q', '--bare', remote])
  git(root, ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 't@example.com'])
  git(repo, ['config', 'user.name', 't'])
  git(repo, ['remote', 'add', 'origin', remote])
  await commit(repo, 'base.txt')
  git(repo, ['push', '-q', 'origin', 'main'])
  git(repo, ['checkout', '-q', '-b', 'mission-task/x/one'])
  return repo
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('stack branch push', () => {
  it('counts commits against the remote-tracking base and reads the pushed tip', async () => {
    const repo = await createRepoWithBareRemote()
    expect(await getCommitsAheadCount(repo, 'origin', 'main', 'mission-task/x/one')).toBe(0)
    const tip = await commit(repo, 'one.txt')
    expect(await getCommitsAheadCount(repo, 'origin', 'main', 'mission-task/x/one')).toBe(1)
    expect(await getRemoteTrackingTip(repo, 'origin', 'mission-task/x/one')).toBeNull()

    await pushStackBranch(repo, 'origin', 'mission-task/x/one')

    expect(await getRemoteTrackingTip(repo, 'origin', 'mission-task/x/one')).toBe(tip)
  })

  it('overwrites a rewritten branch only while the lease matches the remote', async () => {
    const repo = await createRepoWithBareRemote()
    await commit(repo, 'one.txt')
    await pushStackBranch(repo, 'origin', 'mission-task/x/one')
    const pushed = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['commit', '-q', '--amend', '-m', 'amended'])
    const amended = git(repo, ['rev-parse', 'HEAD'])

    await expect(
      pushStackBranch(repo, 'origin', 'mission-task/x/one', '0'.repeat(40))
    ).rejects.toThrow()
    await expect(pushStackBranch(repo, 'origin', 'mission-task/x/one')).rejects.toThrow()
    await pushStackBranch(repo, 'origin', 'mission-task/x/one', pushed)

    expect(await getRemoteTrackingTip(repo, 'origin', 'mission-task/x/one')).toBe(amended)
  })
})
