import { describe, expect, it } from 'vitest'
import { isValidGitBranchName } from './git-branch-name'
import {
  createMissionTaskBranchName,
  getMissionBranchSlug,
  getMissionPreviewBranch,
  getMissionSlotBranch,
  getMissionTaskParentBranch,
  getRepoTaskStack,
  getTopMissionTask
} from './mission-task-stack'
import type { Mission, MissionTask } from './mission-types'

function makeTask(overrides: Partial<MissionTask> & { id: string }): MissionTask {
  return {
    repoId: 'repo-a',
    order: 1,
    title: 'Task',
    branchName: `mission-task/kiosek/${overrides.id}`,
    worktreeId: null,
    parentBaseSha: null,
    addedAt: 1,
    ...overrides
  }
}

describe('getMissionBranchSlug', () => {
  it('drops the mission/ prefix and flattens other separators', () => {
    expect(getMissionBranchSlug('mission/kiosek')).toBe('kiosek')
    expect(getMissionBranchSlug('feature/x')).toBe('feature-x')
  })
})

describe('getMissionPreviewBranch', () => {
  it('maps the mission branch into the mission-preview namespace', () => {
    expect(getMissionPreviewBranch({ branchName: 'mission/kiosek' })).toBe('mission-preview/kiosek')
    expect(getMissionPreviewBranch({ branchName: 'feature/x' })).toBe('mission-preview/feature-x')
  })
})

describe('createMissionTaskBranchName', () => {
  const base = { branchName: 'mission/kiosek', tasks: [] as MissionTask[] }

  it('prefers the external ref for the task slug', () => {
    expect(createMissionTaskBranchName(base, { title: 'Košík', externalRef: 'OMP-951' })).toBe(
      'mission-task/kiosek/omp-951'
    )
  })

  it('keeps task slugs off the reserved preview and orchestrator directory suffixes', () => {
    expect(createMissionTaskBranchName(base, { title: 'Preview' })).toBe(
      'mission-task/kiosek/preview-2'
    )
    expect(createMissionTaskBranchName(base, { title: 'x', externalRef: 'Orchestrator' })).toBe(
      'mission-task/kiosek/orchestrator-2'
    )
  })

  it('suffixes a counter when the branch is already taken', () => {
    const tasks = [makeTask({ id: 't1', branchName: 'mission-task/kiosek/omp-951' })]
    expect(
      createMissionTaskBranchName({ ...base, tasks }, { title: 'Košík', externalRef: 'OMP-951' })
    ).toBe('mission-task/kiosek/omp-951-2')
  })

  it('falls back to the title and folds diacritics into ASCII', () => {
    const branch = createMissionTaskBranchName(base, { title: 'Košík a objednávka' })
    expect(branch).toBe('mission-task/kiosek/kosik-a-objednavka')
    expect(isValidGitBranchName(branch)).toBe(true)
  })

  it('caps a long title slug at a word boundary', () => {
    const branch = createMissionTaskBranchName(base, {
      title: 'Přidat podporu pro hromadné úpravy objednávek v administraci'
    })
    expect(branch).toBe('mission-task/kiosek/pridat-podporu-pro-hromadne-upravy')
  })

  it('skips a name whose branch already exists in the repo', () => {
    const existing = new Set(['mission-task/kiosek/omp-951', 'mission-task/kiosek/omp-951-2'])
    expect(
      createMissionTaskBranchName(base, { title: 'x', externalRef: 'OMP-951' }, existing)
    ).toBe('mission-task/kiosek/omp-951-3')
  })

  it('uses a generic slug when nothing survives sanitization', () => {
    expect(createMissionTaskBranchName(base, { title: '###' })).toBe('mission-task/kiosek/task')
  })
})

describe('getRepoTaskStack', () => {
  it('filters by repo and sorts by order', () => {
    const tasks = [
      makeTask({ id: 'a3', order: 3 }),
      makeTask({ id: 'b1', repoId: 'repo-b', order: 1 }),
      makeTask({ id: 'a1', order: 1 })
    ]
    expect(getRepoTaskStack({ tasks }, 'repo-a').map((task) => task.id)).toEqual(['a1', 'a3'])
    expect(getRepoTaskStack({}, 'repo-a')).toEqual([])
  })
})

