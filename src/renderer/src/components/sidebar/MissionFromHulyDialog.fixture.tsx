import { defineFixture } from '../../component-fixtures/component-fixture'
import type { HulyMissionPlan } from '../../../../shared/huly/huly-mission-plan'
import type { HulyIssue, HulyStatus } from '../../../../shared/huly/huly-types'
import type { Repo } from '../../../../shared/repo-types'
import MissionFromHulyDialog from './MissionFromHulyDialog'

const repos: Repo[] = ['eshop', 'admin', 'api', 'orchestrator'].map((name) => ({
  id: `repo-${name}`,
  path: `/repos/${name}`,
  displayName: name,
  badgeColor: '#737373',
  addedAt: 0
}))

const TODO: HulyStatus = { name: 'Todo', category: 'ToDo' }
const MERGED: HulyStatus = { name: 'MERGED IN MILESTONE', category: 'Won' }

function issue(
  number: number,
  title: string,
  componentId: string | null,
  status: HulyStatus = TODO
): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title,
    url: `https://huly.example.com/OMP-${number}`,
    status,
    componentId,
    blockedBy: [],
    parentIssueId: null
  }
}

function planned(repoId: string, issues: HulyIssue[]): HulyMissionPlan['stacks'][number] {
  return { repoId, tasks: issues.map((entry) => ({ issue: entry, repoId })) }
}

const PLAN: HulyMissionPlan = {
  stacks: [
    planned('repo-admin', [issue(951, 'Referral settings page', 'c-admin')]),
    planned('repo-eshop', [
      issue(948, 'Referral code in checkout', 'c-eshop'),
      issue(953, 'Referral reward summary', 'c-eshop', { name: 'In Progress', category: 'Active' }),
      issue(960, 'Referral coupons email', 'c-eshop')
    ])
  ],
  unmapped: [issue(962, 'Track referral conversions', 'c-analytics')],
  skipped: [issue(940, 'Referral data model', 'c-api', MERGED)],
  cycles: [{ repoId: 'repo-api', identifiers: ['OMP-955', 'OMP-956'] }],
  crossRepoDependencies: []
}

function installHulyApi(): void {
  window.api.huly = {
    ...window.api.huly,
    listProjects: async () => [{ identifier: 'OMP', name: 'OrderMage' }],
    listMilestones: async () => [{ id: 'm-referral', label: 'Referral program', status: 'Active' }],
    getMilestonePlan: async () => ({
      milestone: {
        id: 'm-referral',
        label: 'Referral program',
        status: 'Active',
        descriptionMarkdown: '',
        url: 'https://huly.example.com/m-referral'
      },
      plan: PLAN
    })
  }
}

async function waitFor<T>(find: () => T | null, what: string): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = find()
    if (found) {
      return found
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Fixture element did not appear: ${what}`)
}

export const plan = defineFixture({
  width: 720,
  store: { repos, activeModal: 'mission-create-huly' },
  setup: installHulyApi,
  interact: async () => {
    const trigger = await waitFor(
      () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Huly milestone"]:not([disabled])'),
      'milestone select'
    )
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const option = await waitFor(
      () => document.querySelector<HTMLElement>('[role="option"]'),
      'option'
    )
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => document.querySelector('[aria-label="Move OMP-953 up"]'), 'plan')
  },
  render: () => <MissionFromHulyDialog />
})

export const reconnect = defineFixture({
  width: 720,
  store: { repos, activeModal: 'mission-create-huly' },
  setup: () => {
    installHulyApi()
    window.api.huly.listProjects = async () => {
      throw new Error('huly_auth_required')
    }
  },
  interact: async () => {
    await waitFor(() => document.querySelector('[role="alert"]'), 'reconnect notice')
  },
  render: () => <MissionFromHulyDialog />
})
