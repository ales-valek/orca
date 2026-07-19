import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function getFolderWorkspacePrimaryActionLabel(t: Translate = translate): string {
  return t('auto.components.sidebar.FolderWorkspaceComposerDialog.create', 'Open shared workspace')
}

export function getFolderWorkspaceCheckoutNotice(t: Translate = translate): string {
  return t(
    'auto.components.sidebar.FolderWorkspaceComposerDialog.sharedCheckoutNotice',
    'Uses the existing checkouts in this folder. Branches and file changes are shared with other workspaces; Orca does not create isolated worktrees for each repository.'
  )
}
