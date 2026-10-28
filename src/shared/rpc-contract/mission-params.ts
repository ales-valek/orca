import { z } from 'zod'
import { isValidGitBranchName } from '../git-branch-name'
import { isTuiAgent } from '../tui-agent-config'
import { OptionalString, requiredString } from './rpc-param-primitives'

const MissionSelectorField = requiredString('Missing mission selector')
const MissionRepoSelectors = z
  .array(requiredString('Missing repo selector'))
  .min(1, 'Pass at least one --repo')

export const MissionSelectorParams = z.object({
  mission: MissionSelectorField
})

export const MissionPathParams = z.object({
  path: requiredString('Missing path')
})

export const MissionCreateParams = z.object({
  name: requiredString('Missing mission name'),
  repos: MissionRepoSelectors,
  branch: OptionalString.refine(
    (value) => value === undefined || isValidGitBranchName(value.trim()),
    'Invalid git branch name'
  ),
  agent: OptionalString.refine((value) => value === undefined || isTuiAgent(value), 'Unknown agent')
})

export const MissionAddReposParams = z.object({
  mission: MissionSelectorField,
  repos: MissionRepoSelectors
})

export const MissionRemoveParams = z.object({
  mission: MissionSelectorField,
  deleteWorktrees: z.boolean()
})

const MissionRepoSelector = requiredString('Missing repo selector')

export const MissionAddTaskParams = z.object({
  mission: MissionSelectorField,
  repo: MissionRepoSelector,
  title: requiredString('Missing task title'),
  ref: OptionalString
})

export const MissionRemoveTaskParams = z.object({
  mission: MissionSelectorField,
  repo: MissionRepoSelector
})

export const MissionRestackParams = z.object({
  mission: MissionSelectorField,
  repo: OptionalString
})

export const MissionAbsorbParams = z.object({
  mission: MissionSelectorField,
  repo: MissionRepoSelector,
  /** `file:line` of an ambiguous hunk mapped to a task ref (tracker key, branch or id). */
  choose: z.record(z.string(), requiredString('Missing task ref')).optional()
})
