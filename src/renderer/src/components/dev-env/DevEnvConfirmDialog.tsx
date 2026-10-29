import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
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

/** Destructive confirm; with `typedKey` the user must type it before confirming. */
export function DevEnvConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  typedKey,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  confirmLabel: string
  typedKey?: string
  onConfirm: (typed: string) => void
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const close = (next: boolean): void => {
    setTyped('')
    onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {typedKey ? (
          <Input
            autoFocus
            value={typed}
            placeholder={typedKey}
            aria-label={translate('devEnv.confirm.typeKey', 'Type the environment key')}
            onChange={(event) => setTyped(event.target.value)}
            variant="code"
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {translate('devEnv.confirm.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={typedKey !== undefined && typed !== typedKey}
            onClick={() => {
              onConfirm(typed)
              close(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
