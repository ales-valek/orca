import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HulyGlobalSettings } from '../../shared/huly/huly-project-settings'
import type { HulyIssue, HulyStatus } from '../../shared/huly/huly-types'
import type { Mission, MissionSource, MissionTaskResult } from '../../shared/mission-types'
import type { MissionCreateInput } from '../ipc/mission-ipc-args'
import type { MissionAddTaskInput } from '../missions/mission-task-operations'
import { FakeHulyApi } from './fake-huly-api'
import { HulyConnection } from './huly-connection'
import type { HulyCredentialStore } from './huly-credential-store'
import {
  HulyMissionImport,
  resolveHulyMilestoneId,
  resolveHulyProject
} from './huly-mission-import'

const TODO: HulyStatus = { name: 'Todo', category: 'ToDo' }
const MERGED: HulyStatus = { name: 'MERGED IN MILESTONE', category: 'Active' }

const COMPONENT_REPOS: Record<string, string> = {
  'c-eshop': 'eshop',
  'c-admin': 'admin',
  'c-plugin-engine': 'plugin-engine',
  'c-demos': 'demos',
  'c-tests': 'tests',
  'c-blog': 'blog-cms'
}

function createIssue(number: number, overrides: Partial<HulyIssue> = {}): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://huly.test/OMP-${number}`,
    status: TODO,
    componentId: 'c-eshop',
    blockedBy: [],
    parentIssueId: null,
    ...overrides
  }
}

function createKiosekIssues(): HulyIssue[] {
  return [
    createIssue(978, { blockedBy: ['OMP-955'] }),
    createIssue(976, { blockedBy: ['OMP-951'] }),
    createIssue(955, { blockedBy: ['OMP-976'] }),
    createIssue(957, { blockedBy: ['OMP-951'] }),
    createIssue(953, { blockedBy: ['OMP-951'] }),
    createIssue(951),
    createIssue(960, { componentId: 'c-admin', blockedBy: ['OMP-951'] }),
    createIssue(961, { componentId: 'c-plugin-engine' }),
    createIssue(962, { componentId: 'c-demos' }),
    createIssue(963, { componentId: 'c-tests' }),
    createIssue(964, { componentId: 'c-blog' }),
    createIssue(940, { status: MERGED })
  ]
}

const NO_RULE = { target: null, fromStatusNames: [], fromCategories: [] }

const SETTINGS: Partial<HulyGlobalSettings> = {
  hulyProjects: {
    OMP: {
      componentRepoMap: COMPONENT_REPOS,
      skipStatusNames: ['MERGED IN MILESTONE'],
      statusWriteBack: false,
      statusRules: {
        'layer-created': NO_RULE,
        'stack-pr-created': NO_RULE,
        'stack-merged': NO_RULE
      }
    }
  }
}

const ESHOP_ORDER = ['OMP-951', 'OMP-953', 'OMP-957', 'OMP-976', 'OMP-955', 'OMP-978']

const MEMORY_STORE: HulyCredentialStore = {
  readInfo: () => ({ serverUrl: 'https://huly.test', workspace: 'ordermage' }),
  readToken: () => 'secret-token',
  hasToken: () => true,
  save: () => {},
  clear: () => {}
}

function createBaseMission(args: MissionCreateInput): Mission {
  return {
    id: 'mission-1',
    name: args.name,
    branchName: args.branchName ?? 'mission/x',
    members: args.repoIds.map((repoId) => ({ repoId, worktreeId: `${repoId}::wt`, addedAt: 1 })),
    tasks: [],
    tabOrder: 0,
    rootPath: '/missions/kiosek',
    createdAt: 1,
    updatedAt: 1
  }
}

let api: FakeHulyApi
let mission: Mission
let failingRepo: string | null

