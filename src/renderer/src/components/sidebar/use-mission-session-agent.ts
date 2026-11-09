import { useMemo, useState } from 'react'
import { getAgentCatalog, type AgentCatalogEntry } from '@/lib/agent-catalog/agent-catalog'
import {
  pickQuickWorkspaceAgent,
  resolveQuickWorkspaceAgentSelection
} from '@/lib/quick-workspace-agent-selection'
import { useAppStore } from '@/store'
import {
  filterEnabledTuiAgents,
  DEFAULT_DISABLED_TUI_AGENTS
} from '../../../../shared/agent-launch/catalog/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'

/** Agent picked for a new Mission's session, following the composer's selection rules. */
export function useMissionSessionAgent(): {
  sessionAgent: TuiAgent | null
  setSessionAgent: (agent: TuiAgent | null) => void
  visibleAgents: AgentCatalogEntry[]
} {
  const defaultTuiAgent = useAppStore((s) => s.settings?.defaultTuiAgent ?? null)
  const disabledTuiAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  // Why: a disabled or undetected default must not be submitted invisibly, and a
  // user pick survives detection updates via the override (repaired during render, not effects).
  const [sessionAgentOverride, setSessionAgentOverride] = useState<TuiAgent | null | undefined>(
    undefined
  )
  const preferredSessionAgent = useMemo(
    () => pickQuickWorkspaceAgent(defaultTuiAgent, detectedAgentIds, disabledTuiAgents),
    [defaultTuiAgent, detectedAgentIds, disabledTuiAgents]
  )
  const resolved = resolveQuickWorkspaceAgentSelection({
    quickAgentOverride: sessionAgentOverride,
    preferredQuickAgent: preferredSessionAgent,
    detectedAgentIds,
    disabledTuiAgents
  })
  if (resolved.quickAgentOverride !== sessionAgentOverride) {
    setSessionAgentOverride(resolved.quickAgentOverride)
  }

  const visibleAgents = useMemo(() => {
    const enabledIds = new Set(
      filterEnabledTuiAgents(
        getAgentCatalog().map((agent) => agent.id),
        disabledTuiAgents
      )
    )
    const detected = detectedAgentIds === null ? null : new Set(detectedAgentIds)
    return getAgentCatalog().filter(
      (agent) => enabledIds.has(agent.id) && (detected === null || detected.has(agent.id))
    )
  }, [detectedAgentIds, disabledTuiAgents])

  return {
    sessionAgent: resolved.quickAgent,
    setSessionAgent: setSessionAgentOverride,
    visibleAgents
  }
}
