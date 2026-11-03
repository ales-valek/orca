import type { editor } from 'monaco-editor'
import type { AppState } from '@/store/types'

/** Off returns diffs to Orca's plain Monaco: no language server, read-only diagnostics or line blame. */
export const selectDiffLanguageIntelligenceEnabled = (state: Pick<AppState, 'settings'>): boolean =>
  state.settings?.diffLanguageIntelligenceEnabled !== false

/** Read-only diff panes hide diagnostics by default; show them only with language intelligence on. */
export function getDiffValidationDecorationOptions(
  enabled: boolean
): Pick<editor.IDiffEditorConstructionOptions, 'renderValidationDecorations'> {
  return enabled ? { renderValidationDecorations: 'on' } : {}
}
