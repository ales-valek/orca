export type HulyStatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export type HulyStatus = { name: string; category: HulyStatusCategory }

export type HulyComponent = { id: string; label: string }

export type HulyMilestoneSummary = { id: string; label: string; status: string }

export type HulyMilestone = HulyMilestoneSummary & { descriptionMarkdown: string; url: string }

export type HulyIssue = {
  /** Huly document `_id`; `parentIssueId` uses the same id space. */
  id: string
  identifier: string
  number: number
  title: string
  url: string
  status: HulyStatus
  componentId: string | null
  /** Identifiers (e.g. `OMP-12`) of the issues blocking this one, not `_id`s. */
  blockedBy: string[]
  /** Huly `_id` of the parent issue (not an identifier), or null for a top-level issue. */
  parentIssueId: string | null
}

export type HulyProjectSummary = { identifier: string; name: string }

export type HulyConnectionInfo = { serverUrl: string; workspace: string }

export type HulyConnectionStatus =
  | { connected: false }
  | { connected: true; info: HulyConnectionInfo }
