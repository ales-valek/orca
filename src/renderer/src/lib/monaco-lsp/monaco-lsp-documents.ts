import type { IDisposable, editor } from 'monaco-editor'
import type { LspDiagnosticSession } from '../../../../shared/lsp-types'
import { monaco } from '@/lib/editor/monaco/monaco-setup'
import { lspDiagnosticsToMonacoMarkers, lspPullDiagnosticsToItems } from './lsp-monaco-conversion'
import { clearLspMarkerLayers, publishLspSessionMarkers } from './lsp-marker-layers'
import { setLspFileStatus } from './monaco-lsp-status'

// Why: batch keystrokes into one didChange without letting hover/completion
// requests observe text older than this window (providers flush first).
const CHANGE_DEBOUNCE_MS = 250

export type LspDocumentEntry = {
  sessionId: string
  fileUri: string
  filePath: string
  rootPath: string
  worktreeId: string
  serverId: string | null
  /** True when the server never pushes publishDiagnostics (tsgo/TS7 model);
   *  we request textDocument/diagnostic after open and after each sync. */
  pullDiagnostics: boolean
  diagnosticSessions: readonly LspDiagnosticSession[]
  model: editor.ITextModel
  refCount: number
  changeTimer: ReturnType<typeof setTimeout> | null
  // Why: providers await this before requesting so the server saw the latest text.
  lastSync: Promise<void>
  contentListener: IDisposable
}

const entriesByModelUri = new Map<string, LspDocumentEntry>()
// Why: one server document can back several models at once (editor tab + diff
// pane of the same file), so diagnostics routing must fan out, not overwrite.
const entriesBySessionDocument = new Map<string, Set<LspDocumentEntry>>()

function sessionDocumentKey(sessionId: string, fileUri: string): string {
  return `${sessionId} ${fileUri}`
}

function registerSessionDocumentEntry(entry: LspDocumentEntry, sessionId = entry.sessionId): void {
  const key = sessionDocumentKey(sessionId, entry.fileUri)
  const entries = entriesBySessionDocument.get(key) ?? new Set()
  entries.add(entry)
  entriesBySessionDocument.set(key, entries)
}

function unregisterSessionDocumentEntry(entry: LspDocumentEntry): void {
  const sessionIds = [
    entry.sessionId,
    ...entry.diagnosticSessions.map((session) => session.sessionId)
  ]
  for (const sessionId of sessionIds) {
    const key = sessionDocumentKey(sessionId, entry.fileUri)
    const entries = entriesBySessionDocument.get(key)
    entries?.delete(entry)
    if (entries?.size === 0) {
      entriesBySessionDocument.delete(key)
    }
  }
}

function syncTargets(entry: LspDocumentEntry): { sessionId: string; pullDiagnostics: boolean }[] {
  return [
    { sessionId: entry.sessionId, pullDiagnostics: entry.pullDiagnostics },
    ...entry.diagnosticSessions
  ]
}

async function pullDiagnosticsNow(entry: LspDocumentEntry, sessionId: string): Promise<void> {
  try {
    const result = await window.api.lsp.request({
      sessionId,
      method: 'textDocument/diagnostic',
      params: { textDocument: { uri: entry.fileUri } }
    })
    const items = lspPullDiagnosticsToItems(result)
    // Why: entry may have closed while the request was in flight.
    if (
      items &&
      !entry.model.isDisposed() &&
      entriesByModelUri.get(entry.model.uri.toString()) === entry
    ) {
      publishLspSessionMarkers(
        monaco,
        entry.model,
        sessionId,
        lspDiagnosticsToMonacoMarkers(items, monaco.MarkerSeverity)
      )
    }
  } catch {
    // A dead or slow server must never break editing; markers just go stale.
  }
}

async function syncDocumentText(entry: LspDocumentEntry, text: string): Promise<void> {
  for (const target of syncTargets(entry)) {
    await window.api.lsp.changeDocument({
      sessionId: target.sessionId,
      fileUri: entry.fileUri,
      text
    })
    if (target.pullDiagnostics) {
      await pullDiagnosticsNow(entry, target.sessionId)
    }
  }
}

function sendChangeNow(entry: LspDocumentEntry): void {
  if (entry.changeTimer !== null) {
    clearTimeout(entry.changeTimer)
    entry.changeTimer = null
  }
  if (entry.model.isDisposed()) {
    return
  }
  const text = entry.model.getValue()
  entry.lastSync = entry.lastSync.then(() => syncDocumentText(entry, text)).catch(() => {})
}

