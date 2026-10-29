import { translate } from '@/i18n/i18n'
import React, { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { DevEnvSummary } from '../../../../shared/dev-env/dev-env-types'
import { getDevEnvBadgeLabel } from './dev-env-labels'
import { DevEnvStatusDot } from './DevEnvStatusDot'

const SIDEBAR_POLL_MS = 10_000
const NO_ENVS: readonly DevEnvSummary[] = []

/** Partial stores in sidebar tests and stale renderers may lack the slice. */
function selectDevEnvs(state: { devEnvs?: readonly DevEnvSummary[] }): readonly DevEnvSummary[] {
  return state.devEnvs ?? NO_ENVS
}

/** The env a worktree belongs to: its own, or the mission env one of whose slots it fills. */
export { selectDevEnvs }

export function findDevEnvForWorktree(
  envs: readonly DevEnvSummary[],
  worktreeId: string
): DevEnvSummary | undefined {
  return (
    envs.find(
      (env) => env.attachment.kind === 'worktree' && env.attachment.worktreeId === worktreeId
    ) ??
    envs.find((env) =>
      Object.values(env.slotWorktrees).some((slot) => slot?.worktreeId === worktreeId)
    )
  )
}

/** Keeps sidebar badges current while any environment exists; one poll for the whole sidebar. */
export function useDevEnvSidebarRefresh(): void {
  const hasEnvs = useAppStore((s) => selectDevEnvs(s).length > 0)
  const fetchDevEnvs = useAppStore((s) => s.fetchDevEnvs)
  useEffect(() => {
    void fetchDevEnvs?.().catch(() => {})
  }, [fetchDevEnvs])
  useEffect(() => {
    if (!hasEnvs) {
      return
    }
    const timer = setInterval(() => void fetchDevEnvs?.().catch(() => {}), SIDEBAR_POLL_MS)
    return () => clearInterval(timer)
  }, [hasEnvs, fetchDevEnvs])
}

export function DevEnvStatusBadge({
  missionId,
  worktreeId
}: {
  missionId?: string
  worktreeId?: string
}): React.JSX.Element | null {
  const env = useAppStore((s) =>
    missionId
      ? selectDevEnvs(s).find(
          (entry) => entry.attachment.kind === 'mission' && entry.attachment.missionId === missionId
        )
      : worktreeId
        ? findDevEnvForWorktree(selectDevEnvs(s), worktreeId)
        : undefined
  )
  const openDevEnvsPage = useAppStore((s) => s.openDevEnvsPage)
  if (!env) {
    return null
  }
  const label = getDevEnvBadgeLabel(env.badge)
  return (
    <button
      type="button"
      title={translate('devEnv.badge.title', 'Dev Environment {name}').replace('{name}', env.name)}
      onClick={(event) => {
        event.stopPropagation()
        openDevEnvsPage(env.id)
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-3xs text-muted-foreground hover:bg-accent"
    >
      <DevEnvStatusDot tone={label.tone} className="size-1.5" />
      {label.text}
    </button>
  )
}
