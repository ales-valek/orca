import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Mission, MissionTask } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { getBranchTip } from '../git/stack-layer-git'
import { MissionTaskRestack, type MissionTaskRestackDeps } from './mission-task-restack'

const tempRoots: string[] = []
const MISSION_BRANCH = 'mission/x'
const PREVIEW_BRANCH = 'mission-preview/x'

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
  return git(cwd, ['rev-parse', 'HEAD'])
}

type StackFixture = {
  mission: Mission
  paths: Record<'member' | 't1' | 't2' | 't3' | 'preview', string>
  bases: Map<string, string>
  deps: MissionTaskRestackDeps
}

// Three task layers on a mission branch, each in its own worktree, with a preview on top.
async function createStack(): Promise<StackFixture> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'orca-task-restack-')))
  tempRoots.push(parent)
  const root = path.join(parent, 'repo')
  git(parent, ['init', '-q', '-b', 'main', root])
  git(root, ['config', 'user.email', 'ada@example.com'])
  git(root, ['config', 'user.name', 'Ada Lovelace'])
  git(root, ['config', 'commit.gpgSign', 'false'])
  await commitFile(root, 'base.txt', 'base\n', 'base')
  const addWorktree = (name: string, branch: string, from: string): string => {
    const target = path.join(parent, name)
    git(root, ['worktree', 'add', '-q', '-b', branch, target, from])
    return target
  }
  const member = addWorktree('member', MISSION_BRANCH, 'main')
  const missionTip = await commitFile(member, 'mission.txt', 'mission\n', 'mission')
  const tasks: MissionTask[] = []
  const taskPaths: Record<string, string> = {}
  let parentBranch = MISSION_BRANCH
  let parentTip = missionTip
  for (const id of ['t1', 't2', 't3'] as const) {
    const branchName = `mission-task/x/${id}`
    taskPaths[id] = addWorktree(id, branchName, parentBranch)
    const tip = await commitFile(taskPaths[id], `${id}.txt`, `${id}\n`, id)
    tasks.push({
      id,
      repoId: 'r1',
      order: tasks.length + 1,
      title: id,
      branchName,
      worktreeId: `r1::${taskPaths[id]}`,
      parentBaseSha: parentTip,
      addedAt: 0
    })
    parentBranch = branchName
    parentTip = tip
  }
  const paths: StackFixture['paths'] = {
    member,
    t1: taskPaths.t1,
    t2: taskPaths.t2,
    t3: taskPaths.t3,
    preview: addWorktree('preview', PREVIEW_BRANCH, parentBranch)
  }
  const mission: Mission = {
    id: 'm1',
    name: 'X',
    branchName: MISSION_BRANCH,
    members: [{ repoId: 'r1', worktreeId: `r1::${member}`, addedAt: 0 }],
    tasks,
    previews: [{ repoId: 'r1', worktreeId: `r1::${paths.preview}` }],
    tabOrder: 0,
    createdAt: 0,
    updatedAt: 0
  }
  const repo: Repo = { id: 'r1', path: root, displayName: 'repo', badgeColor: '#000', addedAt: 0 }
  const bases = new Map<string, string>()
  const deps: MissionTaskRestackDeps = {
    store: {
      getRepo: (repoId) => (repoId === 'r1' ? repo : undefined),
      setMissionTaskParentBaseSha: (_missionId, taskId, sha) => {
        bases.set(taskId, sha)
        const task = mission.tasks?.find((entry) => entry.id === taskId)
        if (task) {
          task.parentBaseSha = sha
        }
        return mission
      }
    },
    isWorktreeAgentWorking: () => false
  }
  return { mission, paths, bases, deps }
}

function tipOf(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD'])
}

async function amendTask1(paths: StackFixture['paths']): Promise<string> {
  await writeFile(path.join(paths.t1, 't1.txt'), 't1 amended\n', 'utf8')
  git(paths.t1, ['commit', '-q', '--amend', '-a', '-m', 't1 amended'])
  return tipOf(paths.t1)
}

