// @vitest-environment happy-dom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HulyMissionRefreshDiff } from '../../../../shared/huly/huly-mission-refresh'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import type { Mission } from '../../../../shared/mission-types'

const mocks = vi.hoisted(() => ({
  refreshMissionFromHuly: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      refreshMissionFromHuly: mocks.refreshMissionFromHuly,
      repos: [{ id: 'r1', path: '/repos/eshop', displayName: 'Eshop' }]
    })
}))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, warning: mocks.toastWarning }
}))

import { MissionHulyRefreshDialog } from './MissionHulyRefreshDialog'

const MISSION: Mission = {
  id: 'mission-1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

function issue(identifier: string): HulyIssue {
  return {
    id: identifier,
    identifier,
    number: 1,
    title: `Title ${identifier}`,
    url: '',
    status: { name: 'Todo', category: 'ToDo' },
    componentId: null,
    blockedBy: [],
    parentIssueId: null
  }
}

function diff(overrides: Partial<HulyMissionRefreshDiff>): HulyMissionRefreshDiff {
  return {
    appendable: [],
    reorderedInHuly: [],
    removed: [],
    movedRepo: [],
    nonAppendable: [],
    ...overrides
  }
}

function result(refreshDiff: HulyMissionRefreshDiff, applied: string[] = []) {
  return { mission: { id: 'mission-1' }, diff: refreshDiff, applied, warnings: [] }
}

let root: Root | null = null

async function renderDialog(onOpenChange = vi.fn()): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MissionHulyRefreshDialog mission={MISSION} onOpenChange={onOpenChange} />)
  })
  return container
}

function getButtonLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')].map((button) => button.textContent ?? '')
}

describe('MissionHulyRefreshDialog', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    mocks.refreshMissionFromHuly.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastWarning.mockReset()
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('offers only Append for new tasks; the other groups are information', async () => {
    mocks.refreshMissionFromHuly.mockResolvedValueOnce(
      result(
        diff({
          appendable: [{ repoId: 'r1', issues: [issue('OMP-7'), issue('OMP-8')] }],
          removed: ['OMP-1'],
          completed: ['OMP-4'],
          reorderedInHuly: [
            { repoId: 'r1', before: ['OMP-2', 'OMP-3'], after: ['OMP-3', 'OMP-2'] }
          ],
          nonAppendable: [{ repoId: 'r1', identifier: 'OMP-9', reason: 'inserted-in-middle' }]
        })
      )
    )
    mocks.refreshMissionFromHuly.mockResolvedValueOnce(result(diff({}), ['OMP-7', 'OMP-8']))
    const onOpenChange = vi.fn()
    const container = await renderDialog(onOpenChange)

    expect(mocks.refreshMissionFromHuly).toHaveBeenCalledWith('mission-1', false)
    expect(getButtonLabels(container)).toEqual(['Close', 'Append 2 new tasks'])
    expect(container.textContent).toContain('Huly orders it below existing tasks')
    expect(container.textContent).toContain(
      'Completed in HulyTheir task layers stay in the Mission.OMP-4'
    )

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Append 2 new tasks')
        ?.click()
    })

    expect(mocks.refreshMissionFromHuly).toHaveBeenLastCalledWith('mission-1', true)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Appended 2 new tasks')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hides Append when nothing can be appended', async () => {
    mocks.refreshMissionFromHuly.mockResolvedValue(
      result(diff({ nonAppendable: [{ repoId: null, identifier: 'OMP-9', reason: 'unmapped' }] }))
    )
    const container = await renderDialog()

    expect(getButtonLabels(container)).toEqual(['Close'])
    expect(container.textContent).toContain('Its component has no repository.')
  })

  it('warns instead of reporting zero appended tasks', async () => {
    mocks.refreshMissionFromHuly
      .mockResolvedValueOnce(
        result(diff({ appendable: [{ repoId: 'r1', issues: [issue('OMP-7')] }] }))
      )
      .mockResolvedValueOnce(result(diff({}), []))
    const container = await renderDialog()

    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Append 1 new task')
        ?.click()
    })

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastWarning).toHaveBeenCalledWith('No new tasks were appended.', undefined)
  })
})
