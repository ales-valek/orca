import { z } from 'zod'
import { PLAYWRIGHT_CONFIG_FILE_PATTERN } from '../test-runs/test-run-launch-types'
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
  config: OptionalString.pipe(
    z.union([
      z.string().regex(PLAYWRIGHT_CONFIG_FILE_PATTERN, 'Not a Playwright config file'),
      z.undefined()
    ])
  ),
  grep: OptionalString
})

export const TestRunsRunParams = TestRunsListParams.omit({ grep: true }).extend({
  // Why no leading dash: each filter reaches Playwright's CLI as an argument, never as an option.
  filters: z.array(z.string().regex(/^[^-]/, 'Filters are file paths or file:line')).default([]),
  headed: z.boolean().optional()
})
