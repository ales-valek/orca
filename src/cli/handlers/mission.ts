import { resolve as resolvePath } from 'node:path'
import type {
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRemoveResult,
  RuntimeMissionSession,
  RuntimeMissionShow
} from '../../shared/mission-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import {
  formatMissionList,
  formatMissionMutation,
  formatMissionRemove,
  formatMissionShow
} from '../mission-format'
import { RuntimeClientError } from '../runtime/types'

function getRequiredRepoSelectors(flags: Map<string, string | boolean>): string[] {
  const repos = getRepeatedStringFlag(flags, 'repo')
  if (repos.length === 0) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --repo')
  }
  return repos
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
