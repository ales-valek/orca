/** Editor chrome persisted on global settings. Split out so GlobalSettings stays under the line cap. */
export type EditorChromeSettings = {
  editorAutoSave: boolean
  editorAutoSaveDelayMs: number
  editorMinimapEnabled: boolean
  /** Tints lines that differ from the git baseline in the regular (non-diff) editor view. */
  editorChangedLineHighlightsEnabled: boolean
  /** Current-line git blame annotation. Absent on older profiles; treated as on. */
  editorGitLineBlameEnabled?: boolean
  /** Opt-in code-editor font; empty (the default) keeps following `terminalFontFamily`. */
  editorFontFamily?: string
  /** Defaults on for profiles saved before file-editor wrapping became configurable. */
  editorWordWrap?: boolean
  /** Monaco editor theme for dark mode. Defaults to 'dark-modern'. */
  editorThemeDark?: string
  /** Monaco editor theme for light mode. Defaults to 'vs'. */
  editorThemeLight?: string
}
