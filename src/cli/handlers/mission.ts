import { resolve as resolvePath } from 'node:path'
import type {
  RuntimeMissionAbsorbResult,
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRemoveResult,
  RuntimeMissionRestackResult,
  RuntimeMissionSession,
  RuntimeMissionShow,
  RuntimeMissionTaskResult
} from '../../shared/mission-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import {
  formatMissionAbsorb,
  formatMissionList,
  formatMissionMutation,
  formatMissionRemove,
  formatMissionRestack,
  formatMissionShow,
  formatMissionTask
} from '../mission-format'
import { RuntimeClientError } from '../runtime/types'

function getRequiredRepoSelectors(flags: Map<string, string | boolean>): string[] {
  const repos = getRepeatedStringFlag(flags, 'repo')
  if (repos.length === 0) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --repo')
  }
  return repos
}

function getChoiceOverrides(
  flags: Map<string, string | boolean>
): Record<string, string> | undefined {
  const choices = getRepeatedStringFlag(flags, 'choose')
  if (choices.length === 0) {
    return undefined
  }
  const overrides: Record<string, string> = {}
  for (const choice of choices) {
    const split = choice.lastIndexOf('=')
    const hunk = choice.slice(0, split)
    const taskRef = choice.slice(split + 1)
    if (split < 1 || !/:\d+$/.test(hunk) || taskRef.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Invalid --choose "${choice}"; expected <file:line=taskRef>`
      )
    }
    overrides[hunk] = taskRef
  }
  return overrides
}

export const MISSION_HANDLERS: Record<string, CommandHandler> = {
  'mission list': async ({ client, json }) => {
    const result = await client.call<RuntimeMissionList>('mission.list')
    printResult(result, json, formatMissionList)
  },
  'mission show': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionShow>('mission.show', {
      mission: getRequiredStringFlag(flags, 'mission')
    })
    printResult(result, json, formatMissionShow)
  },
  'mission current': async ({ client, cwd, json }) => {
    if (client.isRemote) {
      // Why: a paired CLI's cwd belongs to the client machine, not the runtime host.
      throw new RuntimeClientError(
        'invalid_argument',
        'mission current resolves the local cwd and cannot target a remote runtime. Use `orca mission show <selector>`.'
      )
    }
    const currentPath = resolvePath(cwd)
    try {
      const result = await client.call<RuntimeMissionShow>('mission.forPath', {
        path: currentPath
      })
      printResult(result, json, formatMissionShow)
    } catch (error) {
      if (error instanceof RuntimeClientError && error.code === 'selector_not_found') {
        throw new RuntimeClientError(
          'selector_not_found',
          `No Mission root or member worktree contains the current directory: ${currentPath}`
        )
      }
      throw error
    }
  },
  'mission create': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionMutationResult>('mission.create', {
      name: getRequiredStringFlag(flags, 'name'),
      repos: getRequiredRepoSelectors(flags),
      branch: getOptionalStringFlag(flags, 'branch'),
      agent: getOptionalStringFlag(flags, 'agent')
    })
    printResult(result, json, formatMissionMutation)
  },
  'mission session': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionSession>('mission.session', {
      mission: getRequiredStringFlag(flags, 'mission')
    })
    printResult(result, json, (session) => `folder:${session.folderId}  ${session.folderPath}`)
  },
  'mission add-repo': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionMutationResult>('mission.addRepos', {
      mission: getRequiredStringFlag(flags, 'mission'),
      repos: getRequiredRepoSelectors(flags)
    })
    printResult(result, json, formatMissionMutation)
  },
  'mission task add': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionTaskResult>('mission.addTask', {
      mission: getRequiredStringFlag(flags, 'mission'),
      repo: getRequiredStringFlag(flags, 'repo'),
      title: getRequiredStringFlag(flags, 'title'),
      ref: getOptionalStringFlag(flags, 'ref')
    })
    printResult(result, json, formatMissionTask)
    if (result.result.error) {
      process.exitCode = 1
    }
  },
  'mission task rm': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionTaskResult>('mission.removeTask', {
      mission: getRequiredStringFlag(flags, 'mission'),
      repo: getRequiredStringFlag(flags, 'repo')
    })
    printResult(result, json, formatMissionTask)
    if (result.result.error) {
      process.exitCode = 1
    }
  },
  'mission restack': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionRestackResult>('mission.restack', {
      mission: getRequiredStringFlag(flags, 'mission'),
      repo: getOptionalStringFlag(flags, 'repo')
    })
    printResult(result, json, formatMissionRestack)
  },
  'mission absorb': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionAbsorbResult>('mission.absorb', {
      mission: getRequiredStringFlag(flags, 'mission'),
      repo: getRequiredStringFlag(flags, 'repo'),
      choose: getChoiceOverrides(flags)
    })
    printResult(result, json, formatMissionAbsorb)
    if (result.result.ambiguous.length > 0) {
      process.exitCode = 1
    }
  },
  'mission rm': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeMissionRemoveResult>('mission.remove', {
      mission: getRequiredStringFlag(flags, 'mission'),
      deleteWorktrees: flags.get('keep-worktrees') !== true
    })
    printResult(result, json, formatMissionRemove)
    if (!result.result.deleted) {
      process.exitCode = 1
    }
  }
}
