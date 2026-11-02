import {
  getMissionPreviewBranch,
  getMissionSlotBranch,
  getMissionTaskParentBranch,
  getTopMissionTask
} from '../../shared/mission-task-stack'
import type {
  Mission,
  MissionMemberResult,
  MissionSlot,
  MissionTask
} from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence/loading-store/store'
import { deleteOrcaOwnedBranch } from '../git/mission-branch-refs'
import { getBranchTip, getMergeBase } from '../git/stack-layer-git'
import type { MissionMemberLifecycle } from './mission-member-lifecycle'
import { getMissionSlotDirectoryName } from './mission-slot-worktrees'
import { getMissionSlotRecord } from './mission-worktree-ownership'

export type LayerOutcome = { error?: string; warning?: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function joinWarnings(warnings: (string | undefined)[]): LayerOutcome {
  const present = warnings.filter((warning): warning is string => Boolean(warning))
  return present.length > 0 ? { warning: present.join(' ') } : {}
}

/** The last branch segment, e.g. `omp-1` of `mission-task/referral/omp-1`; unique per Mission. */
function getTaskDirectorySuffix(task: Pick<MissionTask, 'branchName'>): string {
  return task.branchName.slice(task.branchName.lastIndexOf('/') + 1)
}

/** Creates and removes the checkouts of task layers and the preview; callers hold the run lock. */
export class MissionTaskLayerWorktrees {
  constructor(
    private readonly store: Store,
    private readonly lifecycle: MissionMemberLifecycle
  ) {}

  async createTaskLayer(missionId: string, task: MissionTask, repo: Repo): Promise<LayerOutcome> {
    const mission = this.store.getMission(missionId)
    if (!mission) {
      return { error: 'mission_not_found' }
    }
    const created = await this.createTaskCheckout(mission, task, repo, false)
    if (created.error) {
      return { error: created.error }
    }
    const warnings = [created.warning]
    const current = this.store.getMission(missionId) ?? mission
    if (!getMissionSlotRecord(current, repo.id, 'preview')?.worktreeId) {
      const preview = await this.createPreviewCheckout(current, repo, task, false)
      warnings.push(
        preview.error ? `Preview worktree was not created: ${preview.error}` : undefined
      )
    }
    return joinWarnings(warnings)
  }

  /**
   * Recreates a missing task, preview or orchestrator checkout. A branch that still exists is
   * checked out as it is; a missing one starts where a new layer would (parent, top task, mission).
   */
  async recreateSlot(
    mission: Mission,
    repo: Repo,
    slot: Exclude<MissionSlot, 'member'>
  ): Promise<MissionMemberResult> {
    const branch = getMissionSlotBranch(mission, repo.id, slot)
    if (!branch) {
      return { repoId: repo.id, worktreeId: null, error: 'mission_member_not_found' }
    }
    const branchExists = (await getBranchTip(repo.path, branch)) !== null
    if (slot === 'orchestrator') {
      return this.lifecycle.createOrchestratorWorktree(
        mission,
        repo.id,
        branchExists ? { baseBranch: branch } : {}
      )
    }
    if (slot === 'preview') {
      const top = getTopMissionTask(mission, repo.id)
      return top
        ? this.createPreviewCheckout(mission, repo, top, branchExists)
        : { repoId: repo.id, worktreeId: null, error: 'mission_task_not_found' }
    }
    const taskId = slot.slice('task:'.length)
    const task = mission.tasks?.find((entry) => entry.id === taskId)
    return task
      ? this.createTaskCheckout(mission, task, repo, branchExists)
      : { repoId: repo.id, worktreeId: null, error: 'mission_task_not_found' }
  }

  async removePreview(
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
    if (removed.error) {
      return { error: removed.error }
    }
    const repo = this.store.getRepo(repoId)
    if (!deleteWorktree || !repo) {
      return joinWarnings([removed.warning])
    }
    // Why: a kept preview branch on the old top blocks creating the preview again on a new top.
    const branch = getMissionPreviewBranch(current)
    const preserved = `Preserved local branch ${branch}.`
    try {
      const outcome = await deleteOrcaOwnedBranch(repo.path, branch)
      const warning = removed.warning?.replace(preserved, '').trim()
      return outcome === 'kept'
        ? joinWarnings([warning, `Kept ${branch}: it has commits no other branch contains.`])
        : joinWarnings([warning])
    } catch (error) {
      return joinWarnings([removed.warning, `Could not delete ${branch}: ${toErrorMessage(error)}`])
    }
  }

  /** Task worktree first, so a dirty layer refuses before its preview is touched; record last. */
  async removeTaskLayer(
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

  private async createTaskCheckout(
    mission: Mission,
    task: MissionTask,
    repo: Repo,
    adoptExistingBranch: boolean
  ): Promise<MissionMemberResult> {
    const parentBranch = getMissionTaskParentBranch(mission, task)
    const created = await this.lifecycle.createSlotWorktree(mission, repo.id, `task:${task.id}`, {
      branchName: task.branchName,
      baseBranch: adoptExistingBranch ? task.branchName : parentBranch,
      directoryName: `${getMissionSlotDirectoryName(repo.displayName, repo.id)}--${getTaskDirectorySuffix(task)}`
    })
    if (created.error || (adoptExistingBranch && task.parentBaseSha)) {
      return created
    }
    // Why: an existing task branch is checked out as-is; its fork point, not the
    // parent tip, keeps the first restack from replaying foreign commits.
    const parentBaseSha = await getMergeBase(repo.path, parentBranch, task.branchName)
    if (parentBaseSha) {
      this.store.setMissionTaskParentBaseSha(mission.id, task.id, parentBaseSha)
      return created
    }
    return {
      ...created,
      warning: `Could not resolve where ${task.branchName} forks from ${parentBranch}.`
    }
  }

  private async createPreviewCheckout(
    mission: Mission,
    repo: Repo,
    top: MissionTask,
    adoptExistingBranch: boolean
  ): Promise<MissionMemberResult> {
    const branchName = getMissionPreviewBranch(mission)
    const created = await this.lifecycle.createSlotWorktree(mission, repo.id, 'preview', {
      branchName,
      baseBranch: adoptExistingBranch ? branchName : top.branchName,
      directoryName: `${getMissionSlotDirectoryName(repo.displayName, repo.id)}--preview`
    })
    if (created.error || adoptExistingBranch) {
      return created
    }
    const followedSha = await getBranchTip(repo.path, top.branchName)
    if (followedSha) {
      this.store.setMissionPreviewFollowedSha(mission.id, repo.id, followedSha)
    }
    return created
  }
}
