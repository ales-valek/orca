import React, { useEffect, useState } from 'react'
import { Eye, FileCode, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DevEnvDetail, DevEnvEnvFileView } from '../../../../shared/dev-env/dev-env-types'
import { openDevEnvFile, runDevEnvAction } from './dev-env-actions'
import { t } from './dev-env-labels'
import { DevEnvSectionLabel } from './DevEnvInfraList'

type FileValue = DevEnvEnvFileView['values'][number]

function getSourceLabel(value: FileValue, file: DevEnvEnvFileView): string {
  if (value.section === 'LOCAL') {
    return t('env.local', 'LOCAL · manual')
  }
  if (value.section === 'STATIC') {
    return t('env.static', 'base file')
  }
  return value.sources.join(' · ') || file.path
}

function ValueCell({
  detail,
  file,
  value
}: {
  detail: DevEnvDetail
  file: DevEnvEnvFileView
  value: FileValue
}): React.JSX.Element {
  const [revealed, setRevealed] = useState<string | null>(null)
  if (!value.secret) {
    return <span className="break-all">{value.value}</span>
  }
  return (
    <span className="flex items-center gap-1">
      <span className={revealed === null ? 'text-muted-foreground' : 'break-all'}>
        {revealed ?? value.value}
      </span>
      {revealed === null ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void runDevEnvAction(t('env.revealFailed', 'Could not reveal'), async () =>
              setRevealed(
                await window.api.devEnv.revealSecret({
                  env: detail.key,
                  slot: file.slot,
                  path: file.path,
                  key: value.key
                })
              )
            )
          }
        >
          <Eye />
          {t('env.reveal', 'Reveal')}
        </Button>
      ) : null}
    </span>
  )
}

export function DevEnvEnvTab({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const [files, setFiles] = useState<DevEnvEnvFileView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const renderedAt = detail.setup.env?.finishedAt
  useEffect(() => {
    let cancelled = false
    void runDevEnvAction(t('env.loadFailed', 'Could not read env files'), async () => {
      const result = await window.api.devEnv.env({ env: detail.key })
      if (!cancelled) {
        setFiles(result.files)
      }
    })
    return () => {
      cancelled = true
    }
  }, [detail.key, renderedAt])

  const current = files.find((file) => `${file.slot}/${file.path}` === selected) ?? files[0]
  const slots = [...new Set(files.map((file) => file.slot))]
  if (!current) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t('env.none', 'This template renders no env files.')}
      </p>
    )
  }
  const worktree = detail.slotWorktrees[current.slot]
  return (
    <div className="flex min-h-[300px]">
      <div className="w-64 shrink-0 border-r border-border p-2">
        {slots.map((slot) => (
          <div key={slot}>
            <DevEnvSectionLabel>{detail.slotWorktrees[slot]?.label ?? slot}</DevEnvSectionLabel>
            {files
              .filter((file) => file.slot === slot)
              .map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelected(`${file.slot}/${file.path}`)}
                  className={cn(
                    'block w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent',
                    file === current ? 'bg-accent' : 'text-muted-foreground'
                  )}
                >
                  {file.path}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="flex-1 truncate font-mono text-xs">
            {current.slot}/{current.path}
          </span>
          {worktree ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => openDevEnvFile(worktree.worktreeId, worktree.path, current.path)}
            >
              <FileCode />
              {t('env.openInEditor', 'Open in editor')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void runDevEnvAction(t('env.renderFailed', 'Could not render'), () =>
                window.api.devEnv.setup({ env: detail.key, step: 'env' })
              )
            }
          >
            <RefreshCw />
            {t('env.rerender', 'Render again')}
          </Button>
        </div>
        {current.error ? (
          <p className="px-4 py-2 text-xs text-destructive">{current.error}</p>
        ) : null}
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-1.5 font-medium">{t('env.key', 'Key')}</th>
              <th className="px-2 py-1.5 font-medium">{t('env.value', 'Value')}</th>
              <th className="px-4 py-1.5 font-medium">{t('env.source', 'Source')}</th>
            </tr>
          </thead>
          <tbody>
            {current.values.map((value) => (
              <tr key={`${value.section}:${value.key}`} className="border-b border-border">
                <td className="px-4 py-1">{value.key}</td>
                <td className="px-2 py-1">
                  <ValueCell detail={detail} file={current} value={value} />
                </td>
                <td className="px-4 py-1">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-3xs text-muted-foreground">
                    {getSourceLabel(value, current)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
