import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Milestone } from 'lucide-react'
import { HulyConnectDialog } from '@/components/huly-connect-dialog'
import { notifyHulyConnectionChanged } from '@/components/huly-connection-change-event'
import { formatHulyError } from '@/components/huly-error-copy'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { HulyConnectionStatus } from '../../../../shared/huly/huly-types'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { HulyProjectSettingsSection } from './HulyProjectSettingsSection'
import { HULY_INTEGRATION_SECTION_ID } from './task-provider-integration-section-ids'

export function HulyIntegrationCard(): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<HulyConnectionStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const checkStatus = useCallback(async (): Promise<void> => {
    setStatusError(null)
    try {
      const next = await window.api.huly.status()
      if (mountedRef.current) {
        setStatus(next)
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatus({ connected: false })
        setStatusError(formatHulyError(error))
      }
    }
  }, [mountedRef])

  useEffect(() => {
    void checkStatus()
  }, [checkStatus])

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.huly.disconnect()
      notifyHulyConnectionChanged()
      if (mountedRef.current) {
        setStatus({ connected: false })
        setAuthRequired(false)
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatusError(formatHulyError(error))
      }
    } finally {
      if (mountedRef.current) {
        setDisconnecting(false)
      }
    }
  }

  const checking = status === null
  const info = status?.connected ? status.info : null
  const description = info
    ? translate(
        'auto.components.settings.HulyIntegrationCard.connectedTo',
        'Connected to {{workspace}}',
        {
          workspace: info.workspace
        }
      )
    : checking
      ? translate(
          'auto.components.settings.HulyIntegrationCard.checking',
          'Checking Huly access before showing setup actions.'
        )
      : translate(
          'auto.components.settings.HulyIntegrationCard.description',
          'Create Missions from Huly milestones and write task status back to Huly.'
        )

  return (
    <IntegrationCardShell
      settingsSectionId={HULY_INTEGRATION_SECTION_ID}
      icon={<Milestone className="size-5" />}
      name="Huly"
      description={description}
      checking={checking}
      statusTone={info && !authRequired ? 'connected' : 'attention'}
      statusLabel={
        info
          ? authRequired
            ? translate(
                'auto.components.settings.HulyIntegrationCard.statusReconnect',
                'Reconnect needed'
              )
            : translate('auto.components.settings.HulyIntegrationCard.statusConnected', 'Connected')
          : translate(
              'auto.components.settings.HulyIntegrationCard.statusNotConnected',
              'Not connected'
            )
      }
      actions={
        checking ? null : info ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
          >
            {translate('auto.components.settings.HulyIntegrationCard.disconnect', 'Disconnect')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            {translate('auto.components.settings.HulyIntegrationCard.connect', 'Connect Huly')}
          </Button>
        )
      }
    >
      {checking ? null : (
        <IntegrationCardDetails>
          {statusError ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {statusError}
            </p>
          ) : null}
          {info ? (
            <>
              <p className="truncate font-mono text-xs text-muted-foreground">{info.serverUrl}</p>
              {authRequired ? (
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-xs text-destructive">
                    {formatHulyError('huly_auth_required')}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                    {translate(
                      'auto.components.settings.HulyIntegrationCard.reconnect',
                      'Reconnect'
                    )}
                  </Button>
                </div>
              ) : (
                <HulyProjectSettingsSection onAuthRequired={() => setAuthRequired(true)} />
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.HulyIntegrationCard.credentialCopy',
                'Connect with your Huly server URL, workspace, and an API token. The token is stored locally and encrypted when local runtime storage supports it.'
              )}
            </p>
          )}
        </IntegrationCardDetails>
      )}

      <HulyConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialInfo={info}
        onConnected={(next) => {
          setStatus(next)
          setStatusError(null)
          setAuthRequired(false)
        }}
      />
    </IntegrationCardShell>
  )
}
