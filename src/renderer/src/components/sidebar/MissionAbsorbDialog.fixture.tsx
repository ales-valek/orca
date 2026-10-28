import { defineFixture } from '../../component-fixtures/component-fixture'
import type { Mission } from '../../../../shared/mission-types'
import { MissionAbsorbDialog } from './MissionAbsorbDialog'

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [{ repoId: 'repo-eshop', worktreeId: null, addedAt: 1 }],
  tasks: [
    {
      id: 't1',
      repoId: 'repo-eshop',
      order: 1,
      title: 'Referral checkout',
      branchName: 'mission-task/referral/omp-951',
      worktreeId: null,
      parentBaseSha: 'a',
      externalRef: 'OMP-951',
      addedAt: 1
    },
    {
      id: 't2',
      repoId: 'repo-eshop',
      order: 2,
      title: 'Referral coupons',
      branchName: 'mission-task/referral/referral-coupons',
      worktreeId: null,
      parentBaseSha: 'b',
      addedAt: 2
    }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

export const ambiguous = defineFixture({
  width: 640,
  render: () => (
    <MissionAbsorbDialog
      mission={mission}
      repoId="repo-eshop"
      hunks={[
        { file: 'src/checkout/referral-summary.tsx', line: 42, candidateTaskIds: ['t1', 't2'] },
        { file: 'src/coupons/apply.ts', line: 7, candidateTaskIds: ['t1', 't2'] }
      ]}
      onResolved={() => {}}
      onOpenChange={() => {}}
    />
  )
})
