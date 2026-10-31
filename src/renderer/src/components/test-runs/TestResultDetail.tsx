import { translate } from '@/i18n/i18n'
import React, { useEffect, useState } from 'react'
import { ArrowLeft, FileSearch, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TestAttachmentRecord } from '../../../../shared/test-runs/test-run-types'
import { openDevEnvUrl, runDevEnvAction } from '../dev-env/dev-env-actions'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { getTestResultState, type TestLabel, type TestResultEntry } from './test-results-grouping'
import { TEST_STATE_TONE, TestLabels, getRunAge, getTriggerLabel } from './TestResultsList'
import { useTestHistory } from './use-test-runs'

function ArtifactMedia({
  runId,
  attachment
}: {
  runId: string
  attachment: TestAttachmentRecord
}): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let isCurrent = true
    void window.api.testRuns.getArtifactUrl({ runId, file: attachment.file }).then((result) => {
      if (isCurrent && 'url' in result) {
        setUrl(result.url)
      }
    })
    return () => {
      isCurrent = false
    }
  }, [runId, attachment.file])
  if (!url) {
    return null
  }
  return attachment.contentType.startsWith('video/') ? (
    <video src={url} controls className="w-full rounded-md border border-border" />
  ) : (
    <img src={url} alt={attachment.name} className="w-full rounded-md border border-border" />
  )
}

function History({ history }: { history: TestResultEntry[] | null }): React.JSX.Element | null {
  if (!history || history.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {translate('testRuns.history', 'History')}
      </span>
      <span className="flex flex-wrap gap-1">
        {history.map((entry) => (
          <span
            key={entry.run.id}
            title={`${getRunAge(entry.run.startedAt)} · ${getTriggerLabel(entry.run.trigger)}`}
          >
            <DevEnvStatusDot tone={TEST_STATE_TONE[getTestResultState(entry.result)]} />
          </span>
        ))}
      </span>
    </div>
  )
}

export function TestResultDetail({
  entry,
  traceWorktreeId,
  labels,
  onBack,
  onRun
}: {
  entry: TestResultEntry
  labels: TestLabel[]
  /** Workspace whose browser tabs receive the trace viewer. */
  traceWorktreeId: string | null
  onBack: () => void
  onRun?: () => void
}): React.JSX.Element {
  const { result, run } = entry
  const history = useTestHistory(result.identity)
  // Why from history: the result list leaves test output out.
  const output = history?.find((item) => item.run.id === run.id)?.result
  const media = result.attachments.filter(
    (attachment) =>
      attachment.contentType.startsWith('image/') || attachment.contentType.startsWith('video/')
  )
  const trace = result.attachments.find((attachment) => attachment.name === 'trace')
  const openTrace = (file: string): void =>
    void runDevEnvAction(
      translate('testRuns.traceFailed', 'Could not open the trace'),
      async () => {
        if (!traceWorktreeId) {
          throw new Error(
            translate('testRuns.traceNeedsWorkspace', 'Open a workspace to view the trace in.')
          )
        }
        const opened = await window.api.testRuns.openTrace({ runId: run.id, file })
        if ('error' in opened) {
          throw new Error(opened.error)
        }
        openDevEnvUrl(traceWorktreeId, opened.url)
      }
    )

  return (
    <div className="flex flex-col gap-3 px-2 py-2 text-xs">
      <div className="flex items-start gap-2">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onBack}
          aria-label={translate('testRuns.back', 'Back')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 font-medium">
            <DevEnvStatusDot tone={TEST_STATE_TONE[getTestResultState(result)]} />
            <span className="min-w-0 break-words">{result.titlePath.join(' › ')}</span>
          </span>
          <span className="font-mono text-2xs text-muted-foreground">
            {result.file}:{result.line}
          </span>
          <span className="text-2xs text-muted-foreground">
            {getRunAge(run.startedAt)} · {getTriggerLabel(run.trigger)}
            {run.repo.commit ? ` · ${run.repo.commit.slice(0, 7)}` : ''}
            {result.retry > 0
              ? ` · ${translate('testRuns.retry', 'retry {{retry}}', { retry: result.retry })}`
              : ''}
          </span>
          <TestLabels labels={labels} />
        </div>
      </div>
      {result.error ? (
        <pre className="scrollbar-sleek max-h-60 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap text-destructive">
          {result.error.message}
          {result.error.location ? `\n\n${result.error.location}` : ''}
        </pre>
      ) : null}
      <div className="flex gap-1.5">
        {onRun ? (
          <Button size="xs" variant="outline" onClick={onRun}>
            <Play className="size-3.5" />
            {translate('testRuns.launch.runAgain', 'Run again')}
          </Button>
        ) : null}
        {trace ? (
          <Button size="xs" variant="outline" onClick={() => openTrace(trace.file)}>
            <FileSearch className="size-3.5" />
            {translate('testRuns.openTrace', 'Open trace')}
          </Button>
        ) : null}
      </div>
      {media.map((attachment) => (
        <ArtifactMedia key={attachment.file} runId={run.id} attachment={attachment} />
      ))}
      <History history={history} />
      {output && (output.stdout || output.stderr) ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            {translate('testRuns.output', 'Output')}
          </summary>
          <pre className="scrollbar-sleek mt-1 max-h-60 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap">
            {output.stdout}
            {output.stderr}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