describe('getTopMissionTask', () => {
  it('returns the highest order task of the repo or null', () => {
    const tasks = [makeTask({ id: 'a1', order: 1 }), makeTask({ id: 'a2', order: 2 })]
    expect(getTopMissionTask({ tasks }, 'repo-a')?.id).toBe('a2')
    expect(getTopMissionTask({ tasks }, 'repo-b')).toBeNull()
    expect(getTopMissionTask({}, 'repo-a')).toBeNull()
  })
})

describe('getMissionTaskParentBranch', () => {
  const tasks = [
    makeTask({ id: 'a1', order: 1, branchName: 'mission-task/kiosek/a1' }),
    makeTask({ id: 'b2', repoId: 'repo-b', order: 2, branchName: 'mission-task/kiosek/b2' }),
    makeTask({ id: 'a2', order: 2, branchName: 'mission-task/kiosek/a2' }),
    makeTask({ id: 'a3', order: 3, branchName: 'mission-task/kiosek/a3' })
  ]
  const mission = { branchName: 'mission/kiosek', tasks }

  it('uses the mission branch for the first layer', () => {
    expect(getMissionTaskParentBranch(mission, { repoId: 'repo-a', order: 1 })).toBe(
      'mission/kiosek'
    )
  })

  it('uses the previous layer of the same repo, never another repo', () => {
    expect(getMissionTaskParentBranch(mission, { repoId: 'repo-a', order: 3 })).toBe(
      'mission-task/kiosek/a2'
    )
  })

  it('falls back to the mission branch when the previous layer is missing', () => {
    expect(getMissionTaskParentBranch(mission, { repoId: 'repo-c', order: 2 })).toBe(
      'mission/kiosek'
    )
  })
})

describe('getMissionSlotBranch', () => {
  const mission: Mission = {
    id: 'm1',
    name: 'Kiosek',
    branchName: 'mission/kiosek',
    members: [{ repoId: 'repo-a', worktreeId: null, addedAt: 1 }],
    tasks: [makeTask({ id: 'a1', branchName: 'mission-task/kiosek/a1' })],
    previews: [{ repoId: 'repo-a', worktreeId: null }],
    orchestratorRepoId: 'repo-o',
    orchestrator: { repoId: 'repo-o', worktreeId: null },
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1
  }

  it('resolves each slot kind to its branch', () => {
    expect(getMissionSlotBranch(mission, 'repo-a', 'member')).toBe('mission/kiosek')
    expect(getMissionSlotBranch(mission, 'repo-a', 'preview')).toBe('mission-preview/kiosek')
    expect(getMissionSlotBranch(mission, 'repo-o', 'orchestrator')).toBe('mission/kiosek')
    expect(getMissionSlotBranch(mission, 'repo-a', 'task:a1')).toBe('mission-task/kiosek/a1')
  })

  it('returns null when the repo does not hold that slot', () => {
    expect(getMissionSlotBranch(mission, 'repo-b', 'member')).toBeNull()
    expect(getMissionSlotBranch(mission, 'repo-b', 'preview')).toBeNull()
    expect(getMissionSlotBranch(mission, 'repo-a', 'orchestrator')).toBeNull()
    expect(getMissionSlotBranch(mission, 'repo-b', 'task:a1')).toBeNull()
    expect(getMissionSlotBranch(mission, 'repo-a', 'task:missing')).toBeNull()
  })

  it('resolves the preview of a repo with tasks before its record exists', () => {
    const withoutPreview: Mission = { ...mission, previews: [] }
    const withoutTasks: Mission = { ...mission, tasks: [], previews: [] }

    expect(getMissionSlotBranch(withoutPreview, 'repo-a', 'preview')).toBe('mission-preview/kiosek')
    expect(getMissionSlotBranch(withoutTasks, 'repo-a', 'preview')).toBeNull()
  })
})
