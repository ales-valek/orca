import React, { useId, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { formatHulyError } from '@/components/huly-error-copy'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectCanonicalProjects } from '@/store/project-host-setup-selector'
import { getHulyProjectSettings } from '../../../../shared/huly/huly-project-settings'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import { slugifyMissionBranch } from '../../../../shared/missions'
import { getOrderOverrides } from './mission-huly-plan-order'
import { isRendererMissionEligibleRepo } from './mission-repo-eligibility'
import { MissionHulyMilestonePicker } from './MissionHulyMilestonePicker'
import { MissionHulyPlanBody } from './MissionHulyPlanBody'
import type { MissionHulyPlanPicks } from './MissionHulyPlanView'
import {
  getEffectiveOrchestratorRepoId,
  MissionOrchestratorRepoPicker
} from './MissionOrchestratorRepoPicker'
import { useHulyMilestonePlan, useHulyMilestones } from './use-huly-milestone-plan'
import { useMissionSessionAgent } from './use-mission-session-agent'

const EMPTY_PICKS: MissionHulyPlanPicks = {
  repoOverrides: {},
  remembered: new Set(),
  orderByRepo: {}
}
const IGNORE_AUTH_REQUIRED = (): void => {}

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

  const nameId = useId()
  const branchId = useId()
  const orchestratorId = useId()
  const hulyProjectsRead = useHulyProjects(IGNORE_AUTH_REQUIRED)
  const hulyProjects = useMemo(() => settings?.hulyProjects ?? {}, [settings?.hulyProjects])
  const projectList = hulyProjectsRead.result.state === 'ready' ? hulyProjectsRead.result.value : []
  const [pickedProject, setPickedProject] = useState<string | null>(null)
  const project = pickedProject ?? getDefaultHulyProject(projectList, hulyProjects)
  const milestonesRead = useHulyMilestones(project)
  const [milestoneId, setMilestoneId] = useState<string | null>(null)
  const [picks, setPicks] = useState<MissionHulyPlanPicks>(EMPTY_PICKS)
  const planState = useHulyMilestonePlan(project, milestoneId, picks.repoOverrides)
  // null follows the milestone label and its slug.
  const [name, setName] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [orchestratorRepoId, setOrchestratorRepoId] = useState<string | null>(null)
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
    closeModal()
  }

  async function rememberComponentRepos(projectId: string, unmapped: HulyIssue[]): Promise<void> {
    const current = getHulyProjectSettings({ hulyProjects }, projectId)
    const componentRepoMap = { ...current.componentRepoMap }
    let changed = false
    for (const issue of unmapped) {
      const repoId = picks.repoOverrides[issue.identifier]
      if (
        issue.componentId !== null &&
        repoId &&
        picks.remembered.has(issue.identifier) &&
        componentRepoMap[issue.componentId] !== repoId
      ) {
        componentRepoMap[issue.componentId] = repoId
        changed = true
      }
    }
    if (!changed) {
      return
    }
    // Saving replaces the whole map, so every update carries the other projects too.
    await updateSettings({
      hulyProjects: { ...hulyProjects, [projectId]: { ...current, componentRepoMap } }
    })
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
      await rememberComponentRepos(project, ready.unmapped)
      const result = await createMissionFromMilestone({
        project,
        milestone: milestoneId,
        name: effectiveName.trim(),
        branch: effectiveBranch,
        ...(sessionAgent ? { agent: sessionAgent } : {}),
        ...(effectiveOrchestrator ? { orchestratorRepo: `id:${effectiveOrchestrator}` } : {}),
        ...(Object.keys(picks.repoOverrides).length > 0
          ? { repoOverrides: picks.repoOverrides }
          : {}),
        ...(Object.keys(orderOverrides).length > 0 ? { orderOverrides } : {})
      })
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
      setCreateError(formatHulyError(error))
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
        <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
          {hulyProjectsRead.result.state === 'error' ? (
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
            repos={eligibleRepos}
            repoNameById={repoNameById}
            picks={picks}
            onPicksChange={setPicks}
          />
          {ready ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={nameId} variant="settings">
                  {translate('auto.components.sidebar.MissionFromHulyDialog.name', 'Mission Name')}
                </Label>
                <Input
                  id={nameId}
                  value={effectiveName}
                  onChange={(event) => setName(event.target.value)}
                  density="compact"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={branchId} variant="settings">
                  {translate('auto.components.sidebar.MissionFromHulyDialog.branch', 'Branch')}
                </Label>
                <Input
                  id={branchId}
                  value={branch ?? derivedBranch}
                  onChange={(event) => setBranch(event.target.value)}
                  variant="code"
                  density="compact"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={orchestratorId} variant="settings">
                  {translate(
                    'auto.components.sidebar.MissionFromHulyDialog.orchestrator',
                    'Orchestrator project (optional)'
                  )}
                </Label>
                <MissionOrchestratorRepoPicker
                  id={orchestratorId}
                  eligibleRepos={eligibleRepos}
                  memberRepoIds={memberRepoIds}
                  value={orchestratorRepoId}
                  onChange={setOrchestratorRepoId}
                />
              </div>
              <div className="space-y-1">
                <Label variant="settings">
                  {translate('auto.components.sidebar.MissionFromHulyDialog.agent', 'Agent')}
                </Label>
                <AgentCombobox
                  agents={visibleAgents}
                  value={sessionAgent}
                  onValueChange={setSessionAgent}
                  triggerClassName="h-8 w-full border-input text-xs"
                />
              </div>
            </div>
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
