import React from 'react'
import { translate } from '@/i18n/i18n'
import type {
  HulyMissionRefreshDiff,
  HulyNonAppendableReason
} from '../../../../shared/huly/huly-mission-refresh'
import { HulyIssueLine, PLAN_SECTION_LABEL_CLASS } from './MissionHulyPlanStacks'

const REASON_COPY: Record<HulyNonAppendableReason, () => string> = {
  'inserted-in-middle': () =>
    translate(
      'auto.components.sidebar.MissionHulyRefreshDialog.insertedInMiddle',
      'Huly orders it below existing tasks, and stacks only grow on top.'
    ),
  'repo-not-in-mission': () =>
    translate(
      'auto.components.sidebar.MissionHulyRefreshDialog.repoNotInMission',
      'Its repository is not part of this Mission.'
    ),
  'blocked-cycle': () =>
    translate(
      'auto.components.sidebar.MissionHulyRefreshDialog.blockedCycle',
      'It is part of a blocked-by cycle.'
    ),
  unmapped: () =>
    translate(
      'auto.components.sidebar.MissionHulyRefreshDialog.unmapped',
      'Its component has no repository.'
    ),
  'blocked-by-pending': () =>
    translate(
      'auto.components.sidebar.MissionHulyRefreshDialog.blockedByPending',
      'It is blocked by an issue that cannot be appended.'
    )
}

export function getAppendableCount(diff: HulyMissionRefreshDiff): number {
  return diff.appendable.reduce((count, entry) => count + entry.issues.length, 0)
}

function isDiffEmpty(diff: HulyMissionRefreshDiff): boolean {
  return (
    getAppendableCount(diff) === 0 &&
    diff.reorderedInHuly.length === 0 &&
    diff.removed.length === 0 &&
    diff.movedRepo.length === 0 &&
    diff.nonAppendable.length === 0
  )
}

function DiffSection(props: {
  title: string
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-1.5">
      <h3 className={PLAN_SECTION_LABEL_CLASS}>{props.title}</h3>
      {props.note ? <p className="text-xs text-muted-foreground">{props.note}</p> : null}
      <ul className="divide-y divide-border rounded-md border border-border text-xs">
        {props.children}
      </ul>
    </section>
  )
}

function DiffRow(props: { identifier: string; detail: string }): React.JSX.Element {
  return (
    <li className="flex min-h-7 items-baseline gap-2 px-2 py-1">
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">{props.identifier}</span>
      <span className="min-w-0 flex-1">{props.detail}</span>
    </li>
  )
}

/** Refresh diff groups; each says what Orca leaves as it is. */
export function MissionHulyRefreshDiffView({
  diff,
  repoNameById
}: {
  diff: HulyMissionRefreshDiff
  repoNameById: ReadonlyMap<string, string>
}): React.JSX.Element {
  const repoName = (repoId: string | null): string =>
    repoId === null ? '' : (repoNameById.get(repoId) ?? repoId)
  if (isDiffEmpty(diff)) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.sidebar.MissionHulyRefreshDialog.noChanges',
          'Nothing new in Huly for this Mission.'
        )}
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {diff.appendable.map((entry) => (
        <DiffSection
          key={entry.repoId}
          title={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.appendable',
            'New tasks for {{repo}}',
            { repo: repoName(entry.repoId) }
          )}
        >
          {entry.issues.map((issue) => (
            <li key={issue.identifier}>
              <HulyIssueLine issue={issue} />
            </li>
          ))}
        </DiffSection>
      ))}
      {diff.nonAppendable.length > 0 ? (
        <DiffSection
          title={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.nonAppendable',
            'New issues that cannot be appended'
          )}
        >
          {diff.nonAppendable.map((entry) => (
            <DiffRow
              key={entry.identifier}
              identifier={entry.identifier}
              detail={REASON_COPY[entry.reason]()}
            />
          ))}
        </DiffSection>
      ) : null}
      {diff.reorderedInHuly.length > 0 ? (
        <DiffSection
          title={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.reordered',
            'Order changed in Huly'
          )}
          note={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.reorderedNote',
            'The stacks keep their order. Reorder the task layers by hand if needed.'
          )}
        >
          {diff.reorderedInHuly.map((entry) => (
            <DiffRow
              key={entry.repoId}
              identifier={repoName(entry.repoId)}
              detail={translate(
                'auto.components.sidebar.MissionHulyRefreshDialog.reorderedDetail',
                'Was {{before}}, now {{after}}',
                { before: entry.before.join(', '), after: entry.after.join(', ') }
              )}
            />
          ))}
        </DiffSection>
      ) : null}
      {diff.removed.length > 0 ? (
        <DiffSection
          title={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.removed',
            'No longer in the milestone'
          )}
          note={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.removedNote',
            'Their task layers stay in the Mission.'
          )}
        >
          {diff.removed.map((identifier) => (
            <DiffRow key={identifier} identifier={identifier} detail="" />
          ))}
        </DiffSection>
      ) : null}
      {diff.movedRepo.length > 0 ? (
        <DiffSection
          title={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.movedRepo',
            'Moved to another repository'
          )}
          note={translate(
            'auto.components.sidebar.MissionHulyRefreshDialog.movedRepoNote',
            'Their task layers stay in their current repository.'
          )}
        >
          {diff.movedRepo.map((entry) => (
            <DiffRow
              key={entry.identifier}
              identifier={entry.identifier}
              detail={translate(
                'auto.components.sidebar.MissionHulyRefreshDialog.movedRepoDetail',
                '{{from}} to {{to}}',
                { from: repoName(entry.fromRepoId), to: repoName(entry.toRepoId) }
              )}
            />
          ))}
        </DiffSection>
      ) : null}
    </div>
  )
}
