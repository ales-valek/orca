// @vitest-environment happy-dom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HulyMissionPlan } from '../../../../shared/huly/huly-mission-plan'
import { getHulyProjectSettings } from '../../../../shared/huly/huly-project-settings'
import type { HulyIssue } from '../../../../shared/huly/huly-types'

const mocks = vi.hoisted(() => {
  const getNoSettings = (): { hulyProjects: Record<string, unknown> } | null => null
  return {
    createMissionFromMilestone: vi.fn(),
    updateSettings: vi.fn(),
    closeModal: vi.fn(),
    setSidebarListMode: vi.fn(),
    getMilestonePlan: vi.fn(),
    toastWarning: vi.fn(),
    settings: getNoSettings()
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeModal: 'mission-create-huly',
      closeModal: mocks.closeModal,
      repos: [
        { id: 'r1', path: '/repos/eshop', displayName: 'Eshop' },
        { id: 'r2', path: '/repos/admin', displayName: 'Admin' }
      ],
      projectHostSetupProjection: { projects: [], setups: [] },
      settings: mocks.settings,
      updateSettings: mocks.updateSettings,
      createMissionFromMilestone: mocks.createMissionFromMilestone,
      setSidebarListMode: mocks.setSidebarListMode,
      detectedAgentIds: null
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
vi.mock('@/components/ui/select', () => import('@/components/ui/select-test-double'))
vi.mock('@/components/agent/AgentCombobox', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { warning: mocks.toastWarning, success: vi.fn() } }))

import MissionFromHulyDialog from './MissionFromHulyDialog'

function issue(identifier: string, componentId: string | null = 'c-eshop'): HulyIssue {
  return {
    id: `id-${identifier}`,
    identifier,
    number: Number(identifier.split('-')[1]),
    title: `Title ${identifier}`,
    url: `https://huly.test/${identifier}`,
    status: { name: 'Todo', category: 'ToDo' },
    componentId,
    blockedBy: [],
    parentIssueId: null
  }
}

function plan(overrides: Partial<HulyMissionPlan>): HulyMissionPlan {
  return {
    stacks: [],
    unmapped: [],
    skipped: [],
    cycles: [],
    crossRepoDependencies: [],
    ...overrides
  }
}

function stack(repoId: string, identifiers: string[]): HulyMissionPlan['stacks'][number] {
  return { repoId, tasks: identifiers.map((id) => ({ issue: issue(id), repoId })) }
}

const MILESTONE = {
  id: 'm1',
  label: 'Referral',
  status: 'InProgress',
  descriptionMarkdown: '',
  url: 'https://huly.test/m1'
}

let root: Root | null = null

async function renderWithMilestone(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MissionFromHulyDialog />)
  })
  await act(async () => {
    pickOption(container, 'Huly milestone', 'm1')
  })
  return container
}

function pickOption(container: HTMLElement, triggerLabel: string, value: string): void {
  const trigger = container.querySelector(`[aria-label="${triggerLabel}"]`)
  const option = trigger
    ?.closest('[data-slot="select"]')
    ?.querySelector<HTMLButtonElement>(`[role="option"][data-value="${value}"]`)
  if (!option) {
    throw new Error(`No option ${value} for ${triggerLabel}`)
  }
  option.click()
}

function getCreateButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Create Mission'
  )
  if (!button) {
    throw new Error('Create button not rendered')
  }
  return button
}

