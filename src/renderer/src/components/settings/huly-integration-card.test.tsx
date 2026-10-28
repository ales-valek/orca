// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getHulyProjectSettings,
  type HulyProjectSettings
} from '../../../../shared/huly/huly-project-settings'
import type {
  HulyComponent,
  HulyConnectionStatus,
  HulyProjectSummary,
  HulyStatus
} from '../../../../shared/huly/huly-types'
import type { Repo } from '../../../../shared/repo-types'
import { HulyIntegrationCard } from './huly-integration-card'

const mocks = vi.hoisted(() => {
  const hulyProjects: Record<string, HulyProjectSettings> = {}
  const repos: Repo[] = []
  return {
    state: {
      settings: { hulyProjects, localWindowsRuntimeDefault: undefined },
      repos,
      endpointProjects: [],
      endpointProjectHostSetups: [],
      updateSettings: vi.fn(
        async (_updates: { hulyProjects?: Record<string, HulyProjectSettings> }) => {}
      )
    }
  }
})

vi.mock('@/components/ui/select', () => import('@/components/ui/select-test-double'))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

const huly = {
  status: vi.fn<() => Promise<HulyConnectionStatus>>(),
  connect: vi.fn(),
  disconnect: vi.fn(async () => ({ ok: true as const })),
  listProjects: vi.fn(async (): Promise<HulyProjectSummary[]> => []),
  listStatuses: vi.fn(async (): Promise<HulyStatus[]> => []),
  listComponents: vi.fn(async (): Promise<HulyComponent[]> => [])
}

const CONNECTED: HulyConnectionStatus = {
  connected: true,
  info: { serverUrl: 'https://huly.example.com', workspace: 'ordermage' }
}

beforeEach(() => {
  for (const mock of Object.values(huly)) {
    mock.mockClear()
  }
  huly.status.mockResolvedValue({ connected: false })
  huly.connect.mockResolvedValue(CONNECTED)
  huly.listProjects.mockResolvedValue([])
  mocks.state.settings.hulyProjects = {}
  mocks.state.repos = []
  mocks.state.updateSettings.mockClear()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the card only calls the Huly namespace, which this fake implements.
  window.api = { huly } as unknown as typeof window.api
})
afterEach(cleanup)

describe('HulyIntegrationCard', () => {
  it('offers to connect while disconnected', async () => {
    render(<HulyIntegrationCard />)

    expect(await screen.findByRole('button', { name: 'Connect Huly' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('names the connected workspace and offers to disconnect', async () => {
    huly.status.mockResolvedValue(CONNECTED)
    render(<HulyIntegrationCard />)

    expect(await screen.findByText('Connected to ordermage')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(huly.disconnect).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Connect Huly' })).toBeTruthy()
  })

  it('submits the server URL, workspace and token from the connect dialog', async () => {
    render(<HulyIntegrationCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Huly' }))

    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://huly.example.com' }
    })
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ordermage' } })
    const token = screen.getByLabelText('Token')
    expect(token.getAttribute('type')).toBe('password')
    fireEvent.change(token, { target: { value: 'secret-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() =>
      expect(huly.connect).toHaveBeenCalledWith({
        serverUrl: 'https://huly.example.com',
        workspace: 'ordermage',
        token: 'secret-token'
      })
    )
    expect(await screen.findByText('Connected to ordermage')).toBeTruthy()
  })

  it('asks to reconnect when Huly rejects the saved token', async () => {
    huly.status.mockResolvedValue(CONNECTED)
    huly.listProjects.mockRejectedValue(
      new Error("Error invoking remote method 'huly:listProjects': Error: huly_auth_required")
    )
    render(<HulyIntegrationCard />)

    expect(
      await screen.findByText('Huly rejected the saved token. Reconnect with a new token.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(screen.getByLabelText('Workspace')).toHaveProperty('value', 'ordermage')
    expect(screen.getByLabelText('Token')).toHaveProperty('value', '')
  })

  it('saves a project edit together with the other configured projects', async () => {
    const other = { ...getHulyProjectSettings({}, 'OTHER'), skipStatusNames: ['Archived'] }
    mocks.state.settings.hulyProjects = { OTHER: other }
    huly.status.mockResolvedValue(CONNECTED)
    huly.listProjects.mockResolvedValue([{ identifier: 'OMP', name: 'OrderMage' }])
    render(<HulyIntegrationCard />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Write task status back to Huly' }))

    expect(mocks.state.updateSettings).toHaveBeenCalledWith({
      hulyProjects: {
        OTHER: other,
        OMP: { ...getHulyProjectSettings({}, 'OMP'), statusWriteBack: true }
      }
    })
  })

  describe('project settings editors', () => {
    const omp = (): HulyProjectSettings => ({
      ...getHulyProjectSettings({}, 'OMP'),
      statusWriteBack: true
    })

    beforeEach(() => {
      mocks.state.settings.hulyProjects = { OMP: omp() }
      mocks.state.repos = [
        { id: 'repo-eshop', path: '/repos/eshop', displayName: 'eshop', badgeColor: '', addedAt: 0 }
      ]
      huly.status.mockResolvedValue(CONNECTED)
      huly.listProjects.mockResolvedValue([{ identifier: 'OMP', name: 'OrderMage' }])
      huly.listStatuses.mockResolvedValue([
        { name: 'Backlog', category: 'UnStarted' },
        { name: 'In Progress', category: 'Active' }
      ])
      huly.listComponents.mockResolvedValue([{ id: 'c-eshop', label: 'Eshop' }])
    })

    async function pickOption(selectLabel: string, option: string): Promise<void> {
      const trigger = await screen.findByRole('combobox', { name: selectLabel })
      const select = trigger.closest('[data-slot="select"]')
      if (!(select instanceof HTMLElement)) {
        throw new Error(`No select around ${selectLabel}`)
      }
      fireEvent.click(within(select).getByRole('option', { name: option }))
    }

    function getSavedOmp(): HulyProjectSettings | undefined {
      const [updates] = mocks.state.updateSettings.mock.lastCall ?? []
      return updates?.hulyProjects?.OMP
    }

    it('saves "Don\'t change" as a null target', async () => {
      render(<HulyIntegrationCard />)

      await pickOption('Status after: Task layer created', "Don't change")

      expect(getSavedOmp()?.statusRules['layer-created']).toEqual({
        ...omp().statusRules['layer-created'],
        target: null
      })
    })

    it('adds a status to a rule from-set', async () => {
      render(<HulyIntegrationCard />)

      fireEvent.click(
        await screen.findByRole('combobox', {
          name: 'Statuses to move from: Stacked pull request created'
        })
      )
      const options = await screen.findAllByRole('option', { name: 'Backlog' })
      const popoverOption = options.find((option) => !option.closest('[data-slot="select"]'))
      if (!popoverOption) {
        throw new Error('The from-set popover did not open')
      }
      fireEvent.click(popoverOption)

      expect(getSavedOmp()?.statusRules['stack-pr-created'].fromStatusNames).toEqual([
        'In Progress',
        'Rozpracováno',
        'Backlog'
      ])
    })

    it('maps a component to a repository', async () => {
      render(<HulyIntegrationCard />)

      await pickOption('Repository for Eshop', 'eshop')

      expect(getSavedOmp()?.componentRepoMap).toEqual({ 'c-eshop': 'repo-eshop' })
    })
  })
})
