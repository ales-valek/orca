import { z } from 'zod'
import { OptionalString, requiredString } from './rpc-param-primitives'

const WorktreeSelector = requiredString('Missing worktree')

export const TestRunsResultsParams = z.object({
  worktree: WorktreeSelector,
  failed: z.boolean().optional()
})

export const TestRunsListParams = z.object({
  worktree: WorktreeSelector,
  target: OptionalString,
  source: OptionalString,
  config: OptionalString,
  grep: OptionalString
})

export const TestRunsRunParams = TestRunsListParams.omit({ grep: true }).extend({
  // Why no leading dash: each filter reaches Playwright's CLI as an argument, never as an option.
  filters: z.array(z.string().regex(/^[^-]/, 'Filters are file paths or file:line')).default([]),
  headed: z.boolean().optional()
})
