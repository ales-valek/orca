/** Editor line annotations the fork adds: git blame and changed-line tints. */
export type EditorLineAnnotationSettings = {
  /** Current-line git blame annotation. Absent on older profiles; treated as on. */
  editorGitLineBlameEnabled?: boolean
  /** Tints lines that differ from the git baseline in the regular (non-diff) editor view. */
  editorChangedLineHighlightsEnabled: boolean
}
