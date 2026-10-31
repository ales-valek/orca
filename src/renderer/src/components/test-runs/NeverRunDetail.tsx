import { translate } from '@/i18n/i18n'
import React from 'react'
import { Button } from '@/components/ui/button'
import type { TestLabel } from './test-results-grouping'
import { getRowTitlePath, type TestRow } from './test-rows'
import { TestLabels } from './TestResultsList'

/** A test Playwright lists but no run has recorded yet. */
export function NeverRunDetail({
  row,
  labels,
  onBack,
  onRun
}: {
  row: TestRow
  labels: TestLabel[]
  onBack: () => void
  onRun: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3 py-2 text-xs">
      <span className="font-medium">{getRowTitlePath(row).join(' › ')}</span>
      <span className="font-mono text-2xs text-muted-foreground">
        {row.catalog?.file}:{row.catalog?.line}
      </span>
      <TestLabels labels={labels} />
      <span className="text-muted-foreground">
        {translate('testRuns.neverRunHint', 'This test has not run yet.')}
      </span>
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={onBack}>
          {translate('testRuns.back', 'Back')}
        </Button>
        <Button size="xs" onClick={onRun}>
          {translate('testRuns.launch.runAgain', 'Run')}
        </Button>
      </div>
    </div>
  )
}