function statesOf(report: { layers: { slot: string; state: string }[] }) {
  return Object.fromEntries(report.layers.map((layer) => [layer.slot, layer.state]))
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MissionTaskRestack', () => {
  it('inspects without writing, then rebases every layer above an amended task and moves the preview', async () => {
    const { mission, paths, bases, deps } = await createStack()
    const newT1 = await amendTask1(paths)
    const before = { t2: tipOf(paths.t2), t3: tipOf(paths.t3), preview: tipOf(paths.preview) }
    const restack = new MissionTaskRestack(deps)

    const inspected = await restack.inspectRepo(mission, 'r1')

    expect(statesOf(inspected)).toEqual({
      member: 'current',
      'task:t1': 'current',
      'task:t2': 'stale',
      'task:t3': 'current',
      preview: 'current'
    })
    expect({ t2: tipOf(paths.t2), t3: tipOf(paths.t3), preview: tipOf(paths.preview) }).toEqual(
      before
    )
    expect(bases.size).toBe(0)

    const report = await restack.restackRepo(mission, 'r1')

    expect(statesOf(report)).toEqual({
      member: 'current',
      'task:t1': 'current',
      'task:t2': 'current',
      'task:t3': 'current',
      preview: 'current'
    })
    expect(bases.get('t2')).toBe(newT1)
    expect(bases.get('t3')).toBe(tipOf(paths.t2))
    expect(tipOf(paths.preview)).toBe(tipOf(paths.t3))
    // Why: the pre-amend t1 commit must not be replayed onto the amended one.
    expect(git(paths.t3, ['log', '--format=%s', `${newT1}..HEAD`]).split('\n')).toEqual([
      't3',
      't2'
    ])
  })

  it('blocks a dirty layer and leaves every layer above it and the preview untouched', async () => {
    const { mission, paths, bases, deps } = await createStack()
    await amendTask1(paths)
    await writeFile(path.join(paths.t2, 'scratch.txt'), 'wip\n', 'utf8')
    const before = { t2: tipOf(paths.t2), t3: tipOf(paths.t3), preview: tipOf(paths.preview) }

    const report = await new MissionTaskRestack(deps).restackRepo(mission, 'r1')

    expect(statesOf(report)['task:t2']).toBe('blocked')
    expect({ t2: tipOf(paths.t2), t3: tipOf(paths.t3), preview: tipOf(paths.preview) }).toEqual(
      before
    )
    expect(bases.size).toBe(0)
  })

  it('blocks a layer whose agent is working', async () => {
    const { mission, paths, deps } = await createStack()
    await amendTask1(paths)
    const before = tipOf(paths.t2)
    const restack = new MissionTaskRestack({
      ...deps,
      isWorktreeAgentWorking: (worktreeId) => worktreeId === `r1::${paths.t2}`
    })

    const report = await restack.restackRepo(mission, 'r1')

    expect(statesOf(report)['task:t2']).toBe('blocked')
    expect(tipOf(paths.t2)).toBe(before)
  })

  it('stops at a task layer without a worktree and reports it blocked', async () => {
    const { mission, paths, deps } = await createStack()
    await amendTask1(paths)
    mission.tasks![1].worktreeId = null
    const before = { t3: tipOf(paths.t3), preview: tipOf(paths.preview) }

    const report = await new MissionTaskRestack(deps).restackRepo(mission, 'r1')

    expect(statesOf(report)['task:t2']).toBe('blocked')
    expect({ t3: tipOf(paths.t3), preview: tipOf(paths.preview) }).toEqual(before)
  })

  it('stops at a rebase conflict and keeps reporting the layer as a conflict while it is in progress', async () => {
    const { mission, paths, deps } = await createStack()
    await commitFile(paths.t2, 'shared.txt', 'from t2\n', 't2 shared')
    mission.tasks![2].parentBaseSha = tipOf(paths.t2)
    git(paths.t3, ['rebase', '-q', mission.tasks![2].parentBaseSha])
    await commitFile(paths.t1, 'shared.txt', 'from t1\n', 't1 shared')
    git(paths.preview, ['reset', '-q', '--hard', tipOf(paths.t3)])
    const before = { t3: tipOf(paths.t3), preview: tipOf(paths.preview) }
    const restack = new MissionTaskRestack(deps)

    const report = await restack.restackRepo(mission, 'r1')

    expect(statesOf(report)['task:t2']).toBe('conflict')
    expect({ t3: tipOf(paths.t3), preview: tipOf(paths.preview) }).toEqual(before)
    expect(statesOf(await restack.inspectRepo(mission, 'r1'))['task:t2']).toBe('conflict')
    expect(statesOf(await restack.restackRepo(mission, 'r1'))['task:t2']).toBe('conflict')
  })

  it('never loses a commit made on a lower layer while the restack runs', async () => {
    const { mission, paths, deps } = await createStack()
    await amendTask1(paths)
    let lateCommit: string | null = null
    const restack = new MissionTaskRestack({
      ...deps,
      readBranchTip: async (repoPath, branch, options) => {
        const tip = await getBranchTip(repoPath, branch, options)
        if (branch === mission.tasks![0].branchName && lateCommit === null) {
          // Why: an agent commits on task 1 right after the restack read its tip.
          lateCommit = await commitFile(paths.t1, 'late.txt', 'late\n', 't1 late')
        }
        return tip
      }
    })

    const first = await restack.restackRepo(mission, 'r1')

    expect(lateCommit).not.toBeNull()
    expect(statesOf(first)['task:t2']).toBe('stale')

    const second = await restack.restackRepo(mission, 'r1')

    expect(statesOf(second)['task:t2']).toBe('current')
    expect(() => git(paths.t2, ['merge-base', '--is-ancestor', lateCommit!, 'HEAD'])).not.toThrow()
    expect(tipOf(paths.preview)).toBe(tipOf(paths.t3))
  })
})
