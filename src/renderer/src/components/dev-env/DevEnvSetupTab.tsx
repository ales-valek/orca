import React, { useEffect, useState } from 'react'
import { RotateCw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DevEnvDetail, DevEnvStepId } from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { formatDevEnvDuration, getDevEnvSetupRows, getDevEnvStepTone, t } from './dev-env-labels'
import { DevEnvStatusDot } from './DevEnvStatusDot'

function StepLog({
  env,
  step,
  running
}: {
  env: string
  step: DevEnvStepId
  running: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void window.api.devEnv.readLog({ env, step }).then((log) => {
        if (!cancelled) {
          setText(log)
        }
      })
    }
    load()
    // Why: a running step streams into its log file; keep the drawer current.
    const timer = running ? setInterval(load, 1500) : null
    return () => {
      cancelled = true
      if (timer) {
        clearInterval(timer)
      }
    }
  }, [env, step, running])
  return (
    <pre className="scrollbar-sleek max-h-64 overflow-auto bg-muted/40 px-4 py-2 font-mono text-xs whitespace-pre-wrap">
      {text || t('setup.emptyLog', 'No output yet.')}
    </pre>
  )
}

export function DevEnvSetupTab({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const [openLog, setOpenLog] = useState<DevEnvStepId | null>(null)
  const rows = getDevEnvSetupRows(detail)
  const run = (step?: DevEnvStepId): void => {
    void runDevEnvAction(t('setup.runFailed', 'Could not start setup'), () =>
      window.api.devEnv.setup({ env: detail.key, ...(step ? { step } : {}) })
    )
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center">
        <span className="flex-1 text-sm font-semibold">
          {t('setup.title', 'Setup')} · {detail.name}
        </span>
        <Button variant="outline" size="sm" disabled={detail.setupRunning} onClick={() => run()}>
          <RotateCw className="size-4" />
          {t('setup.runAll', 'Run full setup again')}
        </Button>
      </div>
      <div className="rounded-xl border border-border">
        {rows.map((row) => (
          <div key={row.step} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <DevEnvStatusDot tone={getDevEnvStepTone(row.status)} />
              <span
                className={cn('w-52 shrink-0', row.status === 'pending' && 'text-muted-foreground')}
              >
                {row.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {row.detail ?? ''}
              </span>
              <span className="w-12 text-right text-xs text-muted-foreground">
                {row.durationMs !== undefined ? formatDevEnvDuration(row.durationMs) : ''}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setOpenLog(openLog === row.step ? null : row.step)}
              >
                <ScrollText />
                {t('setup.log', 'Log')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={!row.canRerun}
                onClick={() => run(row.step)}
              >
                <RotateCw />
                {t('setup.rerun', 'Re-run')}
              </Button>
            </div>
            {row.error ? (
              <div
                className={cn(
                  'mx-4 mb-2 rounded-md border px-3 py-2 text-xs',
                  row.error.startsWith('Port ')
                    ? 'border-status-warning-border bg-status-warning-background'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                )}
              >
                {row.error}
              </div>
            ) : null}
            {openLog === row.step ? (
              <StepLog env={detail.key} step={row.step} running={row.status === 'running'} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
