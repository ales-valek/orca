import { translate } from '@/i18n/i18n'
import React from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type {
  TestRunLaunch,
  TestRunLaunchState
} from '../../../../shared/test-runs/test-run-launch-types'
import type { DevEnvTone } from '../dev-env/dev-env-labels'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { getRunAge } from './TestResultsList'
import { useTestRunLaunchLog } from './use-test-run-launches'

const ACTIVE_STATES: TestRunLaunchState[] = ['queued', 'preparing', 'running']

const STATE_TONE: Record<TestRunLaunchState, DevEnvTone> = {
  queued: 'muted',
  preparing: 'info',
  running: 'info',
  passed: 'ok',
  failed: 'error',
  stopped: 'muted',
  error: 'error'
}

function getStateLabel(state: TestRunLaunchState): string {
  switch (state) {
    case 'queued':
      return translate('testRuns.launch.state.queued', 'Waiting for the environment')
    case 'preparing':
      return translate('testRuns.launch.state.preparing', 'Preparing')
    case 'running':
      return translate('testRuns.launch.state.running', 'Running')
    case 'passed':
      return translate('testRuns.launch.state.passed', 'Passed')
    case 'failed':
      return translate('testRuns.launch.state.failed', 'Failed')
    case 'stopped':
      return translate('testRuns.launch.state.stopped', 'Stopped')
    case 'error':
      return translate('testRuns.launch.state.error', 'Could not run')
  }
}

function getWaitLabel(waitingFor: { trigger: string; pid: number }): string {
  switch (waitingFor.trigger) {
    case 'agent':
      return translate(
        'testRuns.launch.waitingForAgent',
        'Waiting for an agent run (pid {{pid}})',
        {
          pid: waitingFor.pid
        }
      )
    case 'orca':
      return translate('testRuns.launch.waitingForOrca', 'Waiting for another Orca run')
    default:
      return translate('testRuns.launch.waitingForUser', 'Waiting for your run (pid {{pid}})', {
        pid: waitingFor.pid
      })
  }
}

function LaunchRow({ launch }: { launch: TestRunLaunch }): React.JSX.Element {
  const isActive = ACTIVE_STATES.includes(launch.state)
  const log = useTestRunLaunchLog(launch.id, isActive)
  return (
    <details className="group px-3 py-1 text-xs" open={isActive || launch.state === 'error'}>
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <DevEnvStatusDot tone={STATE_TONE[launch.state]} />
        <span className="min-w-0 flex-1 truncate">
          {launch.title} · {launch.targetLabel}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {launch.state === 'queued' && launch.waitingFor
            ? getWaitLabel(launch.waitingFor)
            : getStateLabel(launch.state)}{' '}
          · {getRunAge(launch.startedAt)}
        </span>
        {isActive ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={translate('testRuns.launch.stop', 'Stop')}
            onClick={(event) => {
              event.preventDefault()
              void window.api.testRuns.stopLaunch({ id: launch.id })
            }}
          >
            <Square className="size-3" />
          </Button>
        ) : null}
      </summary>
      {launch.error ? <p className="mt-1 text-2xs text-destructive">{launch.error}</p> : null}
      {log ? (
        <pre className="scrollbar-sleek mt-1 max-h-48 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap">
          {log}
        </pre>
      ) : null}
    </details>
  )
}

/** The workspace's launches from Orca, with their live output. */
export function TestRunLaunches({
  launches
}: {
  launches: TestRunLaunch[]
}): React.JSX.Element | null {
  if (launches.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col border-b border-border py-1">
      {launches.slice(0, 5).map((launch) => (
        <LaunchRow key={launch.id} launch={launch} />
      ))}
    </div>
  )
}
