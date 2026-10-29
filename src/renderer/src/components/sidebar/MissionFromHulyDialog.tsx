import React, { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatHulyError, isHulyAuthRequiredError } from '@/components/huly-error-copy'
import { HulyReconnectNotice } from '@/components/huly-reconnect-notice'
import {
  getDefaultHulyProject,
  useHulyProjects
} from '@/components/settings/use-huly-project-catalog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectCanonicalProjects } from '@/store/project-host-setup-selector'
import { getHulyProjectSettings } from '../../../../shared/huly/huly-project-settings'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import { slugifyMissionBranch } from '../../../../shared/missions'
import { getRememberedComponentRepoMap } from './mission-huly-component-repo-memory'
import { getOrderOverrides } from './mission-huly-plan-order'
import { formatMissionMemberError } from './mission-member-error-copy'
import { isRendererMissionEligibleRepo } from './mission-repo-eligibility'
import { MissionHulyMilestonePicker } from './MissionHulyMilestonePicker'
import { MissionHulyPlanBody } from './MissionHulyPlanBody'
import type { MissionHulyPlanPicks } from './MissionHulyPlanView'
import { MissionHulyCreateFields } from './MissionHulyCreateFields'
import { getEffectiveOrchestratorRepoId } from './MissionOrchestratorRepoPicker'
import { useHulyMilestonePlan, useHulyMilestones } from './use-huly-milestone-plan'
import { useMissionSessionAgent } from './use-mission-session-agent'

const EMPTY_PICKS: MissionHulyPlanPicks = {
  repoOverrides: {},
  remembered: new Set(),
  orderByRepo: {}
}

// Huly codes get Huly copy; Mission codes from the create path (e.g. an invalid branch) get Mission copy.
function formatCreateError(error: unknown): string {
  return formatMissionMemberError(formatHulyError(error))
}

