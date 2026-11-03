/** Editor additions the fork makes: git blame, changed-line tints and language intelligence in diffs. */
export type EditorLineAnnotationSettings = {
  /** Language server, TS/ESLint diagnostics and line blame in diff views. Absent on older profiles; treated as on. */
  diffLanguageIntelligenceEnabled?: boolean
  /** Current-line git blame annotation. Absent on older profiles; treated as on. */
  editorGitLineBlameEnabled?: boolean
  /** Tints lines that differ from the git baseline in the regular (non-diff) editor view. */
  editorChangedLineHighlightsEnabled: boolean
}
