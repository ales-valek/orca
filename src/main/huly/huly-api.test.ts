import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHulyApi, isHulyAuthError } from './huly-api'

type Doc = Record<string, unknown> & { _id: string; _class: string }

const docs: Doc[] = []
const updates: unknown[][] = []
const markupFetches: unknown[][] = []

function isMatch(doc: Doc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (typeof expected === 'object' && expected !== null && '$in' in expected) {
      return Array.isArray(expected.$in) && expected.$in.includes(doc[key])
    }
    return doc[key] === expected
  })
}

vi.mock('@hcengineering/api-client', () => ({
  connect: async () => ({
    findAll: async (_class: string, query: Record<string, unknown>) =>
      docs.filter((doc) => doc._class === _class && isMatch(doc, query)),
    findOne: async (_class: string, query: Record<string, unknown>) =>
      docs.find((doc) => doc._class === _class && isMatch(doc, query)),
    updateDoc: async (...args: unknown[]) => {
      updates.push(args)
    },
    fetchMarkup: async (...args: unknown[]) => {
      markupFetches.push(args)
      return '## From collaborator'
    },
    close: async () => {}
  })
}))

function issue(id: string, number: number, extra: Record<string, unknown> = {}): Doc {
  return {
    _id: id,
    _class: 'tracker:class:Issue',
    space: 'project-1',
    identifier: `OMP-${number}`,
    number,
    title: `Issue ${number}`,
    status: 'status-todo',
    component: null,
    attachedTo: 'tracker:ids:NoParent',
    milestone: 'milestone-1',
    ...extra
  }
}

beforeEach(() => {
  updates.length = 0
  markupFetches.length = 0
  docs.length = 0
  docs.push(
    {
      _id: 'project-1',
      _class: 'tracker:class:Project',
      identifier: 'OMP',
      name: 'OrderMage',
      type: 'type-1'
    },
    {
      _id: 'type-1',
      _class: 'task:class:ProjectType',
      statuses: [{ _id: 'status-todo' }, { _id: 'status-review' }]
    },
    {
      _id: 'status-todo',
      _class: 'tracker:class:IssueStatus',
      name: 'Todo',
      category: 'task:statusCategory:ToDo'
    },
    {
      _id: 'status-review',
      _class: 'tracker:class:IssueStatus',
      name: 'CODE REVIEW',
      category: 'task:statusCategory:Active'
    },
    issue('issue-1', 1, { component: 'component-api' }),
    issue('issue-2', 2, {
      blockedBy: [{ _id: 'issue-1' }, { _id: 'issue-9' }],
      attachedTo: 'issue-1',
      status: 'status-review'
    }),
    issue('issue-9', 9, { milestone: 'milestone-other' })
  )
})

describe('createHulyApi', () => {
  it('maps milestone issues with status categories, blockers and parents', async () => {
    const api = await createHulyApi({ serverUrl: 'https://huly.test/', workspace: 'acme' }, 'token')

    const issues = await api.listMilestoneIssues('OMP', 'milestone-1')

    expect(issues).toEqual([
      {
        id: 'issue-1',
        identifier: 'OMP-1',
        number: 1,
        title: 'Issue 1',
        url: 'https://huly.test/workbench/acme/tracker/OMP-1',
        status: { name: 'Todo', category: 'ToDo' },
        componentId: 'component-api',
        blockedBy: [],
        parentIssueId: null
      },
      expect.objectContaining({
        identifier: 'OMP-2',
        status: { name: 'CODE REVIEW', category: 'Active' },
        blockedBy: ['OMP-1', 'OMP-9'],
        parentIssueId: 'issue-1'
      })
    ])
  })

  it('converts an inline milestone description to markdown', async () => {
    docs.push({
      _id: 'milestone-1',
      _class: 'tracker:class:Milestone',
      space: 'project-1',
      label: 'Kiosek',
      status: 1,
      description: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Order' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'API first', marks: [{ type: 'bold' }] }]
          }
        ]
      })
    })
    const api = await createHulyApi({ serverUrl: 'https://huly.test', workspace: 'acme' }, 'token')

    const milestone = await api.getMilestone('OMP', 'milestone-1')

    expect(milestone).toMatchObject({ label: 'Kiosek', status: 'InProgress' })
    expect(milestone.descriptionMarkdown).toBe('## Order\n\n**API first**')
  })

  it('fetches a blob-ref milestone description through the collaborator', async () => {
    docs.push({
      _id: 'milestone-1',
      _class: 'tracker:class:Milestone',
      space: 'project-1',
      label: 'Kiosek',
      status: 0,
      description: 'blob-ref-1'
    })
    const api = await createHulyApi({ serverUrl: 'https://huly.test', workspace: 'acme' }, 'token')

    const milestone = await api.getMilestone('OMP', 'milestone-1')

    expect(milestone.descriptionMarkdown).toBe('## From collaborator')
    expect(markupFetches).toEqual([
      ['tracker:class:Milestone', 'milestone-1', 'description', 'blob-ref-1', 'markdown']
    ])
  })

  it('sets an issue status by its case-insensitive name', async () => {
    const api = await createHulyApi({ serverUrl: 'https://huly.test', workspace: 'acme' }, 'token')

    await api.setIssueStatus('OMP', 'OMP-1', 'code review')

    expect(updates).toEqual([
      ['tracker:class:Issue', 'project-1', 'issue-1', { status: 'status-review' }]
    ])
  })
})

describe('isHulyAuthError', () => {
  it('recognizes the platform auth status codes only', () => {
    expect(isHulyAuthError(new Error('ERROR: platform:status:TokenExpired {}'))).toBe(true)
    expect(isHulyAuthError(new Error('ERROR: platform:status:WorkspaceNotFound {}'))).toBe(false)
  })
})