function makeHarness() {
  const connection = new HulyConnection({ store: MEMORY_STORE, createApi: async () => api })
  const create = vi.fn(async (args: MissionCreateInput) => {
    mission = createBaseMission(args)
    return { mission, memberResults: [] }
  })
  const addTask = vi.fn(async (args: MissionAddTaskInput): Promise<MissionTaskResult> => {
    if (args.repoId === failingRepo) {
      return { mission, task: null, error: 'mission_member_worktree_missing' }
    }
    const task = {
      id: `task-${args.externalRef}`,
      repoId: args.repoId,
      order: (mission.tasks ?? []).filter((entry) => entry.repoId === args.repoId).length + 1,
      title: args.title,
      branchName: `mission-task/kiosek/${String(args.externalRef).toLowerCase()}`,
      worktreeId: `${args.repoId}::${args.externalRef}`,
      parentBaseSha: null,
      externalRef: args.externalRef ?? null,
      externalId: args.externalId ?? null,
      addedAt: 1
    }
    mission = { ...mission, tasks: [...(mission.tasks ?? []), task] }
    return { mission, task }
  })
  const setMissionSource = vi.fn((_missionId: string, source: MissionSource) => {
    mission = { ...mission, source }
    return mission
  })
  const writeBrief = vi.fn((_mission: Mission, _markdown: string) => true)
  const importer = new HulyMissionImport({
    connection,
    getSettings: () => SETTINGS,
    missions: { create, addTask },
    getMission: () => mission,
    setMissionSource,
    writeBrief,
    getRepoName: (repoId) => repoId,
    now: () => 42
  })
  return { importer, create, addTask, setMissionSource, writeBrief }
}

beforeEach(() => {
  api = new FakeHulyApi()
  api.milestones = [
    {
      id: 'ms-kiosek',
      label: 'Kiosek',
      status: 'In Progress',
      descriptionMarkdown: 'Kiosk mode.',
      url: 'https://huly.test/milestones'
    }
  ]
  api.issuesByMilestone.set('ms-kiosek', createKiosekIssues())
  failingRepo = null
})