/** "New Mission from Huly milestone": one task stack per repo, built from the milestone's issues. */
export default function MissionFromHulyDialog(): React.JSX.Element {
  const open = useAppStore((s) => s.activeModal === 'mission-create-huly')
  const closeModal = useAppStore((s) => s.closeModal)
  const repos = useAppStore((s) => s.repos)
  const orcaProjects = useAppStore((s) => selectCanonicalProjects(s))
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const createMissionFromMilestone = useAppStore((s) => s.createMissionFromMilestone)
  const setSidebarListMode = useAppStore((s) => s.setSidebarListMode)
  const { sessionAgent, setSessionAgent, visibleAgents } = useMissionSessionAgent()

  const [authRequired, setAuthRequired] = useState(false)
  const reportAuthRequired = useCallback(() => setAuthRequired(true), [])
  const hulyProjectsRead = useHulyProjects(reportAuthRequired)
  const hulyProjects = useMemo(() => settings?.hulyProjects ?? {}, [settings?.hulyProjects])
  const projectList = hulyProjectsRead.result.state === 'ready' ? hulyProjectsRead.result.value : []
  const [pickedProject, setPickedProject] = useState<string | null>(null)
  const project = pickedProject ?? getDefaultHulyProject(projectList, hulyProjects)
  const milestonesRead = useHulyMilestones(project, reportAuthRequired)
  const [milestoneId, setMilestoneId] = useState<string | null>(null)
  const [picks, setPicks] = useState<MissionHulyPlanPicks>(EMPTY_PICKS)
  const planState = useHulyMilestonePlan(
    project,
    milestoneId,
    picks.repoOverrides,
    reportAuthRequired
  )
  // null follows the milestone label and its slug.
  const [name, setName] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [orchestratorRepoId, setOrchestratorRepoId] = useState<string | null>(null)
  const [devEnvTemplateId, setDevEnvTemplateId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const eligibleRepos = useMemo(
    () =>
      repos.filter((repo) =>
        isRendererMissionEligibleRepo(repo, { projects: orcaProjects, settings })
      ),
    [orcaProjects, repos, settings]
  )
  const repoNameById = useMemo(
    () => new Map(repos.map((repo) => [repo.id, repo.displayName])),
    [repos]
  )
  const ready = planState.state === 'ready' ? planState : null
  const memberRepoIds = useMemo(
    () => new Set(ready?.plan.stacks.map((stack) => stack.repoId) ?? []),
    [ready?.plan]
  )
  const effectiveName = name ?? ready?.milestone.label ?? ''
  const derivedBranch = slugifyMissionBranch(effectiveName)
  const effectiveBranch = branch?.trim() || derivedBranch
  const canSubmit =
    ready !== null &&
    !ready.pending &&
    ready.planError === null &&
    ready.plan.cycles.length === 0 &&
    ready.plan.unmapped.length === 0 &&
    ready.plan.stacks.length > 0 &&
    ready.unmapped.every((issue) => picks.repoOverrides[issue.identifier]) &&
    effectiveName.trim().length > 0 &&
    !authRequired &&
    !submitting

  function selectMilestone(next: string | null): void {
    setMilestoneId(next)
    setPicks(EMPTY_PICKS)
    setName(null)
    setBranch(null)
    setCreateError(null)
  }

  function resetAndClose(): void {
    setPickedProject(null)
    selectMilestone(null)
    setOrchestratorRepoId(null)
    setSubmitting(false)
    setAuthRequired(false)
    closeModal()
  }

  function reloadAfterReconnect(): void {
    setAuthRequired(false)
    setCreateError(null)
    hulyProjectsRead.retry()
    milestonesRead.retry()
    if (planState.state === 'error' || planState.state === 'ready') {
      planState.retry()
    }
  }

  // Runs only after a successful create; updateSettings logs its own failures, so create never depends on it.
  function rememberComponentRepos(projectId: string, unmapped: HulyIssue[]): void {
    const current = getHulyProjectSettings({ hulyProjects }, projectId)
    const componentRepoMap = getRememberedComponentRepoMap(
      current.componentRepoMap,
      unmapped,
      picks
    )
    if (componentRepoMap) {
      // Saving replaces the whole map, so every update carries the other projects too.
      void updateSettings({
        hulyProjects: { ...hulyProjects, [projectId]: { ...current, componentRepoMap } }
      })
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit || !ready || !project || !milestoneId) {
      return
    }
    setSubmitting(true)
    setCreateError(null)
    const effectiveOrchestrator = getEffectiveOrchestratorRepoId(orchestratorRepoId, memberRepoIds)
    const orderOverrides = getOrderOverrides(ready.plan.stacks, picks.orderByRepo)
    try {
      const result = await createMissionFromMilestone({
        project,
        milestone: milestoneId,
        name: effectiveName.trim(),
        branch: effectiveBranch,
        ...(sessionAgent ? { agent: sessionAgent } : {}),
        ...(effectiveOrchestrator ? { orchestratorRepo: `id:${effectiveOrchestrator}` } : {}),
        ...(devEnvTemplateId ? { devEnvTemplate: devEnvTemplateId } : {}),
        ...(Object.keys(picks.repoOverrides).length > 0
          ? { repoOverrides: picks.repoOverrides }
          : {}),
        ...(Object.keys(orderOverrides).length > 0 ? { orderOverrides } : {})
      })
      rememberComponentRepos(project, ready.unmapped)
      if (result.warnings.length > 0) {
        toast.warning(
          translate(
            'auto.components.sidebar.MissionFromHulyDialog.warnings',
            'The Mission was created, but some steps failed.'
          ),
          { description: result.warnings.join('\n') }
        )
      }
      setSidebarListMode('missions')
      resetAndClose()
    } catch (error) {
      if (isHulyAuthRequiredError(error)) {
        setAuthRequired(true)
      } else {
        setCreateError(formatCreateError(error))
      }
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && resetAndClose()}>
      <DialogContent className="max-w-xl sm:max-w-xl" scrollable>
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.sidebar.MissionFromHulyDialog.title',
              'New Mission from Huly milestone'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.sidebar.MissionFromHulyDialog.description',
              "Each repository gets a stack of task branches, one per open issue, ordered by the issues' blocked-by relations."
            )}
          </DialogDescription>
        </DialogHeader>
        {/* Outside the form: the connect dialog's events bubble through its portal to React parents. */}
        {authRequired ? <HulyReconnectNotice onReconnected={reloadAfterReconnect} /> : null}
        <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
          {authRequired ? null : hulyProjectsRead.result.state === 'error' ? (
            <p role="alert" className="text-xs text-destructive">
              {hulyProjectsRead.result.message}
            </p>
          ) : (
            <MissionHulyMilestonePicker
              projects={projectList}
              project={project}
              onProjectChange={(next) => {
                setPickedProject(next)
                selectMilestone(null)
              }}
              milestones={
                milestonesRead.result.state === 'ready' ? milestonesRead.result.value : null
              }
              milestoneId={milestoneId}
              onMilestoneChange={selectMilestone}
            />
          )}
          <MissionHulyPlanBody
            planState={planState}
            hideErrors={authRequired}
            repos={eligibleRepos}
            repoNameById={repoNameById}
            picks={picks}
            onPicksChange={setPicks}
          />
          {ready ? (
            <MissionHulyCreateFields
              name={effectiveName}
              onNameChange={setName}
              branch={branch}
              derivedBranch={derivedBranch}
              onBranchChange={setBranch}
              eligibleRepos={eligibleRepos}
              memberRepoIds={memberRepoIds}
              orchestratorRepoId={orchestratorRepoId}
              onOrchestratorRepoChange={setOrchestratorRepoId}
              agents={visibleAgents}
              agent={sessionAgent}
              onAgentChange={setSessionAgent}
              devEnvTemplateId={devEnvTemplateId}
              onDevEnvTemplateChange={setDevEnvTemplateId}
            />
          ) : null}
          {createError ? (
            <p role="alert" className="text-xs text-destructive">
              {createError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={resetAndClose}
            >
              {translate('auto.components.sidebar.MissionFromHulyDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {translate('auto.components.sidebar.MissionFromHulyDialog.create', 'Create Mission')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
