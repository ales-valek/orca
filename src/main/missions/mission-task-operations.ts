import {
  createMissionTaskBranchName,
  getMissionTaskBranchPrefix,
  getRepoTaskStack,
  getTopMissionTask
} from '../../shared/mission-task-stack'
import type { MissionRestackReport } from '../../shared/mission-layer-state'
import type {
  Mission,
  MissionMemberResult,
  MissionSlot,
  MissionTaskResult
} from '../../shared/mission-types'
import type { Store } from '../persistence'
import { listLocalBranchesUnder } from '../git/mission-branch-refs'
import type { MissionMemberLifecycle } from './mission-member-lifecycle'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import { ensureMissionRootStrict, syncMissionRootIfPresent } from './mission-root-sync'
import {
  joinWarnings,
  MissionTaskLayerWorktrees,
  type LayerOutcome
} from './mission-task-layer-worktrees'
import type { MissionTaskRestack } from './mission-task-restack'
import { getMissionOwnedWorktree } from './mission-worktree-ownership'

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

export type MissionRestackInput = { missionId: string; repoId?: string }

export type MissionRecreateSlotInput = {
  missionId: string
  repoId: string
  slot: Exclude<MissionSlot, 'member'>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Task layers stacked above the mission branch and the preview above them. */
export class MissionTaskOperations {
  private readonly layers: MissionTaskLayerWorktrees

  constructor(
    private readonly store: Store,
    private readonly lifecycle: MissionMemberLifecycle,
    private readonly notifyChanged: () => void,
    private readonly restacker: MissionTaskRestack,
    private readonly notifyStacksChanged: (missionId: string) => void = () => {}
  ) {
    this.layers = new MissionTaskLayerWorktrees(store, lifecycle)
  }

  /** Layer states change without a record change (a restack that blocks writes nothing), so say so. */
  notifyStackChanged(missionId: string): void {
    this.notifyChanged()
    this.notifyStacksChanged(missionId)
  }

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
      // Why: a removed task keeps its branch; reusing the name would fail to create the layer.
      const existingBranches = await listLocalBranchesUnder(
        repo.path,
        getMissionTaskBranchPrefix(rooted)
      )
      const task = this.store.addMissionTask(mission.id, {
        repoId: args.repoId,
        title: args.title,
        branchName: createMissionTaskBranchName(rooted, args, existingBranches),
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
      const created = await this.layers.createTaskLayer(mission.id, task, repo)
      const outcome = created.error
        ? created
        : joinWarnings([
            created.warning,
            (await this.followNewTop(mission.id, args.repoId)).warning
          ])
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyStackChanged(mission.id)
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
      const removed = await this.layers.removeTaskLayer(
        mission.id,
        task,
        args.deleteWorktree,
        isLastTask
      )
      // Why: the preview still shows the removed layer until it follows the new top task.
      const outcome =
        removed.error || isLastTask
          ? removed
          : joinWarnings([
              removed.warning,
              (await this.followNewTop(mission.id, args.repoId)).warning
            ])
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyStackChanged(mission.id)
      return { mission: this.store.getMission(mission.id) ?? mission, task, ...outcome }
    })
  }

  /** Rebases each repo's task layers onto their parents' current tips and moves the preview along. */
  restack(args: MissionRestackInput): Promise<MissionRestackReport[]> {
    return this.lifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      const memberRepoIds = mission.members.map((member) => member.repoId)
      if (args.repoId && !memberRepoIds.includes(args.repoId)) {
        throw new Error('mission_member_not_found')
      }
      const repoIds = args.repoId ? [args.repoId] : memberRepoIds
      requireNativeLocalMissionRepos(this.store, repoIds)
      const reports: MissionRestackReport[] = []
      try {
        for (const repoId of repoIds) {
          const current = this.store.getMission(mission.id) ?? mission
          reports.push(await this.restacker.restackRepo(current, repoId))
        }
      } finally {
        // Why: repos restacked before a failure already moved and recorded new bases.
        this.notifyStackChanged(mission.id)
      }
      return reports
    })
  }

  /** Recreates a missing task, preview or orchestrator checkout, then realigns the stack. */
  recreateSlotWorktree(args: MissionRecreateSlotInput): Promise<MissionMemberResult> {
    return this.lifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      requireNativeLocalMissionRepos(this.store, [args.repoId])
      const repo = this.store.getRepo(args.repoId)
      if (!repo) {
        return { repoId: args.repoId, worktreeId: null, error: 'mission_member_not_found' }
      }
      const rooted = ensureMissionRootStrict(this.store, mission)
      const created = await this.layers.recreateSlot(rooted, repo, args.slot)
      const realigned =
        created.error || args.slot === 'orchestrator'
          ? {}
          : await this.followNewTop(mission.id, args.repoId)
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyStackChanged(mission.id)
      return { ...created, ...joinWarnings([created.warning, realigned.warning]) }
    })
  }

  /** Top-down teardown of a repo's stack: preview, then tasks from the top. Caller holds the run lock. */
  async removeRepoStack(mission: Mission, repoId: string): Promise<LayerOutcome> {
    const warnings: (string | undefined)[] = []
    const preview = await this.layers.removePreview(mission, repoId, true)
    if (preview.error) {
      return preview
    }
    warnings.push(preview.warning)
    for (let current = this.store.getMission(mission.id); current;) {
      const top = getTopMissionTask(current, repoId)
      if (!top) {
        break
      }
      const removed = await this.layers.removeTaskLayer(mission.id, top, true, false)
      if (removed.error) {
        return removed
      }
      warnings.push(removed.warning)
      current = this.store.getMission(mission.id)
    }
    return joinWarnings(warnings)
  }

  /** Restacks inside the caller's run so an existing preview follows the new top task. */
  private async followNewTop(missionId: string, repoId: string): Promise<LayerOutcome> {
    const mission = this.store.getMission(missionId)
    if (!mission) {
      return {}
    }
    try {
      const report = await this.restacker.restackRepo(mission, repoId)
      const preview = report.layers.find((layer) => layer.slot === 'preview')
      if (!preview || preview.state === 'current') {
        return {}
      }
      const detail = preview.reason ? `${preview.state}: ${preview.reason}` : preview.state
      return { warning: `Preview did not follow the new top task (${detail}).` }
    } catch (error) {
      return { warning: `Restack after the stack changed failed: ${toErrorMessage(error)}` }
    }
  }
}
