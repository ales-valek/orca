import { useCallback } from 'react'
import { useHulyRead } from '../settings/use-huly-project-catalog'
import type { HulyMissionPlan } from '../../../../shared/huly/huly-mission-plan'
import type { HulyIssue, HulyMilestone } from '../../../../shared/huly/huly-types'

type PlanRequest = {
  project: string
  milestoneId: string
  repoOverrides: Record<string, string> | null
}

type PlanRead = { request: PlanRequest; milestone: HulyMilestone; plan: HulyMissionPlan }

export type HulyMilestonePlanState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | {
      state: 'ready'
      milestone: HulyMilestone
      /** Unmapped issues of the plan without overrides, so a picked issue keeps its picker. */
      unmapped: HulyIssue[]
      /** The plan with the picked repositories applied. */
      plan: HulyMissionPlan
      /** True while the plan for the latest picks is loading; `plan` is then the previous one. */
      pending: boolean
      planError: string | null
      retry: () => void
    }

function isRequest(read: PlanRead, request: PlanRequest): boolean {
  return (
    read.request.project === request.project &&
    read.request.milestoneId === request.milestoneId &&
    read.request.repoOverrides === request.repoOverrides
  )
}

async function readPlan(request: PlanRequest): Promise<PlanRead> {
  const result = await window.api.huly.getMilestonePlan({
    project: request.project,
    milestoneId: request.milestoneId,
    ...(request.repoOverrides ? { repoOverrides: request.repoOverrides } : {})
  })
  return { request, ...result }
}

/** Reads the milestone plan, then re-reads it with the repositories picked for unmapped issues. */
export function useHulyMilestonePlan(
  project: string | null,
  milestoneId: string | null,
  repoOverrides: Record<string, string>,
  onAuthRequired: () => void
): HulyMilestonePlanState {
  const hasOverrides = Object.keys(repoOverrides).length > 0
  const baseRead = useCallback(
    () => readPlan({ project: project ?? '', milestoneId: milestoneId ?? '', repoOverrides: null }),
    [project, milestoneId]
  )
  const overrideRead = useCallback(
    () => readPlan({ project: project ?? '', milestoneId: milestoneId ?? '', repoOverrides }),
    [project, milestoneId, repoOverrides]
  )
  const selected = project !== null && milestoneId !== null
  const base = useHulyRead(selected ? baseRead : null, onAuthRequired)
  const withOverrides = useHulyRead(selected && hasOverrides ? overrideRead : null, onAuthRequired)

  if (!selected) {
    return { state: 'idle' }
  }
  const baseRequest = { project, milestoneId, repoOverrides: null }
  if (base.result.state === 'error') {
    return { state: 'error', message: base.result.message, retry: base.retry }
  }
  if (base.result.state === 'loading' || !isRequest(base.result.value, baseRequest)) {
    return { state: 'loading' }
  }
  const baseValue = base.result.value
  const ready = {
    state: 'ready' as const,
    milestone: baseValue.milestone,
    unmapped: baseValue.plan.unmapped,
    retry: () => {
      base.retry()
      withOverrides.retry()
    }
  }
  if (!hasOverrides) {
    return { ...ready, plan: baseValue.plan, pending: false, planError: null }
  }
  const overridden = withOverrides.result
  if (overridden.state === 'error') {
    return { ...ready, plan: baseValue.plan, pending: false, planError: overridden.message }
  }
  if (
    overridden.state === 'ready' &&
    isRequest(overridden.value, { ...baseRequest, repoOverrides })
  ) {
    return { ...ready, plan: overridden.value.plan, pending: false, planError: null }
  }
  return { ...ready, plan: baseValue.plan, pending: true, planError: null }
}

export function useHulyMilestones(project: string | null, onAuthRequired: () => void) {
  const read = useCallback(
    () => window.api.huly.listMilestones({ project: project ?? '' }),
    [project]
  )
  return useHulyRead(project ? read : null, onAuthRequired)
}
