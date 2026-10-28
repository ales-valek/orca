import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import { isTuiAgent } from '../../../shared/tui-agent-config'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import type { TuiAgent } from '../../../shared/tui-agent'
import { getFolderWorkspaceAgentLaunchFact } from '@/components/sidebar/folder-workspace-agent-startup'
import { useAppStore } from '@/store'
import { tuiAgentToAgentKind } from './telemetry'
import { buildAgentStartupPlan } from './tui-agent-startup'
import type { WorktreeStartupPayload } from './worktree-startup-payload'

function buildAgentReopenStartupPayload(
  agent: TuiAgent,
  launchPlatform: NodeJS.Platform,
  isRemote: boolean
): WorktreeStartupPayload | undefined {
  const state = useAppStore.getState()
  const startupPlan = buildAgentStartupPlan({
    agent,
    prompt: '',
    cmdOverrides: state.settings?.agentCmdOverrides ?? {},
    agentArgs: resolveTuiAgentLaunchArgs(agent, state.settings),
    agentEnv: resolveTuiAgentLaunchEnv(agent, state.settings),
    platform: launchPlatform,
    isRemote,
    allowEmptyPromptLaunch: true
  })
  if (!startupPlan) {
    return undefined
  }

  return {
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    launchConfig: startupPlan.launchConfig,
    launchAgent: agent,
    ...(startupPlan.startupCommandDelivery
      ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
      : {}),
    telemetry: {
      agent_kind: tuiAgentToAgentKind(agent),
      launch_source: 'sidebar',
      request_kind: 'resume'
    }
  }
}

export function buildFolderWorkspaceAgentReopenStartup(
  folderWorkspace: FolderWorkspace
): WorktreeStartupPayload | undefined {
  const agent = folderWorkspace.createdWithAgent
  if (!isTuiAgent(agent)) {
    return undefined
  }
  // Why: a folder workspace has no repo row — derive the launch platform from
  // its own host provenance so remote/WSL sessions relaunch on the correct host.
  const launchHost = getFolderWorkspaceAgentLaunchFact(useAppStore.getState(), {
    connectionId: folderWorkspace.connectionId,
    executionHostId: folderWorkspace.executionHostId,
    parentPath: folderWorkspace.folderPath
  })
  if (launchHost.kind !== 'known') {
    return undefined
  }
  return buildAgentReopenStartupPayload(
    agent,
    launchHost.platform,
    Boolean(folderWorkspace.connectionId)
  )
}
