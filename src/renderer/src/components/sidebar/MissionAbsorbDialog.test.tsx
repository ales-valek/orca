// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../../../shared/mission-types'

vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/testing/app-store-test-fixture')
  return { useAppStore: createTestStore() }
})
vi.mock('@/components/ui/select', () => import('@/components/ui/select-test-double'))

import { useAppStore } from '@/store'
import { MissionAbsorbDialog, type MissionAbsorbHunk } from './MissionAbsorbDialog'

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [{ repoId: 'r1', worktreeId: null, addedAt: 1 }],
  tasks: [
    {
      id: 't1',
      repoId: 'r1',
      order: 1,
      title: 'Checkout',
      branchName: 'mission-task/referral/omp-951',
      worktreeId: null,
      parentBaseSha: 'a',
      externalRef: 'OMP-951',
      addedAt: 1
    },
    {
      id: 't2',
      repoId: 'r1',
      order: 2,
      title: 'Coupons',
      branchName: 'mission-task/referral/coupons',
      worktreeId: null,
      parentBaseSha: 'b',
      addedAt: 2
    }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

const hunks: MissionAbsorbHunk[] = [
  { file: 'src/a.ts', line: 3, candidateTaskIds: ['t1', 't2'] },
  { file: 'src/b.ts', line: 9, candidateTaskIds: ['t1', 't2'] }
]

let root: Root | null = null

function renderDialog(onResolved = vi.fn()) {
  root = createRoot(document.createElement('div'))
  act(() => {
    root?.render(
      <MissionAbsorbDialog
        mission={mission}
        repoId="r1"
        hunks={hunks}
        onResolved={onResolved}
        onOpenChange={() => {}}
      />
    )
  })
}

function getAbsorbButton(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Absorb'
  )
}

function chooseTask(hunkKey: string, taskId: string): void {
  const select = document.body
    .querySelector(`[aria-label="Task for ${hunkKey}"]`)
    ?.closest('[data-slot="select"]')
  act(() => select?.querySelector<HTMLElement>(`[data-value="${taskId}"]`)?.click())
}

describe('MissionAbsorbDialog', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
  })

  it('labels candidates by tracker key or title and waits for a choice per hunk', () => {
    renderDialog()
    const labels = [...document.body.querySelectorAll('[role="option"]')]
      .slice(0, 2)
      .map((option) => option.textContent)
    expect(labels).toEqual(['OMP-951', 'Coupons'])
    expect(getAbsorbButton()?.disabled).toBe(true)
    chooseTask('src/a.ts:3', 't1')
    expect(getAbsorbButton()?.disabled).toBe(true)
    chooseTask('src/b.ts:9', 't2')
    expect(getAbsorbButton()?.disabled).toBe(false)
  })

  it('re-runs absorb with overrides keyed by file and line', async () => {
    const result = { applied: 2, ambiguous: [] }
    const absorbMissionPreview = vi.fn().mockResolvedValue(result)
    act(() => useAppStore.setState({ absorbMissionPreview, missionSlotErrors: {} }))
    const onResolved = vi.fn()
    renderDialog(onResolved)
    chooseTask('src/a.ts:3', 't1')
    chooseTask('src/b.ts:9', 't2')

    await act(async () => getAbsorbButton()?.click())

    expect(absorbMissionPreview).toHaveBeenCalledWith('m1', 'r1', {
      'src/a.ts:3': 't1',
      'src/b.ts:9': 't2'
    })
    expect(onResolved).toHaveBeenCalledWith(result)
  })
})
