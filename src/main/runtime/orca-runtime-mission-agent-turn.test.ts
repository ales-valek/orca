import { describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server'
import { OrcaRuntimeService } from './orca-runtime'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn(() => ({})) }))

const WORKTREE_ID = 'repo-1::/missions/kiosek/api'
const PANE = 'tab-a:22222222-2222-4222-8222-222222222222'

function ingest(server: AgentHookServer, state: 'working' | 'done', worktreeId = WORKTREE_ID) {
  server.ingestTerminalStatus({
    paneKey: PANE,
    tabId: 'tab-a',
    worktreeId,
    payload: { state, prompt: 'task', agentType: 'codex' }
  })
}

function makeHarness() {
  const onAgentTurnEnded = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: transitions only read settings from the store.
  const runtime = new OrcaRuntimeService({ getSettings: () => ({}) } as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers the only MissionOperations method this path calls.
  runtime.attachMissionOperations({ onAgentTurnEnded } as never)
  const server = new AgentHookServer()
  runtime.attachAgentStatusStore(server)
  return { onAgentTurnEnded, server }
}

describe('Mission agent turn trigger', () => {
  it('tells Mission operations when an agent turn ends in a worktree', () => {
    const { onAgentTurnEnded, server } = makeHarness()

    ingest(server, 'working')
    expect(onAgentTurnEnded).not.toHaveBeenCalled()
    ingest(server, 'done')

    expect(onAgentTurnEnded).toHaveBeenCalledWith(WORKTREE_ID)
  })
})
