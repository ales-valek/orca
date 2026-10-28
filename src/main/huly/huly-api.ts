import type { PlatformClient } from '@hcengineering/api-client'
import type {
  HulyComponent,
  HulyConnectionInfo,
  HulyIssue,
  HulyMilestone,
  HulyMilestoneSummary,
  HulyProjectSummary,
  HulyStatus
} from '../../shared/huly/huly-types'
import {
  HULY_CLASS,
  HULY_NO_PARENT,
  componentDocSchema,
  getHulyStatusCategory,
  getMilestoneStatusName,
  issueDocSchema,
  milestoneDocSchema,
  parseHulyDocs,
  projectDocSchema,
  projectTypeDocSchema,
  statusDocSchema
} from './huly-tracker-docs'

export type HulyApi = {
  listProjects(): Promise<HulyProjectSummary[]>
  listMilestones(project: string): Promise<HulyMilestoneSummary[]>
  getMilestone(project: string, milestoneId: string): Promise<HulyMilestone>
  listMilestoneIssues(project: string, milestoneId: string): Promise<HulyIssue[]>
  listComponents(project: string): Promise<HulyComponent[]>
  listStatuses(project: string): Promise<HulyStatus[]>
  setIssueStatus(project: string, identifier: string, statusName: string): Promise<void>
  close(): Promise<void>
}

const CONNECTION_TIMEOUT_MS = 30_000
// PlatformError messages embed the status code (`ERROR: platform:status:Unauthorized {}`).
const AUTH_STATUS_CODES = [
  'platform:status:Unauthorized',
  'platform:status:TokenExpired',
  'platform:status:TokenNotActive'
]

export function isHulyAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return AUTH_STATUS_CODES.some((code) => message.includes(code))
}

export async function createHulyApi(info: HulyConnectionInfo, token: string): Promise<HulyApi> {
  // Loaded on first use: the client pulls a large dependency tree into main.
  const { connect } = await import('@hcengineering/api-client')
  const client = await connect(info.serverUrl, {
    token,
    workspace: info.workspace,
    connectionTimeout: CONNECTION_TIMEOUT_MS
  })
  return createHulyApiOverClient(client, info)
}

type StatusRecord = HulyStatus & { id: string }

