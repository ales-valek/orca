// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MissionRestackLayer } from '../../../../shared/mission-layer-state'
import type { Mission } from '../../../../shared/mission-types'

vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/testing/app-store-test-fixture')
  return { useAppStore: createTestStore() }
})
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => vi.fn().mockResolvedValue(true)
}))

import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MissionStackRows } from './MissionStackRows'

const repo = { ...TEST_REPO, displayName: 'eshop' }

function makeLayerWorktree(name: string, branch: string) {
  return makeWorktree({
    id: `${repo.id}::/tmp/referral/${name}`,
    repoId: repo.id,
    instanceId: `${name}-instance`,
    branch: `refs/heads/${branch}`
  })
}

const memberWorktree = makeLayerWorktree('eshop', 'mission/referral')
const firstTaskWorktree = makeLayerWorktree('omp-951', 'mission-task/referral/omp-951')
const secondTaskWorktree = makeLayerWorktree('omp-953', 'mission-task/referral/omp-953')
const previewWorktree = makeLayerWorktree('preview', 'mission-preview/referral')

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [
    {
      repoId: repo.id,
      worktreeId: memberWorktree.id,
      worktreeInstanceId: 'eshop-instance',
      addedAt: 1
    }
  ],
  tasks: [
    {
      id: 't2',
      repoId: repo.id,
      order: 2,
      title: 'Coupons',
      branchName: 'mission-task/referral/omp-953',
      worktreeId: secondTaskWorktree.id,
      worktreeInstanceId: 'omp-953-instance',
      parentBaseSha: 'b',
      externalRef: 'OMP-953',
      addedAt: 2
    },
    {
      id: 't1',
      repoId: repo.id,
      order: 1,
      title: 'Checkout',
      branchName: 'mission-task/referral/omp-951',
      worktreeId: firstTaskWorktree.id,
      worktreeInstanceId: 'omp-951-instance',
      parentBaseSha: 'a',
      externalRef: 'OMP-951',
      addedAt: 1
    }
  ],
  previews: [
    {
      repoId: repo.id,
      worktreeId: previewWorktree.id,
      worktreeInstanceId: 'preview-instance'
    }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

let root: Root | null = null

function renderStack(
  layers: MissionRestackLayer[] = [],
  worktrees = [memberWorktree, firstTaskWorktree, secondTaskWorktree, previewWorktree]
): HTMLDivElement {
  act(() => {
    useAppStore.setState({
      repos: [repo],
      worktreesByRepo: { [repo.id]: worktrees },
      missions: [mission],
      missionStackReports: { m1: [{ repoId: repo.id, layers }] },
      missionSlotErrors: {}
    })
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <TooltipProvider>
        <MissionStackRows
          mission={mission}
          repoId={repo.id}
          repoName={repo.displayName}
          renderMember={(stateBadge) => <div>{stateBadge}</div>}
        />
      </TooltipProvider>
    )
  })
  return container
}

function getLayer(container: HTMLElement, slot: string): HTMLElement | null {
  return container.querySelector(`[data-mission-slot="${slot}"]`)
}

describe('MissionStackRows', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('renders the layers bottom-up from the member to the preview', () => {
    const container = renderStack()
    const titles = [...container.querySelectorAll('[data-mission-layer-title]')].map((element) =>
      element.getAttribute('data-mission-layer-title')
    )
    expect(titles).toEqual(['eshop', 'OMP-951 Checkout', 'OMP-953 Coupons', 'Preview'])
  })

  it('shows the Blocked badge on a blocked layer', () => {
    const container = renderStack([
      { slot: 'member', state: 'current' },
      { slot: 'task:t1', state: 'current' },
      { slot: 'task:t2', state: 'blocked', reason: 'Uncommitted changes' }
    ])
    expect(getLayer(container, 'task:t2')?.textContent).toContain('Blocked')
    expect(getLayer(container, 'task:t1')?.textContent).toContain('Current')
    expect(getLayer(container, 'task:t1')?.textContent).not.toContain('Blocked')
  })

  it('enables Remove only on the top task', () => {
    const container = renderStack()
    const removeButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Remove task"]')
    ]
    expect(removeButtons).toHaveLength(1)
    expect(removeButtons[0].disabled).toBe(false)
    expect(removeButtons[0].closest('[data-mission-slot]')?.getAttribute('data-mission-slot')).toBe(
      'task:t2'
    )
  })

  it('offers Recreate on a layer whose workspace is missing', () => {
    const recreate = vi.fn(async () => {})
    useAppStore.setState({ recreateMissionSlotWorktree: recreate })
    const container = renderStack([], [memberWorktree, firstTaskWorktree, secondTaskWorktree])
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Recreate"]')
    ]
    expect(
      buttons.map((button) =>
        button.closest('[data-mission-slot]')?.getAttribute('data-mission-slot')
      )
    ).toEqual(['preview'])

    act(() => buttons[0].click())

    expect(recreate).toHaveBeenCalledWith('m1', repo.id, 'preview')
  })

  it('offers Push rewritten layers only when a layer needs a push', () => {
    const current = renderStack([{ slot: 'task:t1', state: 'current' }])
    expect(current.textContent).not.toContain('Push rewritten layers')
    act(() => root?.unmount())
    root = null

    const rewritten = renderStack([{ slot: 'task:t1', state: 'needs-push' }])
    expect(rewritten.textContent).toContain('Push rewritten layers')
  })
})
