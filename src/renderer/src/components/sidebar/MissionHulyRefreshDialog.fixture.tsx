import { defineFixture } from '../../component-fixtures/component-fixture'
import type { HulyMissionRefreshDiff } from '../../../../shared/huly/huly-mission-refresh'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import type { Mission } from '../../../../shared/mission-types'
import type { Repo } from '../../../../shared/repo-types'
import { MissionHulyRefreshDialog } from './MissionHulyRefreshDialog'

const repos: Repo[] = ['eshop', 'admin', 'api'].map((name) => ({
  id: `repo-${name}`,
  path: `/repos/${name}`,
  displayName: name,
  badgeColor: '#737373',
  addedAt: 0
}))

function issue(number: number, title: string): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title,
    url: `https://huly.example.com/OMP-${number}`,
    status: { name: 'Todo', category: 'ToDo' },
    componentId: 'c-eshop',
    blockedBy: [],
    parentIssueId: null
  }
}

const mission: Mission = {
  id: 'm1',
  name: 'Referral program',
  branchName: 'mission/referral-program',
  members: [{ repoId: 'repo-eshop', worktreeId: null, addedAt: 1 }],
  source: {
    provider: 'huly',
    serverUrl: 'https://huly.example.com',
    workspace: 'ordermage',
    project: 'OMP',
    milestoneId: 'm-referral',
    milestoneLabel: 'Referral program',
    milestoneUrl: 'https://huly.example.com/m-referral',
    importedOrder: { 'repo-eshop': ['OMP-948', 'OMP-953'] },
    lastSyncedAt: 1
  },
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

const DIFF: HulyMissionRefreshDiff = {
  appendable: [
    { repoId: 'repo-eshop', issues: [issue(964, 'Referral share link'), issue(965, 'Copy tweaks')] }
  ],
  reorderedInHuly: [
    { repoId: 'repo-eshop', before: ['OMP-948', 'OMP-953'], after: ['OMP-953', 'OMP-948'] }
  ],
  removed: ['OMP-960'],
  completed: ['OMP-948'],
  movedRepo: [{ identifier: 'OMP-951', fromRepoId: 'repo-eshop', toRepoId: 'repo-admin' }],
  nonAppendable: [
    { repoId: 'repo-eshop', identifier: 'OMP-949', reason: 'inserted-in-middle' },
    { repoId: 'repo-api', identifier: 'OMP-970', reason: 'repo-not-in-mission' },
    { repoId: null, identifier: 'OMP-971', reason: 'unmapped' }
  ]
}

function installRefresh(diff: HulyMissionRefreshDiff): () => void {
  return () => {
    window.api.huly = {
      ...window.api.huly,
      refreshMission: async () => ({
        mission: {
          id: 'm1',
          name: mission.name,
          branch: mission.branchName,
          rootPath: null,
          members: []
        },
        diff,
        applied: [],
        warnings: []
      })
    }
  }
}

export const diff = defineFixture({
  width: 640,
  store: { repos },
  setup: installRefresh(DIFF),
  render: () => <MissionHulyRefreshDialog mission={mission} onOpenChange={() => {}} />
})

export const unchanged = defineFixture({
  width: 640,
  store: { repos },
  setup: installRefresh({
    appendable: [],
    reorderedInHuly: [],
    removed: [],
    movedRepo: [],
    nonAppendable: []
  }),
  render: () => <MissionHulyRefreshDialog mission={mission} onOpenChange={() => {}} />
})
