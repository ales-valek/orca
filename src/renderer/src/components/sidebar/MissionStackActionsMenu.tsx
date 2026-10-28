import React, { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getRepoTaskStack } from '../../../../shared/mission-task-stack'
import type { Mission, MissionAbsorbResult } from '../../../../shared/mission-types'
import { MissionAbsorbDialog, type MissionAbsorbHunk } from './MissionAbsorbDialog'
import { MissionAddTaskDialog } from './MissionAddTaskDialog'
import { formatMissionMemberError } from './mission-member-error-copy'

/** Per-repo stack actions on a member row: add a task, restack, absorb and publish. */
export function MissionStackActionsMenu({
  mission,
  repoId,
  repoName
}: {
  mission: Mission
  repoId: string
  repoName: string
}): React.JSX.Element {
  const restackMissionRepo = useAppStore((s) => s.restackMissionRepo)
  const absorbMissionPreview = useAppStore((s) => s.absorbMissionPreview)
  const createMissionStackPullRequests = useAppStore((s) => s.createMissionStackPullRequests)
  const [addingTask, setAddingTask] = useState(false)
  const [ambiguousHunks, setAmbiguousHunks] = useState<MissionAbsorbHunk[] | null>(null)
  const [busy, setBusy] = useState(false)
  const hasStack = getRepoTaskStack(mission, repoId).length > 0

  const runBusy = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const handleAbsorbResult = (result: MissionAbsorbResult): void => {
    if (result.ambiguous.length > 0) {
      setAmbiguousHunks(result.ambiguous)
      return
    }
    setAmbiguousHunks(null)
    if (result.warning) {
      toast.warning(formatMissionMemberError(result.warning))
    } else {
      toast.success(
        result.applied > 0
          ? translate(
              'components.missions.stack.movedPreviewEdits',
              'Moved {{count}} preview edits into their tasks.',
              {
                count: result.applied
              }
            )
          : translate(
              'auto.components.sidebar.MissionStackActionsMenu.79d129156d',
              'No preview edits to absorb.'
            )
      )
    }
  }

  const absorb = () =>
    runBusy(async () => {
      const result = await absorbMissionPreview(mission.id, repoId)
      if (result) {
        handleAbsorbResult(result)
      }
    })

  const createPullRequests = () =>
    runBusy(async () => {
      const result = await createMissionStackPullRequests(mission.id, repoId)
      const open = result ? result.created.length + result.skipped.length : 0
      if (open > 0) {
        toast.success(
          translate(
            'components.missions.stack.openPullRequests',
            '{{count}} pull requests open for this stack.',
            { count: open }
          )
        )
      }
    })

  return (
    <>
      <DropdownMenu modal={false}>
        {/* Why: the reveal-on-hover lives on a wrapper because Button owns its own effects. */}
        <span className="flex shrink-0 can-hover:opacity-0 transition-opacity group-hover/mission-member:opacity-100 group-focus-within/mission-member:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate(
                'auto.components.sidebar.MissionStackActionsMenu.cd047f3f64',
                'Stack actions'
              )}
              disabled={busy}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </span>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAddingTask(true)}>
            {translate('auto.components.sidebar.MissionStackActionsMenu.aefbb3d1aa', 'Add task')}
          </DropdownMenuItem>
          {hasStack ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void runBusy(() => restackMissionRepo(mission.id, repoId))}
              >
                {translate('auto.components.sidebar.MissionStackActionsMenu.4c981beb64', 'Restack')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void absorb()}>
                {translate(
                  'auto.components.sidebar.MissionStackActionsMenu.1daa793591',
                  'Absorb preview edits'
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void createPullRequests()}>
                {translate(
                  'auto.components.sidebar.MissionStackActionsMenu.d1f2f963c2',
                  'Create pull requests'
                )}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <MissionAddTaskDialog
        mission={mission}
        repoId={repoId}
        repoName={repoName}
        open={addingTask}
        onOpenChange={setAddingTask}
      />
      <MissionAbsorbDialog
        mission={mission}
        repoId={repoId}
        hunks={ambiguousHunks}
        onResolved={handleAbsorbResult}
        onOpenChange={(open) => !open && setAmbiguousHunks(null)}
      />
    </>
  )
}
