import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { HulyConnectionInfo } from '../../../shared/huly/huly-types'
import { HulyConnectDialog } from './huly-connect-dialog'
import { formatHulyError } from './huly-error-copy'

/** Expired-token notice with a reconnect action; `onReconnected` re-runs the reads that failed. */
export function HulyReconnectNotice({
  onReconnected
}: {
  onReconnected: () => void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<HulyConnectionInfo | null>(null)

  const openDialog = async (): Promise<void> => {
    // The saved server and workspace survive an expired token; only the token is asked again.
    const status = await window.api.huly.status().catch(() => null)
    if (!mountedRef.current) {
      return
    }
    setInfo(status?.connected ? status.info : null)
    setOpen(true)
  }

  return (
    <div className="flex items-center gap-3">
      <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
        {formatHulyError(new Error('huly_auth_required'))}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void openDialog()}>
        {translate('auto.components.HulyReconnectNotice.reconnect', 'Reconnect Huly')}
      </Button>
      <HulyConnectDialog
        open={open}
        onOpenChange={setOpen}
        initialInfo={info}
        onConnected={onReconnected}
      />
    </div>
  )
}
