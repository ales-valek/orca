import { translate } from '@/i18n/i18n'
import { toast } from 'sonner'
import type { StateCreator } from 'zustand'
import type {
  Mission,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMemberResult,
  RuntimeMissionHulyCreateResult,
  RuntimeMissionHulyRefreshResult
} from '../../../../shared/mission-types'
import type { HulyApi } from '../../../../preload/api/huly-api'
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AppState } from '../types'
import { createMissionStackSlice, type MissionStackSlice } from './mission-stack-actions'

// Why: missions and their session workspaces live in this app's own catalog, never a runtime's.
const LOCAL_CATALOG_OWNER = { runtimeEnvironmentId: null }

export type MissionsSlice = {
  missions: Mission[]
  /** Per-member worktree errors keyed `${missionId}:${repoId}` and rebuilt
   *  from durable Mission member state after every catalog refresh. */
  missionMemberErrors: Record<string, string>
  fetchMissions: () => Promise<void>
  createMission: (args: {
    name: string
    branchName?: string
    repoIds: string[]
    sessionAgent?: TuiAgent
    orchestratorRepoId?: string
    devEnvTemplateId?: string
  }) => Promise<MissionCreateResult | null>
  renameMission: (missionId: string, name: string) => Promise<void>
  deleteMission: (
    missionId: string,
    deleteWorktrees: boolean
  ) => Promise<MissionDeleteResult | null>
  addMissionMembers: (missionId: string, repoIds: string[]) => Promise<MissionCreateResult | null>
  removeMissionMember: (missionId: string, repoId: string, deleteWorktree: boolean) => Promise<void>
  recreateMissionMemberWorktree: (missionId: string, repoId: string) => Promise<void>
  ensureMissionSession: (missionId: string) => Promise<FolderWorkspace | null>
  /** Rejects with the Huly error so the dialog can show its copy. */
  createMissionFromMilestone: (
    args: Parameters<HulyApi['createMission']>[0]
  ) => Promise<RuntimeMissionHulyCreateResult>
  /** Without `apply` it only reports the diff; rejects with the Huly error. */
  refreshMissionFromHuly: (
    missionId: string,
    apply: boolean
  ) => Promise<RuntimeMissionHulyRefreshResult>
} & MissionStackSlice

export const missionMemberErrorKey = (missionId: string, repoId: string): string =>
  `${missionId}:${repoId}`

export const createMissionsSlice: StateCreator<AppState, [], [], MissionsSlice> = (set, get) => {
  function getPersistedMemberErrors(missions: readonly Mission[]): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const mission of missions) {
      for (const member of mission.members) {
        if (member.lastError) {
          errors[missionMemberErrorKey(mission.id, member.repoId)] = member.lastError
        }
      }
    }
    return errors
  }

  function applyMemberResults(missionId: string, memberResults: MissionMemberResult[]): void {
    set((state) => {
      const next = { ...state.missionMemberErrors }
      for (const result of memberResults) {
        const key = missionMemberErrorKey(missionId, result.repoId)
        if (result.error) {
          next[key] = result.error
        } else {
          delete next[key]
        }
      }
      return { missionMemberErrors: next }
    })
  }

  return {
    ...createMissionStackSlice(set, get),
    missions: [],
    missionMemberErrors: {},

    fetchMissions: async () => {
      try {
        const missions = await window.api.missions.list()
        set({ missions, missionMemberErrors: getPersistedMemberErrors(missions) })
      } catch (err) {
        console.error('Failed to fetch missions:', err)
      }
    },

    createMission: async (args) => {
      try {
        const result = await window.api.missions.create(args)
        applyMemberResults(result.mission.id, result.memberResults)
        await get().fetchMissions()
        if (result.devEnvError) {
          toast.warning(translate('devEnv.createFailed', 'Dev Environment was not created'), {
            description: result.devEnvError
          })
        }
        void get().fetchDevEnvs()
        return result
      } catch (err) {
        console.error('Failed to create mission:', err)
        return null
      }
    },

    renameMission: async (missionId, name) => {
      try {
        await window.api.missions.update({ missionId, updates: { name } })
        await get().fetchMissions()
      } catch (err) {
        console.error('Failed to rename mission:', err)
      }
    },

    deleteMission: async (missionId, deleteWorktrees) => {
      try {
        const sessionWorkspace = get().folderWorkspaces.find(
          (workspace) => workspace.missionId === missionId
        )
        const result = await window.api.missions.delete({ missionId, deleteWorktrees })
        applyMemberResults(missionId, result.memberResults)
        if (result.deleted) {
          await get().fetchFolderWorkspaces(LOCAL_CATALOG_OWNER)
          // Why: main may report a deleted Mission before a folder-workspace
          // refresh proves its session record is gone. Keep terminal UI state
          // until that authoritative catalog no longer contains the workspace.
          if (
            sessionWorkspace &&
            !get().folderWorkspaces.some((workspace) => workspace.id === sessionWorkspace.id)
          ) {
            get().purgeWorktreeTerminalState([folderWorkspaceKey(sessionWorkspace.id)])
          }
        }
        await get().fetchMissions()
        return result
      } catch (err) {
        console.error('Failed to delete mission:', err)
        return null
      }
    },

    addMissionMembers: async (missionId, repoIds) => {
      try {
        const result = await window.api.missions.addMembers({ missionId, repoIds })
        applyMemberResults(missionId, result.memberResults)
        await get().fetchMissions()
        return result
      } catch (err) {
        console.error('Failed to add mission members:', err)
        return null
      }
    },

    removeMissionMember: async (missionId, repoId, deleteWorktree) => {
      try {
        const result = await window.api.missions.removeMember({ missionId, repoId, deleteWorktree })
        applyMemberResults(missionId, result.memberResults)
        // Why: member removal briefly tears down the shared PTY but does not
        // delete the Mission session workspace; its renderer state remains owned.
        await get().fetchMissions()
      } catch (err) {
        console.error('Failed to remove mission member:', err)
      }
    },

    recreateMissionMemberWorktree: async (missionId, repoId) => {
      try {
        const result = await window.api.missions.recreateMemberWorktree({ missionId, repoId })
        applyMemberResults(missionId, [result])
        await get().fetchMissions()
      } catch (err) {
        console.error('Failed to recreate mission worktree:', err)
      }
    },

    ensureMissionSession: async (missionId) => {
      try {
        const workspace = await window.api.missions.ensureSession({ missionId })
        // Why: the session is a folder workspace; both collections must refresh
        // before the caller activates the returned workspace key.
        await get().fetchFolderWorkspaces(LOCAL_CATALOG_OWNER)
        await get().fetchMissions()
        return workspace
      } catch (err) {
        console.error('Failed to ensure mission session:', err)
        return null
      }
    },

    createMissionFromMilestone: async (args) => {
      const result = await window.api.huly.createMission(args)
      await get().fetchMissions()
      return result
    },

    refreshMissionFromHuly: async (missionId, apply) => {
      const result = await window.api.huly.refreshMission({ mission: `id:${missionId}`, apply })
      if (apply) {
        await get().fetchMissions()
        await get().inspectMissionStacks(missionId)
      }
      return result
    }
  }
}
