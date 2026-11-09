import { useId, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import { CloseTerminalGroupList } from '../../CloseTerminalGroupList'

export type CloseTerminalDialogCopyKind = 'command' | 'agent' | 'chat-agent'

export type CloseTerminalDialogTerminal = {
  key: string
  label: string
  copyKind: CloseTerminalDialogCopyKind
}

export default function CloseTerminalDialog({
  open,
  copyKind = 'command',
  tabLabel,
  subjectKey,
  terminals,
  onCancel,
  onConfirm
}: {
  open: boolean
  copyKind?: CloseTerminalDialogCopyKind
  /** Name off-focus tab-strip/middle-click targets; omit for focused-pane keyboard closes. */
  tabLabel?: string
  /** Changing queued subject clears the previous tab’s opt-out without reopening the dialog. */
  subjectKey?: string
  terminals?: CloseTerminalDialogTerminal[]
  onCancel: () => void
  onConfirm: (dontAskAgain: boolean) => void
}): React.JSX.Element {
  const checkboxId = useId()
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [previousOpen, setPreviousOpen] = useState(open)
  const [previousSubjectKey, setPreviousSubjectKey] = useState(subjectKey)

  // Reset each new confirmation before paint to avoid flashing the previous opt-out.
  if (open !== previousOpen) {
    setPreviousOpen(open)
    if (open) {
      setDontAskAgain(false)
      setExpanded(false)
    }
  }

  // Queued subjects change without reopening; ignore closing-to-undefined so the checkbox cannot flash during exit.
  if (subjectKey !== previousSubjectKey) {
    setPreviousSubjectKey(subjectKey)
    if (subjectKey !== undefined) {
      setDontAskAgain(false)
      setExpanded(false)
    }
  }

  const trimmedTabLabel = tabLabel?.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel()
        }
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <CloseTerminalDialogBody
          copyKind={copyKind}
          trimmedTabLabel={trimmedTabLabel}
          terminals={terminals}
          expanded={expanded}
          setExpanded={setExpanded}
          checkboxId={checkboxId}
          dontAskAgain={dontAskAgain}
          setDontAskAgain={setDontAskAgain}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  )
}

// Keep translation and element construction behind the dialog portal's mount boundary.
function CloseTerminalDialogBody({
  copyKind,
  trimmedTabLabel,
  terminals,
  expanded,
  setExpanded,
  checkboxId,
  dontAskAgain,
  setDontAskAgain,
  onCancel,
  onConfirm
}: {
  copyKind: CloseTerminalDialogCopyKind
  trimmedTabLabel: string | undefined
  terminals: CloseTerminalDialogTerminal[] | undefined
  expanded: boolean
  setExpanded: (value: boolean) => void
  checkboxId: string
  dontAskAgain: boolean
  setDontAskAgain: (value: boolean) => void
  onCancel: () => void
  onConfirm: (dontAskAgain: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const isAgent = copyKind !== 'command'
  const isChat = copyKind === 'chat-agent'
  const displayedTabLabel = terminals
    ? trimmedTabLabel || t('components.tabCluster.unnamed', 'Unnamed group')
    : trimmedTabLabel
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-sm">
          {isAgent
            ? terminals
              ? t(
                  'auto.components.terminal.pane.CloseTerminalDialog.stop_agents_title',
                  'Stop these agents?'
                )
              : t(
                  'auto.components.terminal.pane.CloseTerminalDialog.stop_agent_title',
                  'Stop this agent?'
                )
            : terminals
              ? t(
                  'auto.components.terminal.pane.CloseTerminalDialog.stop_commands_title',
                  'Stop running commands?'
                )
              : t(
                  'auto.components.terminal.pane.CloseTerminalDialog.stop_command_title',
                  'Stop running command?'
                )}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {terminals
            ? t(
                'auto.components.terminal.pane.CloseTerminalDialog.stop_group_description',
                'Closing this group will stop {{count}} running terminals.',
                {
                  count: terminals.length,
                  defaultValue_one: 'Closing this group will stop {{count}} running terminal.'
                }
              )
            : isChat
              ? t(
                  'auto.components.terminal.pane.CloseTerminalDialog.stop_chat_description',
                  "Closing this chat will stop the agent's current work."
                )
              : isAgent
                ? t(
                    'auto.components.terminal.pane.CloseTerminalDialog.stop_agent_description',
                    "Closing this terminal will stop the agent's current work."
                  )
                : t(
                    'auto.components.terminal.pane.CloseTerminalDialog.stop_command_description',
                    'Closing this terminal will stop the command running inside it.'
                  )}
        </DialogDescription>
      </DialogHeader>
      {copyKind === 'agent' ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'auto.components.terminal.pane.CloseTerminalDialog.automatic_resume_warning',
            'This terminal will not resume automatically. Cancel and put the workspace to sleep to resume it later.'
          )}
        </p>
      ) : null}
      {displayedTabLabel ? (
        <p className="truncate text-xs font-medium text-foreground" title={displayedTabLabel}>
          {displayedTabLabel}
        </p>
      ) : null}
      {terminals ? (
        <CloseTerminalGroupList
          terminals={terminals}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={dontAskAgain}
          onCheckedChange={(checked) => setDontAskAgain(checked === true)}
        />
        <Label htmlFor={checkboxId} className="text-xs font-normal text-muted-foreground">
          {isChat
            ? t('auto.components.confirmation.dialog.92bac3217e', "Don't ask again")
            : t(
                'auto.components.terminal.pane.CloseTerminalDialog.dont_ask_again',
                "Don't ask again for running terminals"
              )}
        </Label>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('auto.components.terminal.pane.CloseTerminalDialog.1d1a7a9c1f', 'Cancel')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          autoFocus
          onClick={() => onConfirm(dontAskAgain)}
        >
          {isAgent
            ? t(
                'auto.components.terminal.pane.CloseTerminalDialog.stop_agent_confirm',
                'Stop Agent'
              )
            : t(
                'auto.components.terminal.pane.CloseTerminalDialog.stop_command_confirm',
                'Stop and Close'
              )}
        </Button>
      </DialogFooter>
    </>
  )
}
