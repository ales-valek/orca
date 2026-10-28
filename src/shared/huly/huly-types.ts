export type HulyStatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export type HulyStatus = { name: string; category: HulyStatusCategory }

export type HulyComponent = { id: string; label: string }

export type HulyMilestoneSummary = { id: string; label: string; status: string }

export type HulyMilestone = HulyMilestoneSummary & { descriptionMarkdown: string; url: string }

export type HulyIssue = {
  id: string
  identifier: string
  number: number
  title: string
  url: string
  status: HulyStatus
  componentId: string | null
  /** Identifiers (e.g. `OMP-12`) of the issues blocking this one. */
  blockedBy: string[]
  parentIssueId: string | null
}

export type HulyProjectSummary = { identifier: string; name: string }

export type HulyConnectionInfo = { serverUrl: string; workspace: string }

export type HulyConnectionStatus =
  | { connected: false }
  | { connected: true; info: HulyConnectionInfo }