function createHulyApiOverClient(client: PlatformClient, info: HulyConnectionInfo): HulyApi {
  const trackerUrl = `${info.serverUrl.replace(/\/+$/, '')}/workbench/${encodeURIComponent(info.workspace)}/tracker`

  async function getProject(identifier: string) {
    const doc = await client.findOne(HULY_CLASS.project, { identifier })
    if (doc === undefined) {
      throw new Error(`Huly project ${identifier} not found`)
    }
    return projectDocSchema.parse(doc)
  }

  async function findStatuses(ids: string[]): Promise<StatusRecord[]> {
    const docs = parseHulyDocs(
      statusDocSchema,
      await client.findAll(HULY_CLASS.issueStatus, { _id: { $in: ids } })
    )
    const byId = new Map(docs.map((doc) => [doc._id, doc]))
    return ids.flatMap((id) => {
      const doc = byId.get(id)
      const category = getHulyStatusCategory(doc?.category)
      return doc && category ? [{ id, name: doc.name, category }] : []
    })
  }

  async function getProjectStatuses(project: { type?: string }): Promise<StatusRecord[]> {
    const projectType = projectTypeDocSchema.parse(
      await client.findOne(HULY_CLASS.projectType, { _id: project.type })
    )
    return findStatuses([...new Set(projectType.statuses.map((status) => status._id))])
  }

  async function getMarkdown(milestoneId: string, description: string): Promise<string> {
    if (description.trim() === '') {
      return ''
    }
    if (!description.trimStart().startsWith('{')) {
      // A non-JSON value is a collaborative blob ref rather than inline ProseMirror markup.
      return client.fetchMarkup(
        HULY_CLASS.milestone,
        milestoneId,
        'description',
        description,
        'markdown'
      )
    }
    const [{ markupToJSON }, { markupToMarkdown }] = await Promise.all([
      import('@hcengineering/text-core'),
      import('@hcengineering/text-markdown')
    ])
    return markupToMarkdown(markupToJSON(description))
  }

  async function findIdentifiers(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map()
    }
    const docs = parseHulyDocs(
      issueDocSchema.pick({ _id: true, identifier: true }),
      await client.findAll(HULY_CLASS.issue, { _id: { $in: ids } })
    )
    return new Map(docs.map((doc) => [doc._id, doc.identifier]))
  }

  return {
    async listProjects() {
      const docs = parseHulyDocs(projectDocSchema, await client.findAll(HULY_CLASS.project, {}))
      return docs
        .filter((doc) => doc.archived !== true)
        .map((doc) => ({ identifier: doc.identifier, name: doc.name }))
    },

    async listMilestones(project) {
      const { _id: space } = await getProject(project)
      const docs = parseHulyDocs(
        milestoneDocSchema,
        await client.findAll(HULY_CLASS.milestone, { space }, { sort: { targetDate: 1 } })
      )
      return docs.map((doc) => ({
        id: doc._id,
        label: doc.label,
        status: getMilestoneStatusName(doc.status)
      }))
    },

    async getMilestone(project, milestoneId) {
      const { _id: space } = await getProject(project)
      const raw = await client.findOne(HULY_CLASS.milestone, { _id: milestoneId, space })
      if (raw === undefined) {
        throw new Error(`Huly milestone ${milestoneId} not found in ${project}`)
      }
      const doc = milestoneDocSchema.parse(raw)
      return {
        id: doc._id,
        label: doc.label,
        status: getMilestoneStatusName(doc.status),
        descriptionMarkdown: await getMarkdown(doc._id, doc.description ?? ''),
        url: `${trackerUrl}/${encodeURIComponent(space)}/milestones`
      }
    },

    async listMilestoneIssues(project, milestoneId) {
      const { _id: space } = await getProject(project)
      const docs = parseHulyDocs(
        issueDocSchema,
        await client.findAll(HULY_CLASS.issue, { space, milestone: milestoneId })
      )
      const statuses = await findStatuses([...new Set(docs.map((doc) => doc.status))])
      const statusById = new Map(statuses.map((status) => [status.id, status]))
      const identifierById = new Map(docs.map((doc) => [doc._id, doc.identifier]))
      const outsideBlockers = docs
        .flatMap((doc) => doc.blockedBy ?? [])
        .map((blocker) => blocker._id)
        .filter((id) => !identifierById.has(id))
      for (const [id, identifier] of await findIdentifiers([...new Set(outsideBlockers)])) {
        identifierById.set(id, identifier)
      }
      return docs.map((doc) => {
        const status = statusById.get(doc.status)
        if (!status) {
          throw new Error(`Huly issue ${doc.identifier} has an unknown status ${doc.status}`)
        }
        return {
          id: doc._id,
          identifier: doc.identifier,
          number: doc.number,
          title: doc.title,
          url: `${trackerUrl}/${encodeURIComponent(doc.identifier)}`,
          status: { name: status.name, category: status.category },
          componentId: doc.component ?? null,
          blockedBy: (doc.blockedBy ?? []).flatMap((blocker) => {
            const identifier = identifierById.get(blocker._id)
            return identifier ? [identifier] : []
          }),
          parentIssueId: doc.attachedTo && doc.attachedTo !== HULY_NO_PARENT ? doc.attachedTo : null
        }
      })
    },

    async listComponents(project) {
      const { _id: space } = await getProject(project)
      const docs = parseHulyDocs(
        componentDocSchema,
        await client.findAll(HULY_CLASS.component, { space })
      )
      return docs.map((doc) => ({ id: doc._id, label: doc.label }))
    },

    async listStatuses(project) {
      const statuses = await getProjectStatuses(await getProject(project))
      return statuses.map(({ name, category }) => ({ name, category }))
    },

    async setIssueStatus(project, identifier, statusName) {
      const projectDoc = await getProject(project)
      const raw = await client.findOne(HULY_CLASS.issue, { space: projectDoc._id, identifier })
      if (raw === undefined) {
        throw new Error(`Huly issue ${identifier} not found in ${project}`)
      }
      const issue = issueDocSchema.parse(raw)
      // Huly treats status names as case-insensitive.
      const wanted = statusName.toLocaleLowerCase()
      const status = (await getProjectStatuses(projectDoc)).find(
        (candidate) => candidate.name.toLocaleLowerCase() === wanted
      )
      if (!status) {
        throw new Error(`Huly status ${statusName} not found in ${project}`)
      }
      if (issue.status !== status.id) {
        await client.updateDoc(issue._class, issue.space, issue._id, { status: status.id })
      }
    },

    close: () => client.close()
  }
}