describe('HulyMissionImport.createMissionFromMilestone', () => {
  it('creates the Mission with every stack repo, adds tasks bottom-up and writes the brief', async () => {
    const { importer, create, addTask, setMissionSource, writeBrief } = makeHarness()

    const result = await importer.createMissionFromMilestone({
      project: 'OMP',
      milestoneId: 'ms-kiosek'
    })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Kiosek',
      branchName: 'mission/kiosek'
    })
    expect([...create.mock.calls[0][0].repoIds].sort()).toEqual(
      ['admin', 'blog-cms', 'demos', 'eshop', 'plugin-engine', 'tests'].sort()
    )
    const eshopCalls = addTask.mock.calls.map(([args]) => args).filter((a) => a.repoId === 'eshop')
    expect(eshopCalls.map((args) => args.externalRef)).toEqual(ESHOP_ORDER)
    expect(eshopCalls[0]).toMatchObject({ title: 'Issue 951', externalId: 'id-951' })
    expect(setMissionSource.mock.invocationCallOrder[0]).toBeLessThan(
      addTask.mock.invocationCallOrder[0]
    )
    expect(setMissionSource.mock.calls[0][1]).toMatchObject({
      provider: 'huly',
      serverUrl: 'https://huly.test',
      workspace: 'ordermage',
      project: 'OMP',
      milestoneId: 'ms-kiosek',
      milestoneLabel: 'Kiosek',
      lastSyncedAt: 42
    })
    expect(writeBrief).toHaveBeenCalledOnce()
    expect(writeBrief.mock.calls[0][1]).toContain('mission-task/kiosek/omp-951')
    expect(result.taskResults).toHaveLength(11)
    expect(result.warnings).toEqual([])
  })

  it('refuses an unmapped issue before any Mission write', async () => {
    api.issuesByMilestone.set('ms-kiosek', [
      ...createKiosekIssues(),
      createIssue(999, { componentId: null })
    ])
    const { importer, create } = makeHarness()

    await expect(
      importer.createMissionFromMilestone({ project: 'OMP', milestoneId: 'ms-kiosek' })
    ).rejects.toMatchObject({
      code: 'huly_plan_unresolved',
      message: expect.stringContaining('huly_plan_unresolved'),
      data: { unmapped: ['OMP-999'], cycles: [] }
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('fails with huly_auth_required when the token dies mid-read, before any Mission write', async () => {
    api.listMilestoneIssues = async () => {
      throw new Error('ERROR: platform:status:TokenExpired {}')
    }
    const { importer, create, setMissionSource } = makeHarness()

    await expect(
      importer.createMissionFromMilestone({ project: 'OMP', milestoneId: 'ms-kiosek' })
    ).rejects.toThrow('huly_auth_required')
    expect(create).not.toHaveBeenCalled()
    expect(setMissionSource).not.toHaveBeenCalled()
  })

  it('records the Huly order as importedOrder even when the stack order is overridden', async () => {
    const { importer, addTask, setMissionSource } = makeHarness()
    const overridden = ['OMP-951', 'OMP-957', 'OMP-953', 'OMP-976', 'OMP-955', 'OMP-978']

    await importer.createMissionFromMilestone({
      project: 'OMP',
      milestoneId: 'ms-kiosek',
      orderOverrides: { eshop: overridden }
    })

    const eshopRefs = addTask.mock.calls
      .map(([args]) => args)
      .filter((args) => args.repoId === 'eshop')
      .map((args) => args.externalRef)
    expect(eshopRefs).toEqual(overridden)
    expect(setMissionSource.mock.calls[0][1].importedOrder.eshop).toEqual(ESHOP_ORDER)
  })

  it('keeps adding other repos after a repo fails, warns, and still writes the brief', async () => {
    failingRepo = 'eshop'
    const { importer, addTask, writeBrief } = makeHarness()

    const result = await importer.createMissionFromMilestone({
      project: 'OMP',
      milestoneId: 'ms-kiosek'
    })

    const eshopCalls = addTask.mock.calls.filter(([args]) => args.repoId === 'eshop')
    expect(eshopCalls).toHaveLength(1)
    expect(addTask.mock.calls.some(([args]) => args.repoId === 'tests')).toBe(true)
    expect(result.warnings.join('\n')).toContain('OMP-951')
    expect(result.warnings.join('\n')).toContain('mission_member_worktree_missing')
    expect(writeBrief).toHaveBeenCalledOnce()
  })
})

describe('HulyMissionImport.refreshMissionFromHuly', () => {
  async function importKiosek(createArgs: { repoOverrides?: Record<string, string> } = {}) {
    const harness = makeHarness()
    await harness.importer.createMissionFromMilestone({
      project: 'OMP',
      milestoneId: 'ms-kiosek',
      ...createArgs
    })
    harness.addTask.mockClear()
    harness.writeBrief.mockClear()
    harness.setMissionSource.mockClear()
    return harness
  }

  it('stores the creation repoOverrides in the Mission source', async () => {
    await importKiosek({ repoOverrides: { 'OMP-962': 'eshop' } })
    expect(mission.source?.repoOverrides).toEqual({ 'OMP-962': 'eshop' })
  })

  it('does not report user-moved issues as movedRepo when repoOverrides were stored', async () => {
    const { importer } = await importKiosek({ repoOverrides: { 'OMP-962': 'eshop' } })

    const { diff } = await importer.refreshMissionFromHuly({
      missionId: mission.id,
      apply: false
    })

    expect(diff.movedRepo).toEqual([])
    expect(diff.reorderedInHuly).toEqual([])
  })

  it('previews without writing anything', async () => {
    const { importer, addTask, setMissionSource, writeBrief } = await importKiosek()
    api.issuesByMilestone.set('ms-kiosek', [
      ...createKiosekIssues(),
      createIssue(979, { blockedBy: ['OMP-978'] })
    ])

    const { diff, applied } = await importer.refreshMissionFromHuly({
      missionId: mission.id,
      apply: false
    })

    expect(diff.appendable.map((entry) => entry.issues.map((i) => i.identifier))).toEqual([
      ['OMP-979']
    ])
    expect(applied).toEqual([])
    expect(addTask).not.toHaveBeenCalled()
    expect(setMissionSource).not.toHaveBeenCalled()
    expect(writeBrief).not.toHaveBeenCalled()
  })

  it('appends only appendable issues, updates importedOrder, rewrites the brief and syncs', async () => {
    const { importer, addTask, writeBrief } = await importKiosek()
    api.issuesByMilestone.set('ms-kiosek', [
      ...createKiosekIssues(),
      createIssue(979, { blockedBy: ['OMP-978'] }),
      createIssue(980, { blockedBy: ['OMP-979'] }),
      createIssue(950, { blockedBy: [] }),
      createIssue(965, { componentId: 'c-admin', blockedBy: ['OMP-960'] })
    ])

    const result = await importer.refreshMissionFromHuly({ missionId: mission.id, apply: true })

    expect(result.diff.nonAppendable.map((entry) => entry.identifier)).toEqual(['OMP-950'])
    expect(
      addTask.mock.calls.map(([args]) => [args.repoId, args.externalRef, args.externalId])
    ).toEqual([
      ['admin', 'OMP-965', 'id-965'],
      ['eshop', 'OMP-979', 'id-979'],
      ['eshop', 'OMP-980', 'id-980']
    ])
    expect(result.applied).toHaveLength(3)
    expect(mission.source?.importedOrder.eshop).toEqual([...ESHOP_ORDER, 'OMP-979', 'OMP-980'])
    expect(mission.source?.importedOrder.admin).toEqual(['OMP-960', 'OMP-965'])
    expect(mission.source?.lastSyncedAt).toBe(42)
    expect(writeBrief).toHaveBeenCalledOnce()
    expect(writeBrief.mock.calls[0][1]).toContain('mission-task/kiosek/omp-980')
  })

  it('keeps importedOrder aligned with the plan across repeated refreshes', async () => {
    const { importer, addTask } = await importKiosek()
    mission = {
      ...mission,
      tasks: (mission.tasks ?? []).filter((task) => task.externalRef !== 'OMP-978')
    }
    api.issuesByMilestone.set('ms-kiosek', [
      ...createKiosekIssues(),
      createIssue(956, { blockedBy: ['OMP-955'] }),
      createIssue(979, { blockedBy: ['OMP-978'] })
    ])

    const first = await importer.refreshMissionFromHuly({ missionId: mission.id, apply: true })

    expect(first.diff.nonAppendable).toEqual([
      { repoId: 'eshop', identifier: 'OMP-956', reason: 'inserted-in-middle' }
    ])
    expect(addTask.mock.calls.map(([args]) => args.externalRef)).toEqual(['OMP-979'])
    const second = await importer.refreshMissionFromHuly({ missionId: mission.id, apply: true })

    expect(second.diff.reorderedInHuly).toEqual([])
    expect(second.diff.appendable).toEqual([])
    expect(addTask).toHaveBeenCalledOnce()
  })

  it('records only the issues that were actually appended', async () => {
    const { importer } = await importKiosek()
    api.issuesByMilestone.set('ms-kiosek', [
      ...createKiosekIssues(),
      createIssue(979, { blockedBy: ['OMP-978'] }),
      createIssue(980, { blockedBy: ['OMP-979'] })
    ])
    failingRepo = 'eshop'

    const result = await importer.refreshMissionFromHuly({ missionId: mission.id, apply: true })

    expect(result.warnings.join('\n')).toContain('not added: OMP-980')
    expect(mission.source?.importedOrder.eshop).toEqual(ESHOP_ORDER)
  })

  it('reads Huly before any write', async () => {
    const { importer, addTask, setMissionSource } = await importKiosek()
    api.listMilestoneIssues = async () => {
      throw new Error('ERROR: platform:status:TokenExpired {}')
    }

    await expect(
      importer.refreshMissionFromHuly({ missionId: mission.id, apply: true })
    ).rejects.toThrow('huly_auth_required')
    expect(addTask).not.toHaveBeenCalled()
    expect(setMissionSource).not.toHaveBeenCalled()
  })

  it('rejects a Mission without a Huly source', async () => {
    const { importer } = await importKiosek()
    mission = { ...mission, source: null }

    await expect(
      importer.refreshMissionFromHuly({ missionId: mission.id, apply: false })
    ).rejects.toThrow('mission_not_from_huly')
  })
})

describe('Huly selector resolution', () => {
  it('resolves a milestone by id or by case-insensitive exact label', async () => {
    await expect(resolveHulyMilestoneId(api, 'OMP', 'ms-kiosek')).resolves.toBe('ms-kiosek')
    await expect(resolveHulyMilestoneId(api, 'OMP', 'kiosek')).resolves.toBe('ms-kiosek')
    await expect(resolveHulyMilestoneId(api, 'OMP', 'Kios')).rejects.toThrow(
      'huly_milestone_not_found'
    )
  })

  it('defaults the project to the only configured or workspace project', async () => {
    await expect(resolveHulyProject(api, {}, undefined)).resolves.toBe('OMP')
    api.projects = [...api.projects, { identifier: 'WEB', name: 'Web' }]
    await expect(resolveHulyProject(api, {}, undefined)).rejects.toThrow('huly_project_required')
    await expect(resolveHulyProject(api, SETTINGS, undefined)).resolves.toBe('OMP')
    await expect(resolveHulyProject(api, {}, 'WEB')).resolves.toBe('WEB')
  })
})
