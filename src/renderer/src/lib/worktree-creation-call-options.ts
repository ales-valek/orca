import { toast } from 'sonner'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { CreateWorktreeCallOptions } from '@/store/slices/worktrees/create/worktree-create-payload'

/** Options of the creation flow's `createWorktree` call, built from the prepared request. */
export function buildFlowCreateWorktreeOptions(
  preparedRequest: WorktreeCreationRequest,
  context: {
    creationHostId: CreateWorktreeCallOptions['executionHostId']
    hostAgentLaunch: CreateWorktreeCallOptions['hostAgentLaunch'] | null | undefined
    structuredLaunch: boolean
    backendStartup: unknown
    provisionedRoot: CreateWorktreeCallOptions['provisionedRoot'] | null | undefined
  }
): CreateWorktreeCallOptions {
  return {
    setupOnly: preparedRequest.setupOnly,
    ...(preparedRequest.devEnv ? { devEnv: preparedRequest.devEnv } : {}),
    ...(preparedRequest.branchIntent ? { branchIntent: preparedRequest.branchIntent } : {}),
    ...(context.hostAgentLaunch ? { hostAgentLaunch: context.hostAgentLaunch } : {}),
    executionHostId: context.creationHostId,
    ...(preparedRequest.nameWasGenerated ? { nameWasGenerated: true } : {}),
    ...(preparedRequest.displayNameKind
      ? { displayNameKind: preparedRequest.displayNameKind }
      : {}),
    ...(preparedRequest.linkedWorkItem !== undefined
      ? { linkedWorkItem: preparedRequest.linkedWorkItem }
      : {}),
    ...(preparedRequest.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: preparedRequest.linkedTaskSourceContext }
      : {}),
    // Why: the remote host must own task-draft startup so its initial terminal is the agent, not an idle fallback shell.
    ...(!context.structuredLaunch &&
    !context.backendStartup &&
    preparedRequest.agent &&
    preparedRequest.launchDraftPrompt
      ? { startupDraft: preparedRequest.launchDraftPrompt }
      : {}),
    ...(context.provisionedRoot ? { provisionedRoot: context.provisionedRoot } : {}),
    ...(preparedRequest.parentWorktreeId
      ? { parentWorktreeId: preparedRequest.parentWorktreeId }
      : {})
  }
}

/** The worktree exists either way; only the requested Dev Environment is missing. */
export function warnIfDevEnvCreateFailed(error: string | undefined): void {
  if (error) {
    toast.warning('Dev Environment was not created', { description: error })
  }
}
