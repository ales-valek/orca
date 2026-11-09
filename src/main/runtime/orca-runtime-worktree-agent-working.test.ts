import { describe, expect, it } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server/agent-hook-server'
import { OrcaRuntimeService } from './orca-runtime'

const WT = 'repo-1::/tmp/worktree-a'
const OTHER = 'repo-1::/tmp/worktree-b'
const LEAF = '22222222-2222-4222-8222-222222222222'

function attachWithTab(): {
  runtime: OrcaRuntimeService
  server: AgentHookServer
  detach: () => void
} {
  const runtime = new OrcaRuntimeService()
  const server = new AgentHookServer()
  const detach = runtime.attachAgentStatusStore(server)
  runtime.syncWindowGraph(1, {
    tabs: [{ tabId: 'tab-1', worktreeId: WT, title: 'Terminal', activeLeafId: LEAF, layout: null }],
    leaves: [],
    mobileSessionTabs: []
  })
  return { runtime, server, detach }
}

describe('OrcaRuntimeService.isWorktreeAgentWorking', () => {
  it('reports the worktree of a pane whose agent turn is still running', () => {
    const { runtime, server, detach } = attachWithTab()
    try {
      expect(runtime.isWorktreeAgentWorking(WT)).toBe(false)

      server.ingestTerminalStatus({
        paneKey: `tab-1:${LEAF}`,
        tabId: 'tab-1',
        payload: { state: 'working', prompt: 'refactor', agentType: 'claude' }
      })

      expect(runtime.isWorktreeAgentWorking(WT)).toBe(true)
      expect(runtime.isWorktreeAgentWorking(OTHER)).toBe(false)

      server.ingestTerminalStatus({
        paneKey: `tab-1:${LEAF}`,
        tabId: 'tab-1',
        payload: { state: 'done', prompt: 'refactor', agentType: 'claude' }
      })

      expect(runtime.isWorktreeAgentWorking(WT)).toBe(false)
    } finally {
      detach()
    }
  })

  it('is false once the store is detached', () => {
    const { runtime, server, detach } = attachWithTab()
    server.ingestTerminalStatus({
      paneKey: `tab-1:${LEAF}`,
      tabId: 'tab-1',
      payload: { state: 'working', prompt: 'refactor', agentType: 'claude' }
    })

    detach()

    expect(runtime.isWorktreeAgentWorking(WT)).toBe(false)
  })
})
