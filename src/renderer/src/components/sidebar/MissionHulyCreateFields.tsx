import React, { useId } from 'react'
import { DevEnvTemplatePicker } from '../dev-env/DevEnvTemplatePicker'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { AgentCatalogEntry } from '@/lib/agent-catalog/agent-catalog'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { MissionOrchestratorRepoPicker } from './MissionOrchestratorRepoPicker'

/** Name, branch, orchestrator and agent of a Mission created from a milestone. */
export function MissionHulyCreateFields(props: {
  name: string
  onNameChange: (name: string) => void
  /** null shows the branch derived from the name. */
  branch: string | null
  derivedBranch: string
  onBranchChange: (branch: string) => void
  eligibleRepos: readonly Repo[]
  memberRepoIds: ReadonlySet<string>
  orchestratorRepoId: string | null
  onOrchestratorRepoChange: (repoId: string | null) => void
  agents: AgentCatalogEntry[]
  agent: TuiAgent | null
  onAgentChange: (agent: TuiAgent | null) => void
  devEnvTemplateId: string | null
  onDevEnvTemplateChange: (templateId: string | null) => void
}): React.JSX.Element {
  const nameId = useId()
  const branchId = useId()
  const orchestratorId = useId()
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor={nameId} variant="settings">
          {translate('auto.components.sidebar.MissionHulyCreateFields.name', 'Mission Name')}
        </Label>
        <Input
          id={nameId}
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          density="compact"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={branchId} variant="settings">
          {translate('auto.components.sidebar.MissionHulyCreateFields.branch', 'Branch')}
        </Label>
        <Input
          id={branchId}
          value={props.branch ?? props.derivedBranch}
          // A cleared field falls back to the derived branch; the placeholder shows which.
          placeholder={props.derivedBranch}
          onChange={(event) => props.onBranchChange(event.target.value)}
          variant="code"
          density="compact"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={orchestratorId} variant="settings">
          {translate(
            'auto.components.sidebar.MissionHulyCreateFields.orchestrator',
            'Orchestrator project (optional)'
          )}
        </Label>
        <MissionOrchestratorRepoPicker
          id={orchestratorId}
          eligibleRepos={props.eligibleRepos}
          memberRepoIds={props.memberRepoIds}
          value={props.orchestratorRepoId}
          onChange={props.onOrchestratorRepoChange}
        />
      </div>
      <div className="space-y-1">
        <Label variant="settings">
          {translate('auto.components.sidebar.MissionHulyCreateFields.agent', 'Agent')}
        </Label>
        <AgentCombobox
          agents={props.agents}
          value={props.agent}
          onValueChange={props.onAgentChange}
          triggerClassName="h-8 w-full border-input text-xs"
        />
      </div>
      <DevEnvTemplatePicker
        value={props.devEnvTemplateId}
        onChange={props.onDevEnvTemplateChange}
        repoIds={[...props.memberRepoIds]}
      />
    </div>
  )
}