export async function openLspDocumentForModel(params: {
  model: editor.ITextModel
  filePath: string
  rootPath: string
  worktreeId: string
  languageId: string
}): Promise<LspDocumentEntry | null> {
  const { model, filePath, rootPath, worktreeId, languageId } = params
  const modelUri = model.uri.toString()
  const existing = entriesByModelUri.get(modelUri)
  if (existing) {
    existing.refCount++
    return existing
  }
  setLspFileStatus(filePath, { state: 'starting', serverId: null })
  const openedText = model.getValue()
  let opened: {
    sessionId: string | null
    fileUri: string | null
    serverId?: string | null
    pullDiagnostics?: boolean
    diagnosticSessions?: readonly LspDiagnosticSession[]
  }
  try {
    opened = await window.api.lsp.openDocument({
      filePath,
      rootPath,
      languageId,
      text: openedText
    })
  } catch {
    setLspFileStatus(filePath, null)
    return null
  }
  if (!opened?.sessionId || !opened.fileUri) {
    setLspFileStatus(filePath, null)
    return null
  }
  // Why: an unmount+remount can race the async open; refcount the late entry too.
  const raced = entriesByModelUri.get(modelUri)
  if (raced) {
    raced.refCount++
    const sessionIds = [
      opened.sessionId,
      ...(opened.diagnosticSessions ?? []).map((session) => session.sessionId)
    ]
    for (const sessionId of sessionIds) {
      void window.api.lsp.closeDocument({ sessionId, fileUri: opened.fileUri }).catch(() => {})
    }
    return raced
  }
  const entry: LspDocumentEntry = {
    sessionId: opened.sessionId,
    fileUri: opened.fileUri,
    filePath,
    rootPath,
    worktreeId,
    serverId: opened.serverId ?? null,
    pullDiagnostics: opened.pullDiagnostics === true,
    diagnosticSessions: opened.diagnosticSessions ?? [],
    model,
    refCount: 1,
    changeTimer: null,
    lastSync: Promise.resolve(),
    contentListener: model.onDidChangeContent(() => {
      if (entry.changeTimer !== null) {
        clearTimeout(entry.changeTimer)
      }
      entry.changeTimer = setTimeout(() => sendChangeNow(entry), CHANGE_DEBOUNCE_MS)
    })
  }
  entriesByModelUri.set(modelUri, entry)
  registerSessionDocumentEntry(entry)
  for (const session of entry.diagnosticSessions) {
    registerSessionDocumentEntry(entry, session.sessionId)
  }
  setLspFileStatus(filePath, { state: 'running', serverId: entry.serverId })
  // Why: keystrokes during the open round-trip predate the change listener;
  // re-sync when the buffer moved so the server isn't pinned to stale text.
  if (!model.isDisposed() && model.getValue() !== openedText) {
    sendChangeNow(entry)
  }
  for (const target of syncTargets(entry)) {
    if (target.pullDiagnostics) {
      void pullDiagnosticsNow(entry, target.sessionId)
    }
  }
  return entry
}

export function flushPendingLspChange(entry: LspDocumentEntry): Promise<void> {
  if (entry.changeTimer !== null) {
    sendChangeNow(entry)
  }
  return entry.lastSync
}

export function getLspEntryForModelUri(modelUri: string): LspDocumentEntry | null {
  return entriesByModelUri.get(modelUri) ?? null
}

export function getLspEntriesForSessionDocument(
  sessionId: string,
  fileUri: string
): LspDocumentEntry[] {
  return [...(entriesBySessionDocument.get(sessionDocumentKey(sessionId, fileUri)) ?? [])]
}

export function closeLspDocumentForModel(
  modelUri: string,
  clearMarkers: (model: editor.ITextModel) => void
): void {
  const entry = entriesByModelUri.get(modelUri)
  if (!entry) {
    return
  }
  entry.refCount--
  if (entry.refCount > 0) {
    return
  }
  entriesByModelUri.delete(modelUri)
  unregisterSessionDocumentEntry(entry)
  setLspFileStatus(entry.filePath, null)
  entry.contentListener.dispose()
  if (entry.changeTimer !== null) {
    clearTimeout(entry.changeTimer)
    entry.changeTimer = null
  }
  if (!entry.model.isDisposed()) {
    clearLspMarkerLayers(monaco, entry.model)
    clearMarkers(entry.model)
  }
  const sessionIds = [
    entry.sessionId,
    ...entry.diagnosticSessions.map((session) => session.sessionId)
  ]
  for (const sessionId of sessionIds) {
    void window.api.lsp.closeDocument({ sessionId, fileUri: entry.fileUri }).catch(() => {})
  }
}