async function submit(container: HTMLElement): Promise<void> {
  await act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('MissionFromHulyDialog', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    mocks.createMissionFromMilestone.mockReset()
    mocks.createMissionFromMilestone.mockResolvedValue({
      mission: { id: 'mission-1' },
      warnings: []
    })
    mocks.updateSettings.mockReset()
    mocks.updateSettings.mockResolvedValue(undefined)
    mocks.closeModal.mockReset()
    mocks.toastWarning.mockReset()
    mocks.getMilestonePlan.mockReset()
    mocks.settings = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        huly: {
          listProjects: vi.fn().mockResolvedValue([{ identifier: 'OMP', name: 'OrderMage' }]),
          listMilestones: vi
            .fn()
            .mockResolvedValue([{ id: 'm1', label: 'Referral', status: 'InProgress' }]),
          getMilestonePlan: mocks.getMilestonePlan
        }
      }
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('keeps Create disabled until an unmapped issue gets a repository', async () => {
    mocks.getMilestonePlan.mockImplementation(async (args: { repoOverrides?: object }) => ({
      milestone: MILESTONE,
      plan: args.repoOverrides
        ? plan({ stacks: [stack('r1', ['OMP-1']), stack('r2', ['OMP-5'])] })
        : plan({ stacks: [stack('r1', ['OMP-1'])], unmapped: [issue('OMP-5', 'c-admin')] })
    }))
    const container = await renderWithMilestone()

    expect(container.textContent).toContain('OMP-5')
    expect(getCreateButton(container).disabled).toBe(true)

    await act(async () => {
      pickOption(container, 'Repository for OMP-5', 'r2')
    })

    expect(mocks.getMilestonePlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ repoOverrides: { 'OMP-5': 'r2' } })
    )
    expect(getCreateButton(container).disabled).toBe(false)
  })

  it('blocks Create and lists the identifiers of a dependency cycle', async () => {
    mocks.getMilestonePlan.mockResolvedValue({
      milestone: MILESTONE,
      plan: plan({
        stacks: [stack('r2', ['OMP-9'])],
        cycles: [{ repoId: 'r1', identifiers: ['OMP-2', 'OMP-3'] }]
      })
    })
    const container = await renderWithMilestone()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('OMP-2')
    expect(alert?.textContent).toContain('OMP-3')
    expect(getCreateButton(container).disabled).toBe(true)
  })

  it('sends the reordered stack as orderOverrides and toasts create warnings', async () => {
    mocks.getMilestonePlan.mockResolvedValue({
      milestone: MILESTONE,
      plan: plan({ stacks: [stack('r1', ['OMP-1', 'OMP-2'])] })
    })
    mocks.createMissionFromMilestone.mockResolvedValue({
      mission: { id: 'mission-1' },
      warnings: ['r1: OMP-2: branch exists']
    })
    const container = await renderWithMilestone()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Move OMP-2 up"]')?.click()
    })
    await submit(container)

    expect(mocks.createMissionFromMilestone).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'OMP',
        milestone: 'm1',
        name: 'Referral',
        branch: 'mission/referral',
        orderOverrides: { r1: ['OMP-2', 'OMP-1'] }
      })
    )
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: 'r1: OMP-2: branch exists' })
    )
    expect(mocks.closeModal).toHaveBeenCalled()
  })

  it('remembers a picked repository for the component in the full project map', async () => {
    const other = getHulyProjectSettings({ hulyProjects: {} }, 'OTHER')
    const omp = {
      ...getHulyProjectSettings({ hulyProjects: {} }, 'OMP'),
      componentRepoMap: { 'c-eshop': 'r1' }
    }
    mocks.settings = { hulyProjects: { OTHER: other, OMP: omp } }
    mocks.getMilestonePlan.mockImplementation(async (args: { repoOverrides?: object }) => ({
      milestone: MILESTONE,
      plan: args.repoOverrides
        ? plan({ stacks: [stack('r1', ['OMP-1']), stack('r2', ['OMP-5'])] })
        : plan({ stacks: [stack('r1', ['OMP-1'])], unmapped: [issue('OMP-5', 'c-admin')] })
    }))
    const container = await renderWithMilestone()

    await act(async () => {
      pickOption(container, 'Repository for OMP-5', 'r2')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click()
    })
    await submit(container)

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      hulyProjects: {
        OTHER: other,
        OMP: { ...omp, componentRepoMap: { 'c-eshop': 'r1', 'c-admin': 'r2' } }
      }
    })
    expect(mocks.createMissionFromMilestone).toHaveBeenCalledWith(
      expect.objectContaining({ repoOverrides: { 'OMP-5': 'r2' } })
    )
  })
})
