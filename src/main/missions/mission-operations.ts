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
import type { MissionRestackReport } from '../../shared/mission-layer-state'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { MissionMemberLifecycle } from './mission-member-lifecycle'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import {
  ensureMissionRootStrict,
  removeMissionRootIfPresent,
  syncMissionRootIfPresent
} from './mission-root-sync'
import { MissionDeletion } from './mission-deletion'
import { runMissionSetupHook, type MissionSetupHookEvent } from './mission-setup-hook'
import {
  MissionTaskOperations,
  type MissionAddTaskInput,
  type MissionRecreateSlotInput,
  type MissionRemoveTopTaskInput,
  type MissionRestackInput
} from './mission-task-operations'
import { MissionTaskAbsorb, type MissionAbsorbResult } from './mission-task-absorb'
import {
  inspectMissionRepoStack,
  inspectMissionStacks,
  type MissionStackInspectionDeps
} from './mission-stack-inspection'
import { readLocalMissionPushTips } from './mission-stack-pull-request-git'
import { MissionStackPublisher } from './mission-stack-publisher'
import type { MissionStackPullRequestsResult } from './mission-stack-pull-requests'
import { MissionRestackTrigger } from './mission-restack-trigger'
import { MissionTaskRestack } from './mission-task-restack'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type MissionAbsorbInput = {
  missionId: string
  repoId: string
  /** `file:line` of an ambiguous hunk mapped to the task id that should take it. */
  overrides?: Record<string, string>
}

type MissionSetupHookRunner = (mission: Mission, event: MissionSetupHookEvent) => Promise<void>

export type MissionOperationsOptions = {
  runSetupHook?: MissionSetupHookRunner
  /** Restack never touches a layer whose agent is mid-turn; absent means no agent is ever busy. */
  isWorktreeAgentWorking?: (worktreeId: string) => boolean
  /** A stack mutation or restack ran, so layer states may differ even without a record change. */
  notifyStacksChanged?: (missionId: string) => void
}

/** Mission mutations shared by the desktop IPC handlers and the runtime RPC (`orca mission`). */
export class MissionOperations {
  readonly memberLifecycle: MissionMemberLifecycle
  private readonly tasks: MissionTaskOperations
  private readonly absorber: MissionTaskAbsorb
  /** Read-only layer states of a repo's stack; takes no lock and writes nothing. */
  readonly inspectRepo: MissionTaskRestack['inspectRepo']
  private readonly stackInspection: MissionStackInspectionDeps
  private readonly restackTrigger: MissionRestackTrigger
  private readonly deletion: MissionDeletion
  private readonly publisher: MissionStackPublisher
  private readonly runSetupHook: MissionSetupHookRunner

