import { z } from 'zod'
import type { HulyStatusCategory } from '../../shared/huly/huly-types'

// Model ids from @hcengineering/tracker and @hcengineering/task (plugin `kind:class:Name` refs).
export const HULY_CLASS = {
  project: 'tracker:class:Project',
  issue: 'tracker:class:Issue',
  milestone: 'tracker:class:Milestone',
  component: 'tracker:class:Component',
  issueStatus: 'tracker:class:IssueStatus',
  projectType: 'task:class:ProjectType'
} as const

export const HULY_NO_PARENT = 'tracker:ids:NoParent'

const STATUS_CATEGORY_PREFIX = 'task:statusCategory:'
const STATUS_CATEGORIES: readonly HulyStatusCategory[] = [
  'UnStarted',
  'ToDo',
  'Active',
  'Won',
  'Lost'
]
// tracker MilestoneStatus enum order.
const MILESTONE_STATUS_NAMES = ['Planned', 'InProgress', 'Completed', 'Canceled']

export const projectDocSchema = z.object({
  _id: z.string(),
  identifier: z.string(),
  name: z.string(),
  type: z.string(),
  archived: z.boolean().optional()
})

export const milestoneDocSchema = z.object({
  _id: z.string(),
  label: z.string(),
  status: z.number(),
  description: z.string().nullish()
})

export const componentDocSchema = z.object({ _id: z.string(), label: z.string() })

export const statusDocSchema = z.object({
  _id: z.string(),
  name: z.string(),
  category: z.string().nullish()
})

export const projectTypeDocSchema = z.object({
  statuses: z.array(z.object({ _id: z.string() }))
})

export const issueDocSchema = z.object({
  _id: z.string(),
  _class: z.string(),
  space: z.string(),
  identifier: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  component: z.string().nullish(),
  attachedTo: z.string().nullish(),
  blockedBy: z.array(z.object({ _id: z.string() })).nullish()
})

export function parseHulyDocs<T>(schema: z.ZodType<T>, docs: unknown[]): T[] {
  return docs.map((doc) => schema.parse(doc))
}

export function getHulyStatusCategory(
  categoryRef: string | null | undefined
): HulyStatusCategory | null {
  if (!categoryRef?.startsWith(STATUS_CATEGORY_PREFIX)) {
    return null
  }
  const name = categoryRef.slice(STATUS_CATEGORY_PREFIX.length)
  return STATUS_CATEGORIES.find((category) => category === name) ?? null
}

export function getMilestoneStatusName(status: number): string {
  return MILESTONE_STATUS_NAMES[status] ?? String(status)
}
