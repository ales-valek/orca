import { defineFixture } from '../../component-fixtures/component-fixture'
import { ConfirmationDialogProvider } from '../confirmation-dialog'
import type { MissionRestackLayer } from '../../../../shared/mission-layer-state'
import type { Mission } from '../../../../shared/mission-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { MissionMemberRows } from './MissionMemberRows'

const repo: Repo = {
  id: 'repo-eshop',
  path: '/repos/eshop',
  displayName: 'eshop',
  badgeColor: '#737373',
  addedAt: 0
}

function makeLayerWorktree(name: string, branch: string): Worktree {
  return {
    id: `${repo.id}::/missions/referral/${name}`,
    repoId: repo.id,
    instanceId: `${name}-instance`,
    path: `/missions/referral/${name}`,
    head: 'abc123',
    branch: `refs/heads/${branch}`,
    isBare: false,
    isMainWorktree: false,
    displayName: name,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

const worktrees = [
  makeLayerWorktree('eshop', 'mission/referral'),
  makeLayerWorktree('omp-951', 'mission-task/referral/omp-951'),
  makeLayerWorktree('omp-953', 'mission-task/referral/omp-953'),
  makeLayerWorktree('preview', 'mission-preview/referral')
]

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [
    {
      repoId: repo.id,
      worktreeId: worktrees[0].id,
      worktreeInstanceId: 'eshop-instance',
      addedAt: 1
    }
  ],
  tasks: [
    {
      id: 't1',
      repoId: repo.id,
      order: 1,
      title: 'Referral checkout',
      branchName: 'mission-task/referral/omp-951',
      worktreeId: worktrees[1].id,
      worktreeInstanceId: 'omp-951-instance',
      parentBaseSha: 'a',
      externalRef: 'OMP-951',
      addedAt: 1
    },
    {
      id: 't2',
      repoId: repo.id,
      order: 2,
      title: 'Referral coupons',
      branchName: 'mission-task/referral/omp-953',
      worktreeId: worktrees[2].id,
      worktreeInstanceId: 'omp-953-instance',
      parentBaseSha: 'b',
      externalRef: 'OMP-953',
      addedAt: 2
    }
  ],
  previews: [
    { repoId: repo.id, worktreeId: worktrees[3].id, worktreeInstanceId: 'preview-instance' }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

function defineStackFixture(
  layers: MissionRestackLayer[],
  slotErrors: Record<string, string> = {}
) {
  return defineFixture({
    width: 300,
    store: {
      repos: [repo],
      worktreesByRepo: { [repo.id]: worktrees },
      missions: [mission],
      missionStackReports: { m1: [{ repoId: repo.id, layers }] },
      missionSlotErrors: slotErrors,
      missionStackReportsStale: { m1: Object.keys(slotErrors).length > 0 }
    },
    render: () => (
      <ConfirmationDialogProvider>
        <div className="bg-sidebar p-1.5 text-foreground">
          <MissionMemberRows mission={mission} />
        </div>
      </ConfirmationDialogProvider>
    )
  })
}

export const current = defineStackFixture([
  { slot: 'member', state: 'current' },
  { slot: 'task:t1', state: 'current' },
  { slot: 'task:t2', state: 'current' },
  { slot: 'preview', state: 'current' }
])

export const attention = defineStackFixture(
  [
    { slot: 'member', state: 'current' },
    { slot: 'task:t1', state: 'needs-push' },
    { slot: 'task:t2', state: 'conflict', reason: 'Rebase stopped on a conflict' },
    { slot: 'preview', state: 'blocked', reason: 'Uncommitted changes' }
  ],
  { 'm1:repo-eshop:member': 'mission_stack_prs_unsupported_provider' }
)
