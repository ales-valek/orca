import React, { useId } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { HulyMilestoneSummary, HulyProjectSummary } from '../../../../shared/huly/huly-types'

/** Huly project and milestone selects for a new Mission. */
export function MissionHulyMilestonePicker({
  projects,
  project,
  onProjectChange,
  milestones,
  milestoneId,
  onMilestoneChange
}: {
  projects: readonly HulyProjectSummary[]
  project: string | null
  onProjectChange: (project: string) => void
  /** null while the project's milestones load. */
  milestones: readonly HulyMilestoneSummary[] | null
  milestoneId: string | null
  onMilestoneChange: (milestoneId: string) => void
}): React.JSX.Element {
  const projectId = useId()
  const milestoneSelectId = useId()
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor={projectId} variant="settings">
          {translate('auto.components.sidebar.MissionHulyMilestonePicker.project', 'Project')}
        </Label>
        <Select
          value={project ?? ''}
          onValueChange={(next) => {
            // Radix reports '' for the hidden form select; '' is never a real pick.
            if (next) {
              onProjectChange(next)
            }
          }}
        >
          <SelectTrigger
            id={projectId}
            size="sm"
            density="compact"
            className="w-full"
            aria-label={translate(
              'auto.components.sidebar.MissionHulyMilestonePicker.projectLabel',
              'Huly project'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projects.map((entry) => (
              <SelectItem key={entry.identifier} value={entry.identifier}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={milestoneSelectId} variant="settings">
          {translate('auto.components.sidebar.MissionHulyMilestonePicker.milestone', 'Milestone')}
        </Label>
        <Select
          value={milestoneId ?? ''}
          onValueChange={(next) => {
            if (next) {
              onMilestoneChange(next)
            }
          }}
          disabled={milestones === null}
        >
          <SelectTrigger
            id={milestoneSelectId}
            size="sm"
            density="compact"
            className="w-full"
            aria-label={translate(
              'auto.components.sidebar.MissionHulyMilestonePicker.milestoneLabel',
              'Huly milestone'
            )}
          >
            <SelectValue
              placeholder={
                milestones === null
                  ? translate(
                      'auto.components.sidebar.MissionHulyMilestonePicker.loading',
                      'Loading...'
                    )
                  : translate(
                      'auto.components.sidebar.MissionHulyMilestonePicker.choose',
                      'Choose a milestone'
                    )
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(milestones ?? []).map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
