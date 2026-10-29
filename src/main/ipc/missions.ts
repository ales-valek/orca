import { createMissionDevEnv } from '../dev-env/dev-env-mission-create'
import { ipcMain, type BrowserWindow } from 'electron'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { MissionRestackReport } from '../../shared/mission-layer-state'
import type {
  Mission,
  MissionAbsorbResult,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMemberResult,
  MissionStackPullRequestsResult,
  MissionStackPushResult,
  MissionTaskResult
} from '../../shared/mission-types'
import { HulyStatusWriteBack } from '../huly/huly-status-write-back'
import { setMissionWorktreeRebasedListener } from '../missions/mission-rebase-notification'
import { setMissionPullRequestMergedListener } from '../missions/mission-stack-merge-notification'
import { ensureMissionRootStrict, syncMissionRootIfPresent } from '../missions/mission-root-sync'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  MissionAbsorbArgs,
  MissionAddMembersArgs,
  MissionAddTaskArgs,
  MissionCreateArgs,
  MissionDeleteArgs,
  MissionMemberSelectorArgs,
  MissionRecreateSlotArgs,
  MissionRemoveMemberArgs,
  MissionRemoveTaskArgs,
  MissionRestackArgs,
  MissionSelectorArgs,
  MissionStackPullRequestsArgs,
  MissionUpdateArgs,
  parseMissionIpcArgs
} from './mission-ipc-args'
import { notifyReposChanged } from './repos/repos-changed-notification'
import { MissionOperations } from '../missions/mission-operations'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const MISSION_CHANNELS = [
  'missions:list',
  'missions:create',
  'missions:update',
  'missions:delete',
  'missions:addMembers',
  'missions:removeMember',
  'missions:recreateMemberWorktree',
  'missions:recreateSlotWorktree',
  'missions:ensureSession',
  'missions:inspectStacks',
  'missions:addTask',
  'missions:removeTask',
  'missions:restack',
  'missions:absorb',
  'missions:createStackPullRequests',
  'missions:pushStack'
] as const

async function reconcileDevEnvMissions(runtime: OrcaRuntimeService): Promise<void> {
  try {
    await runtime.getDevEnvOperations().reconcileMissions()
  } catch {
    // Dev Environments are not attached yet, or reconcile failed; the next change retries.
  }
}

