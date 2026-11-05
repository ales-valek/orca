import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { editor } from 'monaco-editor'
import type { MarkdownDocument } from '../../../../shared/filesystem-entry-types'
import type { GitDiffResult } from '../../../../shared/git/diff/git-diff-compare-types'
import {
  clearMarkdownDocCompletionDocuments,
  setMarkdownDocCompletionDocuments
} from './markdown-source-tools/monaco/monaco-markdown-doc-completions'
import type { MarkdownDocLinkDecorationController } from './markdown-source-tools/monaco/monaco-markdown-doc-link-decorations'
import { buildGitConflictDecorations } from './monaco-conflict-decorations'
import { buildChangedLineDecorations } from './monaco-changed-line-decorations'

export const CHANGED_LINE_DECORATION_DEBOUNCE_MS = 150

export type MonacoEditorDecorations = {
  markdownDocLinkDecorationsRef: MutableRefObject<MarkdownDocLinkDecorationController | null>
  conflictDecorationsRef: MutableRefObject<editor.IEditorDecorationsCollection | null>
  changedLineDecorationsRef: MutableRefObject<editor.IEditorDecorationsCollection | null>
  updateMarkdownCompletionDocuments: () => void
}

// Keep model-owned decorations together so swaps and unmounts release their resources.
export function useMonacoEditorDecorations(params: {
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  mountedEditor: editor.IStandaloneCodeEditor | null
  content: string
  language: string
  markdownDocuments: MarkdownDocument[] | undefined
  conflictDecorationsEnabled: boolean
  changedLineDecorationsEnabled: boolean
  diffContent?: GitDiffResult
}): MonacoEditorDecorations {
  const {
    editorRef,
    mountedEditor,
    content,
    language,
    markdownDocuments,
    conflictDecorationsEnabled,
    changedLineDecorationsEnabled,
    diffContent
  } = params

  const completionOwnerRef = useRef(Symbol('markdown-completion'))
  const completionModelRef = useRef<editor.ITextModel | null>(null)
  const markdownDocLinkDecorationsRef = useRef<MarkdownDocLinkDecorationController | null>(null)
  const conflictDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const changedLineDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const changedLineDecorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateMarkdownCompletionDocuments = useCallback((): void => {
    const model = editorRef.current?.getModel() ?? null
    if (completionModelRef.current && completionModelRef.current !== model) {
      clearMarkdownDocCompletionDocuments(completionModelRef.current, completionOwnerRef.current)
    }
    completionModelRef.current = model
    if (!model) {
      return
    }
    if (language === 'markdown' && markdownDocuments) {
      setMarkdownDocCompletionDocuments(model, markdownDocuments, completionOwnerRef.current)
    } else {
      clearMarkdownDocCompletionDocuments(model, completionOwnerRef.current)
    }
  }, [editorRef, language, markdownDocuments])

  // The controller observes content edits; only language swaps lack that event and need this explicit refresh.
  useEffect(() => {
    markdownDocLinkDecorationsRef.current?.refresh()
  }, [language])

  useEffect(() => {
    const ed = mountedEditor
    if (!ed) {
      return
    }

    if (!conflictDecorationsEnabled) {
      conflictDecorationsRef.current?.clear()
      return
    }

    // Why: conflict markers are ordinary file text, so Monaco needs explicit decorations to keep unresolved blocks visible.
    const decorations = buildGitConflictDecorations(content)
    if (decorations.length === 0) {
      conflictDecorationsRef.current?.clear()
      return
    }
    if (!conflictDecorationsRef.current) {
      conflictDecorationsRef.current = ed.createDecorationsCollection(decorations)
      return
    }
    conflictDecorationsRef.current.set(decorations)
  }, [conflictDecorationsEnabled, content, mountedEditor])

  useEffect(() => {
    const ed = mountedEditor
    const clearPendingRecompute = (): void => {
      if (changedLineDecorationTimerRef.current !== null) {
        clearTimeout(changedLineDecorationTimerRef.current)
        changedLineDecorationTimerRef.current = null
      }
    }

    if (!ed || !changedLineDecorationsEnabled) {
      clearPendingRecompute()
      changedLineDecorationsRef.current?.clear()
      return
    }

    // Why: buildChangedLineDecorations reruns a full LCS diff, so debounce it
    // instead of recomputing on every keystroke of a large file.
    clearPendingRecompute()
    changedLineDecorationTimerRef.current = setTimeout(() => {
      changedLineDecorationTimerRef.current = null
      const decorations = buildChangedLineDecorations(diffContent, content)
      if (!changedLineDecorationsRef.current) {
        changedLineDecorationsRef.current = ed.createDecorationsCollection(decorations)
        return
      }
      changedLineDecorationsRef.current.set(decorations)
    }, CHANGED_LINE_DECORATION_DEBOUNCE_MS)

    return clearPendingRecompute
  }, [changedLineDecorationsEnabled, content, diffContent, mountedEditor])

  useEffect(() => {
    updateMarkdownCompletionDocuments()
  }, [updateMarkdownCompletionDocuments])

  useEffect(() => {
    const completionOwner = completionOwnerRef.current
    return () => {
      if (completionModelRef.current) {
        clearMarkdownDocCompletionDocuments(completionModelRef.current, completionOwner)
      }
      markdownDocLinkDecorationsRef.current?.dispose()
      markdownDocLinkDecorationsRef.current = null
      conflictDecorationsRef.current?.clear()
      conflictDecorationsRef.current = null
      changedLineDecorationsRef.current?.clear()
      changedLineDecorationsRef.current = null
    }
  }, [])

  return {
    markdownDocLinkDecorationsRef,
    conflictDecorationsRef,
    changedLineDecorationsRef,
    updateMarkdownCompletionDocuments
  }
}
