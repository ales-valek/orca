import { translate } from '@/i18n/i18n'
import React from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TestRunSelection } from '../../../../shared/test-runs/test-run-launch-types'
import type { TestRunLaunchControls } from './use-test-run-launches'

/** Target, source and headed choice, with the panel's "run failed" and "run all" actions. */
export function TestRunLaunchBar({
  controls,
  failedSelection,
  configFile
}: {
  controls: TestRunLaunchControls
  failedSelection: TestRunSelection | null
  configFile?: string
}): React.JSX.Element {
  const { targets, sources, choices, setChoices, launch } = controls
  const target = targets?.find((option) => option.id === choices.targetId)
  if (targets !== null && sources !== null && (targets.length === 0 || sources.length === 0)) {
    return (
      <p className="px-3 py-2 text-2xs text-muted-foreground">
        {targets.length === 0
          ? translate(
              'testRuns.launch.noTargets',
              'Create a Dev Environment or a test-run preset to run tests from Orca.'
            )
          : translate(
              'testRuns.launch.noSources',
              'No repo with a Playwright config is added to Orca.'
            )}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2 text-xs">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-muted-foreground">
          {translate('testRuns.launch.target', 'Target')}
        </span>
        <Select
          value={choices.targetId ?? undefined}
          onValueChange={(targetId) => setChoices({ targetId })}
        >
          <SelectTrigger size="sm" className="w-full min-w-0">
            <SelectValue placeholder={translate('testRuns.launch.pickTarget', 'Target…')} />
          </SelectTrigger>
          <SelectContent>
            {(targets ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.isShared
                  ? translate('testRuns.launch.sharedTarget', '{{name}} (shared)', {
                      name: option.label
                    })
                  : option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">
          {translate('testRuns.launch.source', 'Tests')}
        </span>
        <Select
          value={choices.sourceId ?? undefined}
          onValueChange={(sourceId) => setChoices({ sourceId })}
        >
          <SelectTrigger size="sm" className="w-full min-w-0">
            <SelectValue placeholder={translate('testRuns.launch.pickSource', 'Test source…')} />
          </SelectTrigger>
          <SelectContent>
            {(sources ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {target?.isShared ? (
        <p className="text-2xs text-muted-foreground">
          {translate(
            'testRuns.launch.sharedHint',
            'Shared environment: only runs from this computer wait for each other.'
          )}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-1.5 text-muted-foreground">
          <Checkbox
            checked={choices.headed}
            onCheckedChange={(checked) => setChoices({ headed: checked === true })}
          />
          {translate('testRuns.launch.headed', 'Visible browser')}
        </label>
        <Button
          size="xs"
          variant="outline"
          disabled={!failedSelection}
          onClick={() => failedSelection && launch(failedSelection, configFile)}
        >
          {translate('testRuns.launch.runFailed', 'Run failed')}
        </Button>
        <Button size="xs" onClick={() => launch({ kind: 'all' }, configFile)}>
          <Play className="size-3" />
          {translate('testRuns.launch.runAll', 'Run all')}
        </Button>
      </div>
    </div>
  )
}
