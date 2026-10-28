import { defineFixture } from '../../component-fixtures/component-fixture'
import { useAppStore } from '../../store'
import { getHulyProjectSettings } from '../../../../shared/huly/huly-project-settings'
import type { HulyConnectionStatus } from '../../../../shared/huly/huly-types'
import type { Repo } from '../../../../shared/repo-types'
import { HulyConnectDialog } from '../huly-connect-dialog'
import { HulyIntegrationCard } from './huly-integration-card'

const CONNECTED: HulyConnectionStatus = {
  connected: true,
  info: { serverUrl: 'https://huly.example.com', workspace: 'ordermage' }
}

const repos: Repo[] = ['eshop', 'admin', 'api'].map((name) => ({
  id: `repo-${name}`,
  path: `/repos/${name}`,
  displayName: name,
  badgeColor: '#737373',
  addedAt: 0
}))

function installHulyApi(status: HulyConnectionStatus, authExpired = false): void {
  window.api.huly = {
    ...window.api.huly,
    status: async () => status,
    listProjects: async () => {
      if (authExpired) {
        throw new Error('huly_auth_required')
      }
      return [{ identifier: 'OMP', name: 'OrderMage' }]
    },
    listStatuses: async () => [
      { name: 'Backlog', category: 'UnStarted' },
      { name: 'In Progress', category: 'Active' },
      { name: 'CODE REVIEW', category: 'Active' },
      { name: 'TESTOVÁNÍ', category: 'Active' },
      { name: 'MERGED IN MILESTONE', category: 'Won' },
      { name: 'Done', category: 'Won' }
    ],
    listComponents: async () => [
      { id: 'c-eshop', label: 'Eshop' },
      { id: 'c-admin', label: 'Admin' },
      { id: 'c-docs', label: 'Docs' }
    ]
  }
}

export const disconnected = defineFixture({
  width: 640,
  setup: () => installHulyApi({ connected: false }),
  render: () => <HulyIntegrationCard />
})

export const connected = defineFixture({
  width: 640,
  store: { repos },
  setup: () => {
    installHulyApi(CONNECTED)
    const { settings } = useAppStore.getState()
    if (settings) {
      useAppStore.setState({
        settings: {
          ...settings,
          hulyProjects: {
            OMP: {
              ...getHulyProjectSettings({}, 'OMP'),
              componentRepoMap: { 'c-eshop': 'repo-eshop', 'c-admin': 'repo-admin' },
              statusWriteBack: true
            }
          }
        }
      })
    }
  },
  render: () => <HulyIntegrationCard />
})

export const reconnect = defineFixture({
  width: 640,
  setup: () => installHulyApi(CONNECTED, true),
  render: () => <HulyIntegrationCard />
})

export const reconnectDialog = defineFixture({
  width: 640,
  render: () => (
    <HulyConnectDialog
      open
      onOpenChange={() => {}}
      onConnected={() => {}}
      initialInfo={CONNECTED.connected ? CONNECTED.info : null}
    />
  )
})
