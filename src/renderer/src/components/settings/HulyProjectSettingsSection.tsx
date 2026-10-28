import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectCanonicalProjects } from '@/store/project-host-setup-selector'
import {
  getHulyProjectSettings,
  type HulyProjectSettings
} from '../../../../shared/huly/huly-project-settings'
import type { HulyProjectSummary } from '../../../../shared/huly/huly-types'
import { isRendererMissionEligibleRepo } from '../sidebar/mission-repo-eligibility'
import { HulyComponentRepoMapEditor } from './HulyComponentRepoMapEditor'
import { HulyMultiSelect } from './HulyMultiSelect'
import { HulyStatusRuleEditor } from './HulyStatusRuleEditor'
import { SettingsSubsectionHeader, SettingsSwitchRow } from './SettingsFormControls'
import { useHulyProjectCatalog, useHulyProjects } from './use-huly-project-catalog'

function getDefaultProject(
  projects: readonly HulyProjectSummary[],
  configured: Record<string, unknown>
): string | null {
  const configuredProject = projects.find((project) => project.identifier in configured)
  return (configuredProject ?? projects[0])?.identifier ?? null
}

function LoadError(props: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
        {props.message}
      </p>
      <Button variant="ghost" size="sm" onClick={props.onRetry}>
        {translate('auto.components.settings.HulyProjectSettingsSection.retry', 'Retry')}
      </Button>
    </div>
  )
}

function Loading(): React.JSX.Element {
  return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
}

/** Per-project Mission settings: component repositories, skipped statuses and status write-back. */
export function HulyProjectSettingsSection(props: {
  onAuthRequired: () => void
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const repos = useAppStore((s) => s.repos)
  const orcaProjects = useAppStore(selectCanonicalProjects)
  const projects = useHulyProjects(props.onAuthRequired)
  const [pickedProject, setPickedProject] = useState<string | null>(null)

  const hulyProjects = useMemo(() => settings?.hulyProjects ?? {}, [settings?.hulyProjects])
  const projectList = projects.result.state === 'ready' ? projects.result.value : []
  const project = pickedProject ?? getDefaultProject(projectList, hulyProjects)
  const catalog = useHulyProjectCatalog(project, props.onAuthRequired)
  const eligibleRepos = useMemo(
    () =>
      repos.filter((repo) =>
        isRendererMissionEligibleRepo(repo, { projects: orcaProjects, settings })
      ),
    [orcaProjects, repos, settings]
  )

  if (projects.result.state === 'loading') {
    return <Loading />
  }
  if (projects.result.state === 'error') {
    return <LoadError message={projects.result.message} onRetry={projects.retry} />
  }
  if (!project) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.HulyProjectSettingsSection.noProjects',
          'This workspace has no projects.'
        )}
      </p>
    )
  }

  const current = getHulyProjectSettings({ hulyProjects }, project)
  // Saving replaces the whole map, so every update carries the other projects too.
  const save = (patch: Partial<HulyProjectSettings>): void => {
    void updateSettings({ hulyProjects: { ...hulyProjects, [project]: { ...current, ...patch } } })
  }
  const statuses = catalog.result.state === 'ready' ? catalog.result.value.statuses : []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {translate('auto.components.settings.HulyProjectSettingsSection.project', 'Project')}
        </span>
        <Select value={project} onValueChange={setPickedProject}>
          <SelectTrigger
            size="sm"
            density="compact"
            className="min-w-48"
            aria-label={translate(
              'auto.components.settings.HulyProjectSettingsSection.projectLabel',
              'Huly project'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projectList.map((entry) => (
              <SelectItem key={entry.identifier} value={entry.identifier}>
                {entry.name} ({entry.identifier})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {catalog.result.state === 'loading' ? <Loading /> : null}
      {catalog.result.state === 'error' ? (
        <LoadError message={catalog.result.message} onRetry={catalog.retry} />
      ) : null}
      {catalog.result.state === 'ready' ? (
        <>
          <div className="space-y-2">
            <SettingsSubsectionHeader
              title={translate(
                'auto.components.settings.HulyProjectSettingsSection.componentsTitle',
                'Component repositories'
              )}
              description={translate(
                'auto.components.settings.HulyProjectSettingsSection.componentsDescription',
                "Each issue's component picks the repository its task is stacked in."
              )}
            />
            <HulyComponentRepoMapEditor
              components={catalog.result.value.components}
              repos={eligibleRepos}
              allRepos={repos}
              map={current.componentRepoMap}
              onChange={(componentRepoMap) => save({ componentRepoMap })}
            />
          </div>

          <div className="space-y-2">
            <SettingsSubsectionHeader
              title={translate(
                'auto.components.settings.HulyProjectSettingsSection.skipTitle',
                'Skipped statuses'
              )}
              description={translate(
                'auto.components.settings.HulyProjectSettingsSection.skipDescription',
                'Issues in these statuses, or in a done or canceled category, are left out of new Missions.'
              )}
            />
            <div className="max-w-sm">
              <HulyMultiSelect
                options={statuses.map((status) => ({ value: status.name, label: status.name }))}
                selected={current.skipStatusNames}
                onChange={(skipStatusNames) => save({ skipStatusNames })}
                placeholder={translate(
                  'auto.components.settings.HulyProjectSettingsSection.noSkippedStatuses',
                  'No statuses'
                )}
                ariaLabel={translate(
                  'auto.components.settings.HulyProjectSettingsSection.skipTitle',
                  'Skipped statuses'
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <SettingsSwitchRow
              label={translate(
                'auto.components.settings.HulyProjectSettingsSection.writeBackTitle',
                'Write task status back to Huly'
              )}
              description={translate(
                'auto.components.settings.HulyProjectSettingsSection.writeBackDescription',
                'Move linked issues when Orca creates a task layer, opens stacked pull requests, or merges the stack. Issues outside the listed statuses stay where they are.'
              )}
              checked={current.statusWriteBack}
              onChange={() => save({ statusWriteBack: !current.statusWriteBack })}
            />
            {current.statusWriteBack ? (
              <HulyStatusRuleEditor
                statuses={statuses}
                rules={current.statusRules}
                onChange={(statusRules) => save({ statusRules })}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
