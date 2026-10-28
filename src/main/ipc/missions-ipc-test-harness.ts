import path from 'node:path'
import { vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import { createMission } from '../../shared/missions'
import { getMissionSessionFolderPath } from '../../shared/mission-session-folder'
import type {
  FakeMissionCreateInput,
  FakeStore,
  FakeWindow,
  FakeWorktreeMeta,
  MissionRootMockSet,
  OwnershipMarkerMockSet
} from './missions-ipc-test-contracts'
import { createFakeSlotStoreMethods } from './missions-ipc-test-slot-fakes'
import { instanceIdForRepo, worktreeIdForRepo } from './missions-ipc-test-runtime-fake'

export {
  createStampedWorktree,
  instanceIdForRepo,
  makeFakeRuntime,
  ownershipProofForRepo,
  worktreeIdForRepo,
  worktreePathForRepo,
  wtR1Path,
  wtR2Path
} from './missions-ipc-test-runtime-fake'

export const missionsBaseDir = path.join(path.sep, 'home', 'u', 'orca', 'missions')
export const referralRootPath = path.join(missionsBaseDir, 'referral')
const workspacesDir = path.join(path.sep, 'home', 'u', 'orca', 'workspaces')
const missionRootMocks = vi.hoisted(() => ({
  MISSIONS_DIR_NAME: 'missions',
  ensureMissionRoot: vi.fn(),
  removeMissionRoot: vi.fn(() => ({ removed: true, preservedEntries: [] })),
  resolveMissionRootPath: vi.fn((baseDir: string, name: string) =>
    path.join(baseDir, name.toLowerCase())
  ),
  resolveMissionsBaseDir: vi.fn(() => missionsBaseDir)
}))

vi.mock('../missions/mission-root', () => missionRootMocks)

const ownershipMarkerMocks = vi.hoisted(() => ({
  assertMissionWorktreeOwnershipMarker: vi.fn(),
  hasMissionWorktreeOwnershipMarker: vi.fn(() => true),
  removeMissionWorktreeOwnershipMarker: vi.fn(),
  // Why: harness worktrees have no Git admin dir, so only the HEAD branch can apply.
  resolveMissionWorktreeBranch: vi.fn((worktree: { branch: string }) =>
    worktree.branch.replace(/^refs\/heads\//, '')
  )
}))

vi.mock('../missions/mission-worktree-ownership-marker', () => ownershipMarkerMocks)

const setupHookMocks = vi.hoisted(() => ({
  runMissionSetupHook: vi.fn(async () => {})
}))

// Why: never execute the developer's real ~/.orca/hooks/mission-setup from tests.
vi.mock('../missions/mission-setup-hook', () => setupHookMocks)

export function getSetupHookMocks(): typeof setupHookMocks {
  return setupHookMocks
}

export function getMissionRootMocks(): MissionRootMockSet {
  return missionRootMocks
}

export function getOwnershipMarkerMocks(): OwnershipMarkerMockSet {
  return ownershipMarkerMocks
}

export function makeFakeStore(): FakeStore {
  let mission: Mission | null = null
  let sessionWorkspace: { id: string; missionId: string; folderPath: string | null } | null = null
  const worktreeMeta: Record<string, FakeWorktreeMeta> = {}
  const flushOrThrow = vi.fn()
  const flushPendingOrThrowAsync = vi.fn(async () => {})
  const deleteMission = vi.fn(() => {
    if (!mission) {
      return false
    }
    mission = null
    sessionWorkspace = null
    return true
  })
  const deleteMissionAndFlush = vi.fn(() => {
    const missionSnapshot = mission
    const sessionWorkspaceSnapshot = sessionWorkspace
    const deleted = deleteMission()
    if (!deleted) {
      return false
    }
    try {
      flushOrThrow()
      return true
    } catch (error) {
      mission = missionSnapshot
      sessionWorkspace = sessionWorkspaceSnapshot
      throw error
    }
  })

  return {
    getRepo: (id: string) => {
      if (id === 'r1' || id === 'r2') {
        return {
          id,
          path: path.join(path.sep, 'repos', id),
          displayName: id === 'r1' ? 'Repo One' : 'Repo Two',
          badgeColor: '#000',
          addedAt: 1,
          kind: 'git' as const,
          connectionId: null,
          executionHostId: 'local' as const
        }
      }
      if (id === 'ssh') {
        return {
          id,
          path: path.join(path.sep, 'srv', 'ssh'),
          displayName: 'SSH Repo',
          badgeColor: '#000',
          addedAt: 1,
          kind: 'git' as const,
          connectionId: 'ssh-1',
          executionHostId: 'ssh:ssh-1' as const
        }
      }
      if (id === 'o1') {
        return {
          id,
          path: path.join(path.sep, 'repos', id),
          displayName: 'Orchestration',
          badgeColor: '#000',
          addedAt: 1,
          kind: 'git' as const,
          connectionId: null,
          executionHostId: 'local' as const
        }
      }
      return null
    },
    getProjects: () => [],
    getSettings: () => ({ workspaceDir: workspacesDir }),
    flushOrThrow,
    flushPendingOrThrowAsync,
    getAllWorktreeMeta: () => worktreeMeta,
    getWorktreeMeta: (worktreeId: string) => worktreeMeta[worktreeId],
    setWorktreeMeta: vi.fn((target: string | { id: string }, updates: FakeWorktreeMeta) => {
      const worktreeId = typeof target === 'string' ? target : target.id
      worktreeMeta[worktreeId] = { ...worktreeMeta[worktreeId], ...updates }
      return worktreeMeta[worktreeId]
    }),
    setMissionRootPath: vi.fn((_id: string, rootPath: string, rootBasePath?: string | null) => {
      if (mission) {
        mission.rootPath = rootPath
        if (rootBasePath !== undefined) {
          mission.rootBasePath = rootBasePath
        }
      }
      return mission
    }),
    getMissionSessionWorkspace: (missionId: string) =>
      sessionWorkspace?.missionId === missionId ? sessionWorkspace : null,
    ensureMissionSessionWorkspace: vi.fn((missionId: string) => {
      sessionWorkspace ??= { id: 'fw-1', missionId, folderPath: null }
      sessionWorkspace.folderPath = mission ? getMissionSessionFolderPath(mission) : null
      return sessionWorkspace
    }),
    getMissions: () => (mission ? [mission] : []),
    getMission: (id: string) => (mission?.id === id ? mission : null),
    createMission: (input: FakeMissionCreateInput) => {
      // Why: the real factory owns validation such as the orchestrator/member overlap.
      const created = createMission({ ...input, tabOrder: 0, now: 1 })
      mission = { ...created, id: 'm1', branchName: input.branchName ?? 'mission/referral' }
      return mission
    },
    updateMission: vi.fn(() => mission),
    deleteMission,
    deleteMissionAndFlush,
    addMissionMembers: vi.fn((_id: string, repoIds: string[]) => {
      if (mission) {
        for (const repoId of repoIds) {
          if (!mission.members.some((member) => member.repoId === repoId)) {
            mission.members.push({
              repoId,
              worktreeId: null,
              worktreeInstanceId: null,
              lastError: null,
              addedAt: 1
            })
          }
        }
      }
      return mission
    }),
    removeMissionMember: vi.fn((_id: string, repoId: string) => {
      if (mission) {
        mission.members = mission.members.filter((member) => member.repoId !== repoId)
      }
      return mission
    }),
    setMissionMemberWorktree: vi.fn(
      (
        _id: string,
        repoId: string,
        worktreeId: string | null,
        worktreeInstanceId: string | null = null
      ) => {
        const member = mission?.members.find((entry) => entry.repoId === repoId)
        if (member) {
          member.worktreeId = worktreeId
          member.worktreeInstanceId = worktreeInstanceId
          member.lastError = null
        }
        return mission
      }
    ),
    setMissionMemberError: vi.fn((_id: string, repoId: string, error: string | null) => {
      const member = mission?.members.find((entry) => entry.repoId === repoId)
      if (member) {
        member.lastError = error
      }
      return mission
    }),
    ...createFakeSlotStoreMethods(() => mission)
  }
}

export function assignOwnedWorktree(
  store: FakeStore,
  repoId: string
): {
  worktreeId: string
  worktreeInstanceId: string
} {
  const worktreeId = worktreeIdForRepo(repoId)
  const worktreeInstanceId = instanceIdForRepo(repoId)
  store.setWorktreeMeta(worktreeId, { instanceId: worktreeInstanceId, missionId: 'm1' })
  store.setMissionMemberWorktree('m1', repoId, worktreeId, worktreeInstanceId)
  return { worktreeId, worktreeInstanceId }
}

export function makeFakeWindow(): FakeWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  }
}
