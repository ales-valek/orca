import { describe, expect, it, vi } from 'vitest'
import type { HulyGlobalSettings } from '../../shared/huly/huly-project-settings'
import type { Mission, MissionSlot } from '../../shared/mission-types'
import { FakeHulyApi } from './fake-huly-api'
import { HulyConnection } from './huly-connection'
import type { HulyCredentialStore } from './huly-credential-store'
import { HulyStatusWriteBack } from './huly-status-write-back'

const MEMORY_STORE: HulyCredentialStore = {
  readInfo: () => ({ serverUrl: 'https://huly.test', workspace: 'ordermage' }),
  readToken: () => 'secret-token',
  hasToken: () => true,
  save: () => {},
  clear: () => {}
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    name: 'Kiosek',
    branchName: 'mission/kiosek',
    members: [{ repoId: 'r1', worktreeId: null, addedAt: 1 }],
    tasks: [
      {
        id: 't1',
        repoId: 'r1',
        order: 1,
        title: 'Form',
        branchName: 'mission-task/kiosek/omp-1',
        worktreeId: null,
        parentBaseSha: null,
        externalRef: 'OMP-1',
        addedAt: 1
      },
      {
        id: 't2',
        repoId: 'r1',
        order: 2,
        title: 'Hand-made layer',
        branchName: 'mission-task/kiosek/extra',
        worktreeId: null,
        parentBaseSha: null,
        addedAt: 1
      }
    ],
    source: {
      provider: 'huly',
      serverUrl: 'https://huly.test',
      workspace: 'ordermage',
      project: 'OMP',
      milestoneId: 'ms-1',
      milestoneLabel: 'Kiosek',
      milestoneUrl: 'https://huly.test/milestones',
      importedOrder: { r1: ['OMP-1'] },
      lastSyncedAt: 1
    },
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function setup(args: { statusWriteBack: boolean; mission?: Mission }) {
  const mission = args.mission ?? createMission()
  const api = new FakeHulyApi()
  api.issueStatuses.set('OMP-1', { name: 'Backlog', category: 'UnStarted' })
  const createApi = vi.fn(async () => api)
  const settings: Partial<HulyGlobalSettings> = {
    hulyProjects: {
      OMP: {
        componentRepoMap: {},
        skipStatusNames: [],
        statusWriteBack: args.statusWriteBack,
        statusRules: {
          'layer-created': {
            target: 'In Progress',
            fromStatusNames: [],
            fromCategories: ['UnStarted', 'ToDo']
          },
          'stack-pr-created': {
            target: 'CODE REVIEW',
            fromStatusNames: ['In Progress'],
            fromCategories: []
          },
          'stack-merged': { target: null, fromStatusNames: [], fromCategories: [] }
        }
      }
    }
  }
  const slotErrors: { missionId: string; repoId: string; slot: MissionSlot; error: string }[] = []
  const store = {
    getMission: (missionId: string) => (missionId === mission.id ? mission : null),
    getSettings: () => settings,
    setMissionSlotError: vi.fn(
      (missionId: string, repoId: string, slot: MissionSlot, error: string | null) => {
        if (error !== null) {
          slotErrors.push({ missionId, repoId, slot, error })
        }
        return mission
      }
    )
  }
  const connection = new HulyConnection({ createApi, store: MEMORY_STORE })
  const notifyChanged = vi.fn()
  const writeBack = new HulyStatusWriteBack({ store, connection, notifyChanged })
  return { api, createApi, store, slotErrors, writeBack, notifyChanged }
}

describe('HulyStatusWriteBack', () => {
  it('makes no Huly call while write-back is off for the project', async () => {
    const { api, createApi, writeBack } = setup({ statusWriteBack: false })

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1']
    })

    expect(result).toEqual({ written: [], warnings: [] })
    expect(createApi).not.toHaveBeenCalled()
    expect(api.statusWrites).toEqual([])
  })

  it('makes no Huly call for a Mission without a Huly source', async () => {
    const { createApi, writeBack } = setup({
      statusWriteBack: true,
      mission: createMission({ source: null })
    })

    await writeBack.handle({ kind: 'layer-created', missionId: 'm1', taskIds: ['t1'] })

    expect(createApi).not.toHaveBeenCalled()
  })

  it('makes no Huly call when the rule has no target or no task has an issue', async () => {
    const { createApi, writeBack } = setup({ statusWriteBack: true })

    await writeBack.handle({ kind: 'stack-merged', missionId: 'm1', taskIds: ['t1'] })
    await writeBack.handle({ kind: 'layer-created', missionId: 'm1', taskIds: ['t2'] })

    expect(createApi).not.toHaveBeenCalled()
  })

  it('moves a Backlog issue to In Progress when its layer is created', async () => {
    const { api, writeBack } = setup({ statusWriteBack: true })

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1', 't2']
    })

    expect(result).toEqual({ written: ['OMP-1'], warnings: [] })
    expect(api.statusWrites).toEqual([
      { project: 'OMP', identifier: 'OMP-1', statusName: 'In Progress' }
    ])
  })

  it('does not write over a status the user set by hand', async () => {
    const { api, writeBack } = setup({ statusWriteBack: true })
    api.issueStatuses.set('OMP-1', { name: 'BLOCKED', category: 'Active' })

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1']
    })

    expect(result).toEqual({ written: [], warnings: [] })
    expect(api.statusWrites).toEqual([])
  })

  it('records a failed write as a task warning instead of throwing', async () => {
    const { api, slotErrors, writeBack, notifyChanged } = setup({ statusWriteBack: true })
    vi.spyOn(api, 'setIssueStatus').mockRejectedValue(new Error('status not allowed'))

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1']
    })

    expect(result).toEqual({ written: [], warnings: ['Huly: status not allowed'] })
    expect(slotErrors).toEqual([
      { missionId: 'm1', repoId: 'r1', slot: 'task:t1', error: 'Huly: status not allowed' }
    ])
    expect(slotErrors[0].error.startsWith('Huly: ')).toBe(true)
    expect(notifyChanged).toHaveBeenCalled()
  })

  it('keeps a layer error on the task and only reports the Huly warning', async () => {
    const mission = createMission()
    mission.tasks![0].lastError = 'mission_task_worktree_missing'
    const { api, store, writeBack } = setup({ statusWriteBack: true, mission })
    vi.spyOn(api, 'setIssueStatus').mockRejectedValue(new Error('status not allowed'))

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1']
    })

    expect(result.warnings).toEqual(['Huly: status not allowed'])
    expect(store.setMissionSlotError).not.toHaveBeenCalled()
  })

  it('clears its own earlier warning after a successful write', async () => {
    const mission = createMission()
    mission.tasks![0].lastError = 'Huly: huly_auth_required'
    const { store, writeBack } = setup({ statusWriteBack: true, mission })

    await writeBack.handle({ kind: 'layer-created', missionId: 'm1', taskIds: ['t1'] })

    expect(store.setMissionSlotError).toHaveBeenCalledWith('m1', 'r1', 'task:t1', null)
  })

  it('refuses to write into a different Huly workspace than the Mission came from', async () => {
    const mission = createMission()
    mission.source = { ...mission.source!, workspace: 'other' }
    const { createApi, writeBack } = setup({ statusWriteBack: true, mission })

    const result = await writeBack.handle({
      kind: 'layer-created',
      missionId: 'm1',
      taskIds: ['t1']
    })

    expect(createApi).not.toHaveBeenCalled()
    expect(result.warnings).toEqual(['Huly: connected to a different workspace than this Mission'])
  })
})
