import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getBranchTip, getMergeBase } from '../git/stack-layer-git'

const tempRoots: string[] = []

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function commitFile(repo: string, name: string, message: string): Promise<string> {
  await writeFile(path.join(repo, name), `${message}\n`, 'utf8')
  git(repo, ['add', name])
  git(repo, ['commit', '-q', '-m', message])
  return git(repo, ['rev-parse', 'HEAD'])
}

async function createRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-task-layers-'))
  tempRoots.push(root)
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'ada@example.com'])
  git(root, ['config', 'user.name', 'Ada Lovelace'])
  git(root, ['config', 'commit.gpgSign', 'false'])
  await commitFile(root, 'base.txt', 'base')
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('task layer git reads', () => {
  it('bases a pre-existing task branch on the older mission commit it forked from', async () => {
    const repo = await createRepo()
    git(repo, ['checkout', '-q', '-b', 'mission/x'])
    const olderMissionSha = await commitFile(repo, 'mission-1.txt', 'older mission')
    git(repo, ['checkout', '-q', '-b', 'mission-task/x/t'])
    await commitFile(repo, 'task.txt', 'task work')
    git(repo, ['checkout', '-q', 'mission/x'])
    const missionTip = await commitFile(repo, 'mission-2.txt', 'newer mission')

    expect(await getBranchTip(repo, 'mission/x')).toBe(missionTip)
    // Why: the parent tip would make the first restack replay the newer mission commit.
    expect(await getMergeBase(repo, 'mission/x', 'mission-task/x/t')).toBe(olderMissionSha)
  })

  it('returns null for a missing branch instead of throwing', async () => {
    const repo = await createRepo()

    await expect(getBranchTip(repo, 'mission-task/x/missing')).resolves.toBeNull()
    await expect(getMergeBase(repo, 'main', 'mission-task/x/missing')).resolves.toBeNull()
  })
})
