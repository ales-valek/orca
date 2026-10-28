import { vi } from 'vitest'
import type { Mission, MissionSlot, MissionTask } from '../../shared/mission-types'
import { getTopMissionTask } from '../../shared/mission-task-stack'
import type { FakeMissionTaskInput } from './missions-ipc-test-contracts'

type FakeSlotEntry = {
  worktreeId: string | null
  worktreeInstanceId?: string | null
  lastError?: string | null
}

function findFakeSlotEntry(
  mission: Mission | null,
  repoId: string,
  slot: MissionSlot
): FakeSlotEntry | null {
  if (!mission) {
    return null
  }
  if (slot === 'member') {
    return mission.members.find((entry) => entry.repoId === repoId) ?? null
  }
  if (slot === 'preview') {
    mission.previews ??= []
    let preview = mission.previews.find((entry) => entry.repoId === repoId)
    if (!preview) {
      preview = { repoId, worktreeId: null }
      mission.previews.push(preview)
    }
    return preview
  }
  if (slot === 'orchestrator') {
    if (mission.orchestratorRepoId !== repoId) {
      return null
    }
    mission.orchestrator ??= { repoId, worktreeId: null }
    return mission.orchestrator
  }
  const taskId = slot.slice('task:'.length)
  return (mission.tasks ?? []).find((task) => task.id === taskId && task.repoId === repoId) ?? null
}

export function createFakeSlotStoreMethods(getMission: () => Mission | null) {
  return {
    setMissionSlotWorktree: vi.fn(
      (
        _id: string,
        repoId: string,
        slot: MissionSlot,
        worktreeId: string | null,
        worktreeInstanceId: string | null = null
      ) => {
        const mission = getMission()
        const entry = findFakeSlotEntry(mission, repoId, slot)
        if (!entry) {
          return null
        }
        entry.worktreeId = worktreeId
        entry.worktreeInstanceId = worktreeInstanceId
        entry.lastError = null
        return mission
      }
    ),
    setMissionSlotError: vi.fn(
      (_id: string, repoId: string, slot: MissionSlot, error: string | null) => {
        const mission = getMission()
        const entry = findFakeSlotEntry(mission, repoId, slot)
        if (!entry) {
          return null
        }
        entry.lastError = error
        return mission
      }
    ),
    addMissionTask: vi.fn((_id: string, input: FakeMissionTaskInput) => {
      const mission = getMission()
      if (!mission) {
        return null
      }
      const task: MissionTask = {
        ...input,
        id: `task-${(mission.tasks?.length ?? 0) + 1}`,
        order: (getTopMissionTask(mission, input.repoId)?.order ?? 0) + 1,
        worktreeId: null,
        worktreeInstanceId: null,
        parentBaseSha: null,
        lastError: null,
        addedAt: 1
      }
      mission.tasks = [...(mission.tasks ?? []), task]
      return task
    }),
    removeMissionTask: vi.fn((_id: string, taskId: string) => {
      const mission = getMission()
      if (mission) {
        mission.tasks = (mission.tasks ?? []).filter((task) => task.id !== taskId)
      }
      return mission
    }),
    setMissionTaskParentBaseSha: vi.fn((_id: string, taskId: string, sha: string) => {
      const mission = getMission()
      const task = mission?.tasks?.find((entry) => entry.id === taskId)
      if (task) {
        task.parentBaseSha = sha
      }
      return mission
    })
  }
}
