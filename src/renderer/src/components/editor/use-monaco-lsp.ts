import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { getConnectionId } from '@/lib/workspace/ownership/connection-context'
import { attachMonacoLspDocument } from '@/lib/monaco-lsp/monaco-lsp-attach'

/** Attach the mounted editor's document to a local language server, when one
 *  exists for the language. Remote/SSH workspaces and surfaces without the lsp
 *  bridge silently get no LSP. */
export function useMonacoLsp(params: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  filePath: string
  language: string
  worktreeId: string | undefined
  liveTail: boolean
}): void {
  const { mountedEditor, filePath, language, worktreeId, liveTail } = params
  const worktreePath = useAppStore((s) =>
    worktreeId ? (findWorktreeById(s, worktreeId)?.path ?? null) : null
  )

  useEffect(() => {
    if (!mountedEditor || !worktreeId || !worktreePath || liveTail) {
      return
    }
    if (getConnectionId(worktreeId) !== null) {
      return
    }
    const model = mountedEditor.getModel()
    if (!model || model.isDisposed()) {
      return
    }
    return attachMonacoLspDocument({
      model,
      filePath,
      rootPath: worktreePath,
      worktreeId,
      languageId: language
    })
  }, [mountedEditor, filePath, language, worktreeId, worktreePath, liveTail])
}
