import { ipcMain, type BrowserWindow } from 'electron'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type {
  Mission,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMemberResult
} from '../../shared/mission-types'
import { ensureMissionRootStrict, syncMissionRootIfPresent } from '../missions/mission-root-sync'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  MissionAddMembersArgs,
  MissionCreateArgs,
  MissionDeleteArgs,
  MissionMemberSelectorArgs,
  MissionRemoveMemberArgs,
  MissionSelectorArgs,
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
  'missions:ensureSession'
] as const

export function registerMissionHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  for (const channel of MISSION_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  const operations = new MissionOperations(store, runtime, () => notifyReposChanged(mainWindow))
  const { memberLifecycle } = operations
  // Why: `orca mission` RPC must share this instance so per-Mission locks and UI refreshes match IPC.
  runtime.attachMissionOperations(operations)

  ipcMain.handle('missions:list', (): Mission[] => operations.list())

  ipcMain.handle(
    'missions:create',
    async (_event, rawArgs: unknown): Promise<MissionCreateResult> =>
      operations.create(
        parseMissionIpcArgs(MissionCreateArgs, rawArgs, 'invalid_mission_create_args')
      )
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
          ? await memberLifecycle.removeWorktree(mission, member)
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
}