export function registerMissionHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  for (const channel of MISSION_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  const hulyStatusWriteBack = new HulyStatusWriteBack({
    store,
    getConnection: () => runtime.getHulyConnection(),
    notifyChanged: () => notifyReposChanged(mainWindow)
  })
  const notifyMissionsChanged = (): void => {
    notifyReposChanged(mainWindow)
    // Why: previews come and go with task layers; environments follow them.
    void reconcileDevEnvMissions(runtime)
  }
  const operations = new MissionOperations(store, runtime, notifyMissionsChanged, {
    onMissionEvent: (event) => hulyStatusWriteBack.handle(event),
    isWorktreeAgentWorking: (worktreeId) => runtime.isWorktreeAgentWorking(worktreeId),
    notifyStacksChanged: (missionId) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('missions:stacksChanged', { missionId })
      }
    }
  })
  const { memberLifecycle } = operations
  // Why: `orca mission` RPC must share this instance so per-Mission locks and UI refreshes match IPC.
  runtime.attachMissionOperations(operations)
  setMissionWorktreeRebasedListener((worktreePath) => operations.onWorktreeRebased(worktreePath))
  setMissionPullRequestMergedListener((merge) => void operations.onPullRequestMerged(merge))

  ipcMain.handle('missions:list', (): Mission[] => operations.list())

  ipcMain.handle(
    'missions:create',
    async (_event, rawArgs: unknown): Promise<MissionCreateResult> => {
      const args = parseMissionIpcArgs(MissionCreateArgs, rawArgs, 'invalid_mission_create_args')
      const result = await operations.create(args)
      const devEnvError = await createMissionDevEnv(
        () => runtime.getDevEnvOperations(),
        result.mission.id,
        args.devEnvTemplateId
      )
      return devEnvError ? { ...result, devEnvError } : result
    }
  )
  ipcMain.handle('missions:update', (_event, rawArgs: unknown): Mission | null => {
    const args = parseMissionIpcArgs(MissionUpdateArgs, rawArgs, 'invalid_mission_update_args')
    const updated = store.updateMission(args.missionId, args.updates)
    if (updated) {
      notifyReposChanged(mainWindow)
    }
    return updated
  })
  ipcMain.handle(
    'missions:delete',
    async (_event, rawArgs: unknown): Promise<MissionDeleteResult> =>
      operations.delete(
        parseMissionIpcArgs(MissionDeleteArgs, rawArgs, 'invalid_mission_delete_args')
      )
  )
  ipcMain.handle(
    'missions:addMembers',
    async (_event, rawArgs: unknown): Promise<MissionCreateResult> =>
      operations.addMembers(
        parseMissionIpcArgs(MissionAddMembersArgs, rawArgs, 'invalid_mission_add_members_args')
      )
  )
  ipcMain.handle(
    'missions:removeMember',
    async (_event, rawArgs: unknown): Promise<MissionDeleteResult> => {
      const args = parseMissionIpcArgs(
        MissionRemoveMemberArgs,
        rawArgs,
        'invalid_mission_remove_member_args'
      )
      return memberLifecycle.run(args.missionId, async () => {
        const mission = store.getMission(args.missionId)
        if (!mission) {
          return { deleted: false, memberResults: [] }
        }
        const member = mission.members.find((entry) => entry.repoId === args.repoId)
        if (!member) {
          return { deleted: false, memberResults: [] }
        }
        try {
          await memberLifecycle.teardownSession(mission)
        } catch (error) {
          return {
            deleted: false,
            memberResults: [
              {
                repoId: member.repoId,
                worktreeId: member.worktreeId,
                error: toErrorMessage(error)
              }
            ]
          }
        }
        const result = args.deleteWorktree
          ? await operations.removeMemberWithLayers(mission, member)
          : await memberLifecycle.detachMember(mission, member)
        syncMissionRootIfPresent(store, mission.id)
        notifyReposChanged(mainWindow)
        return { deleted: false, memberResults: [result] }
      })
    }
  )
  ipcMain.handle(
    'missions:recreateMemberWorktree',
    async (_event, rawArgs: unknown): Promise<MissionMemberResult> => {
      const args = parseMissionIpcArgs(
        MissionMemberSelectorArgs,
        rawArgs,
        'invalid_mission_recreate_args'
      )
      return memberLifecycle.run(args.missionId, async () => {
        const mission = store.getMission(args.missionId)
        if (!mission || !mission.members.some((member) => member.repoId === args.repoId)) {
          throw new Error('mission_member_not_found')
        }
        const rootedMission = ensureMissionRootStrict(store, mission)
        const result = await memberLifecycle.createWorktree(rootedMission, args.repoId)
        syncMissionRootIfPresent(store, mission.id)
        notifyReposChanged(mainWindow)
        return result
      })
    }
  )
  ipcMain.handle(
    'missions:recreateSlotWorktree',
    async (_event, rawArgs: unknown): Promise<MissionMemberResult> =>
      operations.recreateSlotWorktree(
        parseMissionIpcArgs(MissionRecreateSlotArgs, rawArgs, 'invalid_mission_recreate_slot_args')
      )
  )
  ipcMain.handle(
    'missions:ensureSession',
    async (_event, rawArgs: unknown): Promise<FolderWorkspace> => {
      const args = parseMissionIpcArgs(
        MissionSelectorArgs,
        rawArgs,
        'invalid_mission_ensure_session_args'
      )
      return operations.ensureSession(args.missionId)
    }
  )
  ipcMain.handle(
    'missions:inspectStacks',
    async (_event, rawArgs: unknown): Promise<MissionRestackReport[]> => {
      const args = parseMissionIpcArgs(
        MissionSelectorArgs,
        rawArgs,
        'invalid_mission_inspect_stacks_args'
      )
      const mission = store.getMission(args.missionId)
      if (!mission) {
        return []
      }
      return operations.inspectStacks(mission)
    }
  )
  ipcMain.handle('missions:addTask', async (_event, rawArgs: unknown): Promise<MissionTaskResult> =>
    operations.addTask(
      parseMissionIpcArgs(MissionAddTaskArgs, rawArgs, 'invalid_mission_add_task_args')
    )
  )
  ipcMain.handle(
    'missions:removeTask',
    async (_event, rawArgs: unknown): Promise<MissionTaskResult> => {
      const args = parseMissionIpcArgs(
        MissionRemoveTaskArgs,
        rawArgs,
        'invalid_mission_remove_task_args'
      )
      // Why: a layer checkout inside the Mission root cannot be kept, so removal always deletes it.
      return operations.removeTopTask({ ...args, deleteWorktree: true })
    }
  )
  ipcMain.handle(
    'missions:restack',
    async (_event, rawArgs: unknown): Promise<MissionRestackReport[]> =>
      operations.restack(
        parseMissionIpcArgs(MissionRestackArgs, rawArgs, 'invalid_mission_restack_args')
      )
  )
  ipcMain.handle(
    'missions:absorb',
    async (_event, rawArgs: unknown): Promise<MissionAbsorbResult> =>
      operations.absorb(
        parseMissionIpcArgs(MissionAbsorbArgs, rawArgs, 'invalid_mission_absorb_args')
      )
  )
  ipcMain.handle(
    'missions:createStackPullRequests',
    async (_event, rawArgs: unknown): Promise<MissionStackPullRequestsResult> =>
      operations.createStackPullRequests(
        parseMissionIpcArgs(
          MissionStackPullRequestsArgs,
          rawArgs,
          'invalid_mission_stack_pull_requests_args'
        )
      )
  )
  ipcMain.handle(
    'missions:pushStack',
    async (_event, rawArgs: unknown): Promise<MissionStackPushResult> =>
      operations.pushStack(
        parseMissionIpcArgs(MissionMemberSelectorArgs, rawArgs, 'invalid_mission_push_stack_args')
      )
  )
}
