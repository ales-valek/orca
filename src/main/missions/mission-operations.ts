import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type {
  Mission,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMember,
  MissionMemberResult,
  MissionTaskResult
} from '../../shared/mission-types'
import type {
  MissionAddMembersInput,
  MissionCreateInput,
  MissionDeleteInput
} from '../ipc/mission-ipc-args'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { MissionMemberLifecycle } from './mission-member-lifecycle'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import {
  ensureMissionRootStrict,
  removeMissionRootIfPresent,
  syncMissionRootIfPresent
} from './mission-root-sync'
import { runMissionSetupHook, type MissionSetupHookEvent } from './mission-setup-hook'
import {
  MissionTaskOperations,
  type MissionAddTaskInput,
  type MissionRemoveTopTaskInput
} from './mission-task-operations'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type MissionSetupHookRunner = (mission: Mission, event: MissionSetupHookEvent) => Promise<void>

/** Mission mutations shared by the desktop IPC handlers and the runtime RPC (`orca mission`). */
export class MissionOperations {
  readonly memberLifecycle: MissionMemberLifecycle
  private readonly tasks: MissionTaskOperations

  constructor(
    private readonly store: Store,
    runtime: OrcaRuntimeService,
    private readonly notifyChanged: () => void,
    private readonly runSetupHook: MissionSetupHookRunner = runMissionSetupHook
  ) {
    this.memberLifecycle = new MissionMemberLifecycle(store, runtime)
    this.tasks = new MissionTaskOperations(store, this.memberLifecycle, notifyChanged)
  }

  list(): Mission[] {
    return this.store.getMissions()
  }

