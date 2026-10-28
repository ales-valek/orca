import type {
  HulyComponent,
  HulyIssue,
  HulyMilestone,
  HulyProjectSummary,
  HulyStatus
} from '../../shared/huly/huly-types'
import type { HulyApi } from './huly-api'

// In-memory HulyApi for tests only; production code must use createHulyApi.
export class FakeHulyApi implements HulyApi {
  projects: HulyProjectSummary[] = [{ identifier: 'OMP', name: 'OrderMage' }]
  milestones: HulyMilestone[] = []
  issuesByMilestone = new Map<string, HulyIssue[]>()
  components: HulyComponent[] = []
  statuses: HulyStatus[] = [
    { name: 'Backlog', category: 'UnStarted' },
    { name: 'Todo', category: 'ToDo' },
    { name: 'In Progress', category: 'Active' },
    { name: 'Done', category: 'Won' },
    { name: 'Canceled', category: 'Lost' }
  ]
  statusWrites: { project: string; identifier: string; statusName: string }[] = []
  /** Every call rejects like the package does for a revoked or invalid token. */
  failWithAuth = false
  closed = false

  async listProjects(): Promise<HulyProjectSummary[]> {
    this.assertAuthorized()
    return this.projects
  }

  async listMilestones(_project: string) {
    this.assertAuthorized()
    return this.milestones.map(({ id, label, status }) => ({ id, label, status }))
  }

  async getMilestone(project: string, milestoneId: string): Promise<HulyMilestone> {
    this.assertAuthorized()
    const milestone = this.milestones.find((candidate) => candidate.id === milestoneId)
    if (!milestone) {
      throw new Error(`Huly milestone ${milestoneId} not found in ${project}`)
    }
    return milestone
  }

  async listMilestoneIssues(_project: string, milestoneId: string): Promise<HulyIssue[]> {
    this.assertAuthorized()
    return this.issuesByMilestone.get(milestoneId) ?? []
  }

  async listComponents(_project: string): Promise<HulyComponent[]> {
    this.assertAuthorized()
    return this.components
  }

  async listStatuses(_project: string): Promise<HulyStatus[]> {
    this.assertAuthorized()
    return this.statuses
  }

  async setIssueStatus(project: string, identifier: string, statusName: string): Promise<void> {
    this.assertAuthorized()
    this.statusWrites.push({ project, identifier, statusName })
  }

  async close(): Promise<void> {
    this.closed = true
  }

  private assertAuthorized(): void {
    if (this.failWithAuth) {
      throw new Error('ERROR: platform:status:Unauthorized {}')
    }
  }
}
