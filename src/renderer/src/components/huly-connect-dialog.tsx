import { useId, useLayoutEffect, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMountedRef } from '@/hooks/useMountedRef'
import { preventOutsideDismissWhenDirty } from '@/lib/outside-dismiss-guard'
import { translate } from '@/i18n/i18n'
import type { HulyConnectionInfo, HulyConnectionStatus } from '../../../shared/huly/huly-types'
import { formatHulyError } from './huly-error-copy'

type HulyConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (status: HulyConnectionStatus) => void
  /** Prefills the server and workspace when reconnecting; the token always starts empty. */
  initialInfo?: HulyConnectionInfo | null
}

export function HulyConnectDialog({
  open,
  onOpenChange,
  onConnected,
  initialInfo
}: HulyConnectDialogProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const serverUrlId = useId()
  const workspaceId = useId()
  const tokenId = useId()
  const errorId = useId()
  const [serverUrl, setServerUrl] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset before paint on each open so a previous token can never flash or persist.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    setServerUrl(initialInfo?.serverUrl ?? '')
    setWorkspace(initialInfo?.workspace ?? '')
    setToken('')
    setConnecting(false)
    setError(null)
  }, [open, initialInfo])

  const canSubmit =
    Boolean(serverUrl.trim()) && Boolean(workspace.trim()) && Boolean(token.trim()) && !connecting
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(() => token !== '')

  const handleConnect = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const status = await window.api.huly.connect({
        serverUrl: serverUrl.trim(),
        workspace: workspace.trim(),
        token: token.trim()
      })
      if (!mountedRef.current) {
        return
      }
      setToken('')
      setConnecting(false)
      onOpenChange(false)
      onConnected(status)
    } catch (connectError) {
      if (mountedRef.current) {
        setConnecting(false)
        setError(formatHulyError(connectError))
      }
    }
  }

  const clearError = (): void => setError(null)

  return (
    <Dialog open={open} onOpenChange={(next) => !connecting && onOpenChange(next)}>
      <DialogContent
        overlayClassName="z-[110]"
        className="z-[120] sm:max-w-md"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.HulyConnectDialog.title', 'Connect Huly')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.HulyConnectDialog.description',
              'Use your Huly server URL, workspace, and an API token to create Missions from milestones.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleConnect()
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor={serverUrlId}>
                {translate('auto.components.HulyConnectDialog.serverUrl', 'Server URL')}
              </Label>
              <Input
                id={serverUrlId}
                autoFocus={!initialInfo}
                placeholder={translate(
                  'auto.components.HulyConnectDialog.serverUrlPlaceholder',
                  'https://huly.app'
                )}
                value={serverUrl}
                onChange={(event) => {
                  setServerUrl(event.target.value)
                  clearError()
                }}
                disabled={connecting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={workspaceId}>
                {translate('auto.components.HulyConnectDialog.workspace', 'Workspace')}
              </Label>
              <Input
                id={workspaceId}
                placeholder={translate(
                  'auto.components.HulyConnectDialog.workspacePlaceholder',
                  'my-workspace'
                )}
                value={workspace}
                onChange={(event) => {
                  setWorkspace(event.target.value)
                  clearError()
                }}
                disabled={connecting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={tokenId}>
                {translate('auto.components.HulyConnectDialog.token', 'Token')}
              </Label>
              <Input
                id={tokenId}
                type="password"
                autoComplete="off"
                autoFocus={Boolean(initialInfo)}
                placeholder={translate(
                  'auto.components.HulyConnectDialog.tokenPlaceholder',
                  'Huly API token'
                )}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value)
                  clearError()
                }}
                disabled={connecting}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground/70">
              <Lock className="size-3 shrink-0" />
              {translate(
                'auto.components.HulyConnectDialog.storage',
                'Your token is stored locally and encrypted when local runtime storage supports it.'
              )}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={connecting}
            >
              {translate('auto.components.HulyConnectDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {connecting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate('auto.components.HulyConnectDialog.verifying', 'Verifying…')}
                </>
              ) : (
                translate('auto.components.HulyConnectDialog.connect', 'Connect')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
