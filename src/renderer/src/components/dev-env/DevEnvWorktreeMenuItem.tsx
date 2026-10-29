import { translate } from '@/i18n/i18n'
import React from 'react'
import { Container } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { findDevEnvForWorktree, selectDevEnvs } from './DevEnvStatusBadge'

/** Shown only for a worktree outside every Dev Environment, once a template exists. */
export function DevEnvWorktreeMenuItem({
  worktreeId,
  disabled
}: {
  worktreeId: string
  disabled: boolean
}): React.JSX.Element | null {
  const isInEnv = useAppStore((s) => Boolean(findDevEnvForWorktree(selectDevEnvs(s), worktreeId)))
  // Why: partial stores in sidebar tests and stale renderers may lack the dev env settings.
  const hasTemplates = useAppStore((s) => (s.settings?.devEnvTemplates ?? []).length > 0)
  const openModal = useAppStore((s) => s.openModal)
  if (isInEnv || !hasTemplates) {
    return null
  }
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => openModal('dev-env-create-worktree', { worktreeId })}
    >
      <Container className="size-3.5" />
      {translate('devEnv.create.menuItem', 'Create Dev Environment…')}
    </DropdownMenuItem>
  )
}