  constructor(
    private readonly store: Store,
    runtime: OrcaRuntimeService,
    private readonly notifyChanged: () => void,
    options: MissionOperationsOptions = {}
  ) {
    this.runSetupHook = options.runSetupHook ?? runMissionSetupHook
    const isWorktreeAgentWorking = options.isWorktreeAgentWorking ?? (() => false)
    this.memberLifecycle = new MissionMemberLifecycle(store, runtime)
    const restacker = new MissionTaskRestack({ store, isWorktreeAgentWorking })
    this.inspectRepo = restacker.inspectRepo.bind(restacker)
    this.tasks = new MissionTaskOperations(
      store,
      this.memberLifecycle,
      notifyChanged,
      restacker,
      options.notifyStacksChanged
    )
    this.absorber = new MissionTaskAbsorb({
      store,
      restacker: restacker,
      isWorktreeAgentWorking
    })
    this.stackInspection = {
      inspectRepo: this.inspectRepo,
      readPushTips: async (repoId, branches) => {
        const repo = store.getRepo(repoId)
        if (!repo) {
          throw new Error('mission_member_not_found')
        }
        return readLocalMissionPushTips(repo, branches)
      }
    }
    this.publisher = new MissionStackPublisher(store, this.memberLifecycle, (mission, repoId) =>
      inspectMissionRepoStack(mission, repoId, this.stackInspection)
    )
    this.restackTrigger = new MissionRestackTrigger({
      store,
      restack: (input) => this.restack(input)
    })
    this.deletion = new MissionDeletion({
      store,
      memberLifecycle: this.memberLifecycle,
      notifyChanged,
      removeMemberWithLayers: (mission, member) => this.removeMemberWithLayers(mission, member)
    })
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
    const orchestratorRepoId = args.orchestratorRepoId ?? null
    requireNativeLocalMissionRepos(this.store, [
      ...repoIds,
      ...(orchestratorRepoId ? [orchestratorRepoId] : [])
    ])
    const mission = this.store.createMission({
      name: args.name,
      branchName: args.branchName ?? null,
      repoIds,
      sessionAgent: args.sessionAgent,
      orchestratorRepoId
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
      // Why: a failed orchestrator keeps the Mission; the session then falls back to the root.
      const orchestratorResult = orchestratorRepoId
        ? await this.memberLifecycle.createOrchestratorWorktree(rootedMission, orchestratorRepoId)
        : undefined
      this.store.ensureMissionSessionWorkspace(rootedMission.id)
      this.notifyChanged()
      const created = this.store.getMission(mission.id) ?? rootedMission
      this.startSetupHook(created, 'create')
      return {
        mission: created,
        memberResults,
        ...(orchestratorResult ? { orchestratorResult } : {})
      }
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
      if (mission.orchestratorRepoId && repoIds.includes(mission.orchestratorRepoId)) {
        throw new Error('mission_orchestrator_repo_is_member')
      }
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

  /** Read-only layer states of every repo stack, needs-push included; shared by IPC and `orca mission show`. */
  inspectStacks(mission: Mission): Promise<MissionRestackReport[]> {
    return inspectMissionStacks(mission, this.stackInspection)
  }

  addTask(args: MissionAddTaskInput): Promise<MissionTaskResult> {
    return this.tasks.addTask(args)
  }

  removeTopTask(args: MissionRemoveTopTaskInput): Promise<MissionTaskResult> {
    return this.tasks.removeTopTask(args)
  }

  restack(args: MissionRestackInput): Promise<MissionRestackReport[]> {
    return this.tasks.restack(args)
  }

  recreateSlotWorktree(args: MissionRecreateSlotInput): Promise<MissionMemberResult> {
    return this.tasks.recreateSlotWorktree(args)
  }

  /** An agent in a Mission worktree finished a turn; restacks its repo after a short quiet period. */
  onAgentTurnEnded(worktreeId: string): void {
    this.restackTrigger.onAgentTurnEnded(worktreeId)
  }

  /** A manual pull-rebase finished in this worktree; restacks if it is a Mission member checkout. */
  onWorktreeRebased(worktreePath: string): void {
    this.restackTrigger.onWorktreeRebased(worktreePath)
  }

  /** Moves the preview's edits into the task layers that own them, then restacks the repo. */
  absorb(args: MissionAbsorbInput): Promise<MissionAbsorbResult> {
    return this.memberLifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        throw new Error('mission_not_found')
      }
      if (!mission.members.some((member) => member.repoId === args.repoId)) {
        throw new Error('mission_member_not_found')
      }
      requireNativeLocalMissionRepos(this.store, [args.repoId])
      try {
        return await this.absorber.absorbRepo(mission, args.repoId, args.overrides)
      } finally {
        // Why: a failed absorb may still have recorded restack bases or the preview's followed tip.
        this.tasks.notifyStackChanged(args.missionId)
      }
    })
  }

  /** Pushes and opens a PR for each layer of a repo's stack, bottom-up; the preview never gets one. */
  createStackPullRequests(args: {
    missionId: string
    repoId: string
    draft?: boolean
  }): Promise<MissionStackPullRequestsResult> {
    return this.publisher.createStackPullRequests(args)
  }

  /** Force-with-lease push of layers that moved since their last push; only on explicit user action. */
  pushStack(args: {
    missionId: string
    repoId: string
  }): Promise<{ pushed: string[]; error?: string }> {
    return this.publisher.pushStack(args)
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

  delete(args: MissionDeleteInput): Promise<MissionDeleteResult> {
    return this.memberLifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      if (!mission) {
        return { deleted: false, memberResults: [] }
      }
      return this.deletion.delete(mission, args.deleteWorktrees)
    })
  }

  // Why: the hook is user-owned code; it must never delay or fail the Mission mutation.
  private startSetupHook(mission: Mission, event: MissionSetupHookEvent): void {
    void this.runSetupHook(mission, event).catch((error: unknown) => {
      console.error('[missions] mission-setup hook failed to start:', toErrorMessage(error))
    })
  }
}
