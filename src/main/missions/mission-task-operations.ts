import {
  createMissionTaskBranchName,
  getMissionPreviewBranch,
  getMissionSlotBranch,
  getMissionTaskParentBranch,
  getRepoTaskStack,
  getTopMissionTask
} from '../../shared/mission-task-stack'
import type { Mission, MissionTask, MissionTaskResult } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'
import { getMergeBase } from '../git/stack-layer-git'
import type { MissionMemberLifecycle } from './mission-member-lifecycle'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import { ensureMissionRootStrict, syncMissionRootIfPresent } from './mission-root-sync'
import { getMissionSlotDirectoryName } from './mission-slot-worktrees'
import { getMissionOwnedWorktree, getMissionSlotRecord } from './mission-worktree-ownership'

export type MissionAddTaskInput = {
  missionId: string
  repoId: string
  title: string
  externalRef?: string | null
  externalId?: string | null
}

export type MissionRemoveTopTaskInput = {
  missionId: string
  repoId: string
  /** When given, must name the top task; guards a stale caller view of the stack. */
  taskId?: string
  deleteWorktree: boolean
}

type LayerOutcome = { error?: string; warning?: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function joinWarnings(warnings: (string | undefined)[]): LayerOutcome {
  const present = warnings.filter((warning): warning is string => Boolean(warning))
  return present.length > 0 ? { warning: present.join(' ') } : {}
}

/** The last branch segment, e.g. `omp-1` of `mission-task/referral/omp-1`; unique per Mission. */
function getTaskDirectorySuffix(task: Pick<MissionTask, 'branchName'>): string {
  return task.branchName.slice(task.branchName.lastIndexOf('/') + 1)
}

/** Task layers stacked above the mission branch and the preview above them. */
export class MissionTaskOperations {
  constructor(
    private readonly store: Store,
    private readonly lifecycle: MissionMemberLifecycle,
    private readonly notifyChanged: () => void
  ) {}

  addTask(args: MissionAddTaskInput): Promise<MissionTaskResult> {
    return this.lifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      const member = mission.members.find((entry) => entry.repoId === args.repoId)
      if (!member) {
        return { mission, task: null, error: 'mission_member_not_found' }
      }
      requireNativeLocalMissionRepos(this.store, [args.repoId])
      const repo = this.store.getRepo(args.repoId)
      if (!repo) {
        return { mission, task: null, error: 'mission_member_not_found' }
      }
      if (!getMissionOwnedWorktree(this.store, mission, member)) {
        return { mission, task: null, error: 'mission_member_worktree_missing' }
      }
      const parent = getTopMissionTask(mission, args.repoId)
      if (parent && !parent.worktreeId) {
        // Why: a layer whose create failed has no checkout to stack on; remove or recreate it first.
        return { mission, task: null, error: 'mission_task_parent_missing' }
      }
      const rooted = ensureMissionRootStrict(this.store, mission)
      const task = this.store.addMissionTask(mission.id, {
        repoId: args.repoId,
        title: args.title,
        branchName: createMissionTaskBranchName(rooted, args),
        externalRef: args.externalRef ?? null,
        externalId: args.externalId ?? null
      })
      if (!task) {
        return { mission: rooted, task: null, error: 'mission_member_not_found' }
      }
      try {
        // Why: marker-only recovery needs the task record durable before its checkout exists.
        await this.store.flushPendingOrThrowAsync()
      } catch (error) {
        this.store.removeMissionTask(mission.id, task.id)
        throw error
      }
      this.notifyChanged()
      const outcome = await this.createTaskLayer(mission.id, task, repo)
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyChanged()
      const updated = this.store.getMission(mission.id) ?? rooted
      const updatedTask = updated.tasks?.find((entry) => entry.id === task.id) ?? task
      return { mission: updated, task: updatedTask, ...outcome }
    })
  }

  removeTopTask(args: MissionRemoveTopTaskInput): Promise<MissionTaskResult> {
    return this.lifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      const top = getTopMissionTask(mission, args.repoId)
      const task = args.taskId
        ? (mission.tasks?.find(
            (entry) => entry.id === args.taskId && entry.repoId === args.repoId
          ) ?? null)
        : top
      if (!task) {
        return { mission, task: null, error: 'mission_task_not_found' }
      }
      if (task.id !== top?.id) {
        return { mission, task, error: 'mission_task_not_top' }
      }
      const isLastTask = getRepoTaskStack(mission, args.repoId).length === 1
      const outcome = await this.removeTaskLayer(mission.id, task, args.deleteWorktree, isLastTask)
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyChanged()
      return { mission: this.store.getMission(mission.id) ?? mission, task, ...outcome }
    })
  }

  /** Top-down teardown of a repo's stack: preview, then tasks from the top. Caller holds the run lock. */
  async removeRepoStack(mission: Mission, repoId: string): Promise<LayerOutcome> {
    const warnings: (string | undefined)[] = []
    const preview = await this.removePreview(mission, repoId, true)
    if (preview.error) {
      return preview
    }
    warnings.push(preview.warning)
    for (let current = this.store.getMission(mission.id); current;) {
      const top = getTopMissionTask(current, repoId)
      if (!top) {
        break
      }
      const removed = await this.removeTaskLayer(mission.id, top, true, false)
      if (removed.error) {
        return removed
      }
      warnings.push(removed.warning)
      current = this.store.getMission(mission.id)
    }
    return joinWarnings(warnings)
  }

  private async createTaskLayer(
    missionId: string,
    task: MissionTask,
    repo: Repo
  ): Promise<LayerOutcome> {
    const mission = this.store.getMission(missionId)
    if (!mission) {
      return { error: 'mission_not_found' }
    }
    const parentBranch = getMissionTaskParentBranch(mission, task)
    const directoryBase = getMissionSlotDirectoryName(repo.displayName, repo.id)
    const created = await this.lifecycle.createSlotWorktree(mission, repo.id, `task:${task.id}`, {
      branchName: task.branchName,
      baseBranch: parentBranch,
      directoryName: `${directoryBase}--${getTaskDirectorySuffix(task)}`
    })
    if (created.error) {
      return { error: created.error }
    }
    const warnings: string[] = []
    // Why: an existing task branch is checked out as-is; its fork point, not the
    // parent tip, keeps the first restack from replaying foreign commits.
    const parentBaseSha = await getMergeBase(repo.path, parentBranch, task.branchName)
    if (parentBaseSha) {
      this.store.setMissionTaskParentBaseSha(missionId, task.id, parentBaseSha)
    } else {
      warnings.push(`Could not resolve where ${task.branchName} forks from ${parentBranch}.`)
    }
    const current = this.store.getMission(missionId) ?? mission
    if (!getMissionSlotRecord(current, repo.id, 'preview')?.worktreeId) {
      const preview = await this.lifecycle.createSlotWorktree(current, repo.id, 'preview', {
        branchName: getMissionPreviewBranch(current),
        baseBranch: task.branchName,
        directoryName: `${directoryBase}--preview`
      })
      if (preview.error) {
        warnings.push(`Preview worktree was not created: ${preview.error}`)
      }
    }
    return joinWarnings(warnings)
  }

  private async removePreview(
    mission: Mission,
    repoId: string,
    deleteWorktree: boolean
  ): Promise<LayerOutcome> {
    const current = this.store.getMission(mission.id) ?? mission
    if (!getMissionSlotBranch(current, repoId, 'preview')) {
      return {}
    }
    const removed = await this.lifecycle.removeSlotWorktree(
      current,
      repoId,
      'preview',
      deleteWorktree
    )
    return removed.error ? { error: removed.error } : joinWarnings([removed.warning])
  }

  /** Task worktree first, so a dirty layer refuses before its preview is touched; record last. */
  private async removeTaskLayer(
    missionId: string,
    task: MissionTask,
    deleteWorktree: boolean,
    withPreview: boolean
  ): Promise<LayerOutcome> {
    const mission = this.store.getMission(missionId)
    if (!mission) {
      return { error: 'mission_not_found' }
    }
    const removed = await this.lifecycle.removeSlotWorktree(
      mission,
      task.repoId,
      `task:${task.id}`,
      deleteWorktree
    )
    if (removed.error) {
      return { error: removed.error }
    }
    // Why: the preview branch resolves only while the repo still records a task.
    const preview = withPreview
      ? await this.removePreview(mission, task.repoId, deleteWorktree)
      : {}
    if (preview.error) {
      return { error: preview.error, ...joinWarnings([removed.warning]) }
    }
    try {
      this.store.removeMissionTask(mission.id, task.id)
    } catch (error) {
      return { error: toErrorMessage(error) }
    }
    return joinWarnings([removed.warning, preview.warning])
  }
}
