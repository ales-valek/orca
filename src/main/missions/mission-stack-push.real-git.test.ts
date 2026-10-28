import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { createLocalMissionStackPushDeps } from './mission-stack-pull-request-git'
import { pushMissionStack } from './mission-stack-pull-requests'

const roots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function commit(cwd: string, file: string): Promise<string> {
  await writeFile(path.join(cwd, file), `${file}\n`, 'utf8')
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', file])
  return git(cwd, ['rev-parse', 'HEAD'])
}

function configureUser(cwd: string): void {
  git(cwd, ['config', 'user.email', 'ada@example.com'])
  git(cwd, ['config', 'user.name', 'Ada Lovelace'])
  git(cwd, ['config', 'commit.gpgSign', 'false'])
}

/** A mission branch and one task layer, both published to a local bare remote. */
async function createPublishedStack() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'orca-stack-push-')))
  roots.push(root)
  const remote = path.join(root, 'remote.git')
  const local = path.join(root, 'local')
  git(root, ['init', '-q', '--bare', remote])
  git(root, ['init', '-q', '-b', 'main', local])
  configureUser(local)
  git(local, ['remote', 'add', 'origin', remote])
  await commit(local, 'base.txt')
  git(local, ['push', '-q', 'origin', 'main'])
  git(local, ['checkout', '-q', '-b', 'mission/x'])
  const missionTip = await commit(local, 'mission.txt')
  git(local, ['checkout', '-q', '-b', 'mission-task/x/t1'])
  await commit(local, 't1.txt')
  git(local, ['push', '-q', 'origin', 'mission/x', 'mission-task/x/t1'])
  git(local, ['checkout', '-q', 'mission/x'])
  const repo: Repo = { id: 'r1', path: local, displayName: 'repo', badgeColor: '#000', addedAt: 0 }
  const mission: Mission = {
    id: 'm1',
    name: 'X',
    branchName: 'mission/x',
    members: [{ repoId: 'r1', worktreeId: `r1::${local}`, addedAt: 0 }],
    tasks: [
      {
        id: 't1',
        repoId: 'r1',
        order: 1,
        title: 'T1',
        branchName: 'mission-task/x/t1',
        worktreeId: null,
        parentBaseSha: missionTip,
        addedAt: 0
      }
    ],
    tabOrder: 0,
    createdAt: 0,
    updatedAt: 0
  }
  return { root, remote, local, repo, mission }
}

function remoteTip(remote: string, branch: string): string {
  return git(remote, ['rev-parse', `refs/heads/${branch}`])
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pushMissionStack against a local bare remote', () => {
  it('pushes nothing when the remote branch gained commits the local branch lacks', async () => {
    const { root, remote, local, repo, mission } = await createPublishedStack()
    // Why: a colleague (or GitHub "Update branch") adds a commit; the local repo only fetches it.
    const colleague = path.join(root, 'colleague')
    git(root, ['clone', '-q', '-b', 'mission-task/x/t1', remote, colleague])
    configureUser(colleague)
    const foreign = await commit(colleague, 'foreign.txt')
    git(colleague, ['push', '-q', 'origin', 'mission-task/x/t1'])
    git(local, ['fetch', '-q', 'origin'])

    const result = await pushMissionStack(
      { mission, repoId: 'r1' },
      await createLocalMissionStackPushDeps(repo)
    )

    expect(result).toEqual({ pushed: [] })
    expect(remoteTip(remote, 'mission-task/x/t1')).toBe(foreign)
  })

  it('force-pushes a rewritten layer with a lease', async () => {
    const { local, remote, repo, mission } = await createPublishedStack()
    git(local, ['checkout', '-q', 'mission-task/x/t1'])
    git(local, ['commit', '-q', '--amend', '-m', 't1 amended'])
    const amended = git(local, ['rev-parse', 'HEAD'])

    const result = await pushMissionStack(
      { mission, repoId: 'r1' },
      await createLocalMissionStackPushDeps(repo)
    )

    expect(result).toEqual({ pushed: ['mission-task/x/t1'] })
    expect(remoteTip(remote, 'mission-task/x/t1')).toBe(amended)
  })
})
