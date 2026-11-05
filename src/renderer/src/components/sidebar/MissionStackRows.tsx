import React, { useMemo, useState } from 'react'
import { RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { missionSlotErrorKey } from '@/store/slices/mission-stack-actions'
import type { MissionRestackLayer } from '../../../../shared/mission-layer-state'
import type { Mission, MissionSlot } from '../../../../shared/mission-types'
import { MissionLayerStateBadge } from './MissionLayerStateBadge'
import { formatMissionMemberError } from './mission-member-error-copy'
import {
  getMissionStackLayers,
  resolveMissionSlotWorktree,
  type MissionStackLayerView
} from './mission-stack-layers'
import WorktreeCard from './workspace-card/surface/WorktreeCard'

const EMPTY_REPORTS: never[] = []

/** One repo's stack, bottom-up: the member row, its task layers, then the preview. */
export function MissionStackRows({
  mission,
  repoId,
  repoName,
  renderMember
}: {
  mission: Mission
  repoId: string
  repoName: string
  /** The member row, built by the caller, with this layer's state badge slotted in. */
  renderMember: (stateBadge: React.ReactNode) => React.ReactNode
}): React.JSX.Element {
  const reports = useAppStore((s) => s.missionStackReports[mission.id] ?? EMPTY_REPORTS)
  const missionSlotErrors = useAppStore((s) => s.missionSlotErrors)
  const pushMissionStack = useAppStore((s) => s.pushMissionStack)
  const [pushing, setPushing] = useState(false)

  const layerBySlot = useMemo(() => {
    const report = reports.find((entry) => entry.repoId === repoId)
    return new Map<MissionSlot, MissionRestackLayer>(
      (report?.layers ?? []).map((layer) => [layer.slot, layer])
    )
  }, [reports, repoId])
  const previewTitle = translate('auto.components.sidebar.MissionStackRows.9414629caf', 'Preview')
  const layers = getMissionStackLayers(mission, repoId, previewTitle)
  const needsPush = [...layerBySlot.values()].some((layer) => layer.state === 'needs-push')
  const stackError = missionSlotErrors[missionSlotErrorKey(mission.id, repoId, 'member')]
  const statesOutdated = useAppStore((s) => s.missionStackReportsStale[mission.id] === true)

  const pushRewrittenLayers = async (): Promise<void> => {
    setPushing(true)
    try {
      const result = await pushMissionStack(mission.id, repoId)
      if (result && result.pushed.length > 0) {
        toast.success(
          translate(
            'components.missions.stack.pushedLayers',
            'Pushed {{count}} rewritten layers.',
            { count: result.pushed.length }
          )
        )
      }
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-mission-stack={repoId}>
      <div data-mission-slot="member" data-mission-layer-title={repoName}>
        {renderMember(<MissionLayerStateBadge layer={layerBySlot.get('member')} />)}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 pl-3">
        {layers.map((layer) => (
          <MissionStackLayerRow
            key={layer.slot}
            mission={mission}
            repoId={repoId}
            layer={layer}
            state={layerBySlot.get(layer.slot)}
            error={missionSlotErrors[missionSlotErrorKey(mission.id, repoId, layer.slot)]}
          />
        ))}
        {statesOutdated ? (
          <p className="px-2 text-2xs text-muted-foreground">
            {translate(
              'auto.components.sidebar.MissionStackRows.4721fec37a',
              'Layer states may be outdated.'
            )}
          </p>
        ) : null}
        {stackError ? (
          <p className="px-2 text-2xs break-words text-destructive">
            {formatMissionMemberError(stackError)}
          </p>
        ) : null}
        {needsPush ? (
          <div className="flex justify-end px-1 pb-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={pushing}
              onClick={() => void pushRewrittenLayers()}
            >
              <Upload className="size-3.5" />
              {pushing
                ? translate('auto.components.sidebar.MissionStackRows.1310031885', 'Pushing...')
                : translate(
                    'auto.components.sidebar.MissionStackRows.7f9fcbbbb2',
                    'Push rewritten layers'
                  )}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MissionStackLayerRow({
  mission,
  repoId,
  layer,
  state,
  error
}: {
  mission: Mission
  repoId: string
  layer: MissionStackLayerView
  state: MissionRestackLayer | undefined
  error: string | undefined
}): React.JSX.Element {
  const repo = useAppStore((s) => s.repos.find((entry) => entry.id === repoId))
  const allWorktrees = useAllWorktrees()
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const removeMissionTopTask = useAppStore((s) => s.removeMissionTopTask)
  const recreateMissionSlotWorktree = useAppStore((s) => s.recreateMissionSlotWorktree)
  const confirm = useConfirmationDialog()

  const record = layer.record
  const candidate = record?.worktreeId
    ? allWorktrees.find((worktree) => worktree.id === record.worktreeId)
    : undefined
  const worktree = record
    ? resolveMissionSlotWorktree(candidate, record, repoId, layer.branch)
    : undefined
  const shownError = error ?? record?.lastError ?? undefined
  const task = layer.task

  const removeTask = async (): Promise<void> => {
    if (!task) {
      return
    }
    const confirmed = await confirm({
      title: translate(
        'auto.components.sidebar.MissionStackRows.9b611165e0',
        'Remove task and delete workspace?'
      ),
      description: translate(
        'auto.components.sidebar.MissionStackRows.3ef7b62ac7',
        'This deletes the workspace of {{value0}}. Git work that cannot be deleted safely is preserved on its branch.',
        { value0: layer.title }
      ),
      confirmLabel: translate(
        'auto.components.sidebar.MissionStackRows.c47dd46ba2',
        'Delete workspace'
      ),
      confirmVariant: 'destructive'
    })
    if (confirmed) {
      await removeMissionTopTask(mission.id, repoId, task.id)
    }
  }

  return (
    <div
      className="group/mission-layer min-w-0"
      data-mission-slot={layer.slot}
      data-mission-layer-title={layer.title}
    >
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          {worktree ? (
            <WorktreeCard
              worktree={{ ...worktree, displayName: layer.title }}
              repo={repo}
              isActive={activeWorktreeId === worktree.id}
              onActivate={() => setActiveWorktree(worktree.id)}
              nativeDragEnabled={false}
              flushSurface
              hideRepoBadge
              // Why: Mission lifecycle owns removal of its in-root layer checkouts.
              affiliateListMode
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground">
              <span className="truncate">{layer.title}</span>
              <span className="min-w-0 truncate text-2xs text-muted-foreground/70">
                {translate(
                  'auto.components.sidebar.MissionStackRows.6739390591',
                  'Workspace missing'
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto shrink-0 text-muted-foreground"
                aria-label={translate('auto.components.sidebar.MissionList.d241d824cb', 'Recreate')}
                onClick={() => void recreateMissionSlotWorktree(mission.id, repoId, layer.slot)}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
        <MissionLayerStateBadge layer={state} />
        {/* Why: a fixed trailing width keeps layer badges aligned whether or not a row can be removed. */}
        <div className="flex w-6 shrink-0 justify-end">
          {task && layer.isTopTask ? (
            <span className="flex can-hover:opacity-0 transition-opacity group-hover/mission-layer:opacity-100 group-focus-within/mission-layer:opacity-100 focus-within:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={translate(
                  'auto.components.sidebar.MissionStackRows.a463ece8dd',
                  'Remove task'
                )}
                onClick={() => void removeTask()}
              >
                <X className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </div>
      </div>
      {shownError ? (
        <p className="truncate px-2 pb-1 text-2xs text-destructive" title={shownError}>
          {formatMissionMemberError(shownError)}
        </p>
      ) : null}
    </div>
  )
}
