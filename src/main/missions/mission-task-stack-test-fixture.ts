import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Mission, MissionTask } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import type { MissionTaskRestackDeps } from './mission-task-restack'

export const MISSION_BRANCH = 'mission/x'
export const PREVIEW_BRANCH = 'mission-preview/x'

const tempRoots: string[] = []

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

export function tipOf(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD'])
}

export async function commitFile(cwd: string, file: string, content: string, message: string) {
  await writeFile(path.join(cwd, file), content, 'utf8')
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', message])
  return tipOf(cwd)
}

export type TaskStackFixture = {
  root: string
  repo: Repo
  mission: Mission
  /** Checkout per layer: `member`, each task id, and `preview`. */
  paths: Record<string, string>
  /** Bases recorded through the store, keyed by task id. */
  bases: Map<string, string>
  deps: MissionTaskRestackDeps
}

/** Task layers on a mission branch, each in its own worktree and adding `<id>.txt`, with a preview on top. */
export async function createTaskStackFixture(
  taskIds: readonly string[]
): Promise<TaskStackFixture> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'orca-task-stack-')))
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
  const paths: Record<string, string> = { member: addWorktree('member', MISSION_BRANCH, 'main') }
  const missionTip = await commitFile(paths.member, 'mission.txt', 'mission\n', 'mission')
  const tasks: MissionTask[] = []
  let parentBranch = MISSION_BRANCH
  let parentTip = missionTip
  for (const id of taskIds) {
    const branchName = `mission-task/x/${id}`
    paths[id] = addWorktree(id, branchName, parentBranch)
    const tip = await commitFile(paths[id], `${id}.txt`, `${id}\n`, id)
    tasks.push({
      id,
      repoId: 'r1',
      order: tasks.length + 1,
      title: id,
      branchName,
      worktreeId: `r1::${paths[id]}`,
      parentBaseSha: parentTip,
      addedAt: 0
    })
    parentBranch = branchName
    parentTip = tip
  }
  paths.preview = addWorktree('preview', PREVIEW_BRANCH, parentBranch)
  const mission: Mission = {
    id: 'm1',
    name: 'X',
    branchName: MISSION_BRANCH,
    members: [{ repoId: 'r1', worktreeId: `r1::${paths.member}`, addedAt: 0 }],
    tasks,
    // Why: preview creation records the top-task tip it started from.
    previews: [{ repoId: 'r1', worktreeId: `r1::${paths.preview}`, followedSha: parentTip }],
    tabOrder: 0,
    createdAt: 0,
    updatedAt: 0
  }
  const repo: Repo = { id: 'r1', path: root, displayName: 'repo', badgeColor: '#000', addedAt: 0 }
  const bases = new Map<string, string>()
  const findTask = (taskId: string) => mission.tasks?.find((entry) => entry.id === taskId)
  const deps: MissionTaskRestackDeps = {
    store: {
      getRepo: (repoId) => (repoId === 'r1' ? repo : undefined),
      setMissionTaskParentBaseSha: (_missionId, taskId, sha) => {
        bases.set(taskId, sha)
        const task = findTask(taskId)
        if (task) {
          task.parentBaseSha = sha
        }
        return mission
      },
      setMissionTaskPendingParentBaseSha: (_missionId, taskId, sha) => {
        const task = findTask(taskId)
        if (task) {
          task.pendingParentBaseSha = sha
        }
        return mission
      },
      setMissionPreviewFollowedSha: (_missionId, repoId, sha) => {
        const preview = mission.previews?.find((entry) => entry.repoId === repoId)
        if (preview) {
          preview.followedSha = sha
        }
        return mission
      },
      flushPendingOrThrowAsync: async () => {}
    },
    isWorktreeAgentWorking: () => false
  }
  return { root, repo, mission, paths, bases, deps }
}

export async function removeTaskStackFixtures(): Promise<void> {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}