  /** Root-scoped folder workspace where the Mission's own session terminals run. */
  async ensureSession(missionId: string): Promise<FolderWorkspace> {
    return this.memberLifecycle.run(missionId, async () => {
      const mission = this.store.getMission(missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      requireNativeLocalMissionRepos(
        this.store,
        mission.members.map((member) => member.repoId)
      )
      // Why: session open must surface root creation failures; member-change syncs are best-effort.
      const ensured = ensureMissionRootStrict(this.store, mission)
      const workspace = this.store.ensureMissionSessionWorkspace(ensured.id)
      this.notifyChanged()
      return workspace
    })
  }

  async create(args: MissionCreateInput): Promise<MissionCreateResult> {
    const repoIds = [...new Set(args.repoIds)]
    requireNativeLocalMissionRepos(this.store, repoIds)
    const mission = this.store.createMission({
      name: args.name,
      branchName: args.branchName ?? null,
      repoIds,
      sessionAgent: args.sessionAgent
    })
    return this.memberLifecycle.run(mission.id, async () => {
      let rootedMission: Mission | null = null
      try {
        // Why: member worktrees live inside the Mission root so sandboxed
        // agents can discover and edit every repo without following external symlinks.
        rootedMission = ensureMissionRootStrict(this.store, mission)
        // Why: the worktree marker can recover metadata/member-pointer crash
        // windows only if the owning Mission and root already reached disk.
        await this.store.flushPendingOrThrowAsync()
      } catch (error) {
        if (rootedMission) {
          try {
            removeMissionRootIfPresent(this.store, rootedMission)
          } catch {
            // Preserve the original durability failure; ownership checks keep
            // an unremoved root from being claimed by another Mission.
          }
        }
        this.store.deleteMission(mission.id)
        throw error
      }
      this.notifyChanged()
      const memberResults = await this.memberLifecycle.createWorktrees(rootedMission, repoIds)
      this.store.ensureMissionSessionWorkspace(rootedMission.id)
      this.notifyChanged()
      const created = this.store.getMission(mission.id) ?? rootedMission
      this.startSetupHook(created, 'create')
      return { mission: created, memberResults }
    })
  }

  async addMembers(args: MissionAddMembersInput): Promise<MissionCreateResult> {
    return this.memberLifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      const existing = new Set(mission.members.map((member) => member.repoId))
      const repoIds = [...new Set(args.repoIds)].filter((repoId) => !existing.has(repoId))
      if (repoIds.length > 0) {
        requireNativeLocalMissionRepos(this.store, repoIds)
      }
      const rootedMission = ensureMissionRootStrict(this.store, mission)
      this.store.addMissionMembers(mission.id, repoIds)
      try {
        // Why: marker-only recovery needs the intended membership durable
        // before any newly added repo receives a linked checkout.
        await this.store.flushPendingOrThrowAsync()
      } catch (error) {
        for (const repoId of repoIds) {
          this.store.removeMissionMember(mission.id, repoId)
        }
        throw error
      }
      this.notifyChanged()
      const memberResults = await this.memberLifecycle.createWorktrees(
        this.store.getMission(mission.id) ?? rootedMission,
        repoIds
      )
      syncMissionRootIfPresent(this.store, mission.id)
      this.notifyChanged()
      const updated = this.store.getMission(mission.id) ?? mission
      if (repoIds.length > 0) {
        this.startSetupHook(updated, 'members-added')
      }
      return { mission: updated, memberResults }
    })
  }

  addTask(args: MissionAddTaskInput): Promise<MissionTaskResult> {
    return this.tasks.addTask(args)
  }

  removeTopTask(args: MissionRemoveTopTaskInput): Promise<MissionTaskResult> {
    return this.tasks.removeTopTask(args)
  }

  /** Removes a member's task stack top-down, then its worktree; any refusal keeps the member.
   *  Caller holds the Mission run lock. */
  async removeMemberWithLayers(
    mission: Mission,
    member: MissionMember
  ): Promise<MissionMemberResult> {
    const stack = await this.tasks.removeRepoStack(mission, member.repoId)
    if (stack.error) {
      return { repoId: member.repoId, worktreeId: member.worktreeId, ...stack }
    }
    const current = this.store.getMission(mission.id) ?? mission
    const removed = await this.memberLifecycle.removeWorktree(current, member)
    const warning = [stack.warning, removed.warning].filter(Boolean).join(' ')
    return { ...removed, ...(warning ? { warning } : {}) }
  }

  async delete(args: MissionDeleteInput): Promise<MissionDeleteResult> {
    return this.memberLifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        return { deleted: false, memberResults: [] }
      }
      try {
        // Why: the Mission PTY may have a cwd inside a link; stop it before unlinking.
        await this.memberLifecycle.teardownSession(mission)
      } catch (error) {
        return { deleted: false, memberResults: [], error: toErrorMessage(error) }
      }
      return args.deleteWorktrees
        ? this.deleteWithWorktrees(mission)
        : this.deleteDetachingWorktrees(mission)
    })
  }

  private async deleteDetachingWorktrees(mission: Mission): Promise<MissionDeleteResult> {
    let rootWarning: string | undefined, recoveredMission: Mission, deleted: boolean
    try {
      // Why: a create intent may be the only proof after Git add. Promote
      // it through a strict scan before root cleanup can remove that proof.
      recoveredMission = await this.memberLifecycle.recoverMembersBeforeMissionDetach(mission)
      const rootResult = removeMissionRootIfPresent(this.store, recoveredMission)
      if (rootResult && !rootResult.removed && mission.rootPath) {
        rootWarning = `Preserved files in the former Mission root: ${mission.rootPath}`
      }
      // Why: marker removal is safe only after Mission/session deletion is durable.
      deleted = await this.store.deleteMissionAndFlush(mission.id)
    } catch (error) {
      return { deleted: false, memberResults: [], error: toErrorMessage(error) }
    }
    if (deleted) {
      this.memberLifecycle.detachDeletedMissionOwnership(recoveredMission)
    }
    this.notifyChanged()
    return {
      deleted,
      memberResults: [],
      ...(rootWarning ? { warning: rootWarning } : {})
    }
  }

  private async deleteWithWorktrees(mission: Mission): Promise<MissionDeleteResult> {
    const memberResults: MissionMemberResult[] = []
    // Why: removeWorktree reassigns members; iterate a snapshot so removals don't skip entries.
    const members = [...mission.members]
    for (const member of members) {
      memberResults.push(await this.removeMemberWithLayers(mission, member))
    }
    const remaining = this.store.getMission(mission.id)
    // Why: keep a Mission with an undeletable worktree visible for a safe retry.
    let deleted = false
    let rootWarning: string | undefined
    if (remaining !== null && remaining.members.length === 0) {
      try {
        const rootResult = removeMissionRootIfPresent(this.store, mission)
        if (rootResult && !rootResult.removed && mission.rootPath) {
          rootWarning = `Preserved files in the former Mission root: ${mission.rootPath}`
        }
        deleted = this.store.deleteMission(mission.id)
      } catch (error) {
        return { deleted: false, memberResults, error: toErrorMessage(error) }
      }
    }
    if (!deleted) {
      syncMissionRootIfPresent(this.store, mission.id)
    }
    this.notifyChanged()
    const warnings = memberResults.flatMap((result) => result.warning ?? [])
    if (rootWarning) {
      warnings.push(rootWarning)
    }
    return {
      deleted,
      memberResults,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {})
    }
  }

  // Why: the hook is user-owned code; it must never delay or fail the Mission mutation.
  private startSetupHook(mission: Mission, event: MissionSetupHookEvent): void {
    void this.runSetupHook(mission, event).catch((error: unknown) => {
      console.error('[missions] mission-setup hook failed to start:', toErrorMessage(error))
    })
  }
}
