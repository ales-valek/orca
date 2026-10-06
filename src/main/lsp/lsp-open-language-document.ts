import { pathToFileURL } from 'node:url'
import type { LspDiagnosticSession, LspOpenDocumentResult } from '../../shared/lsp-types'
import {
  resolveDiagnosticCompanionServers,
  resolveLspServerForLanguage
} from './lsp-server-catalog'
import type { LspServerDescriptor } from './lsp-server-catalog'

type OpenDocumentArgs = {
  filePath: string
  rootPath: string
  languageId: string
  text: string
}

/** Opens the language server, then any companion linters such as ESLint.
 *  A companion can still lint when the language server itself is missing. */
export async function openLanguageDocument(args: {
  document: OpenDocumentArgs
  noSession: LspOpenDocumentResult
  probe?: (command: string) => Promise<boolean>
  ensureDocument: (
    descriptor: LspServerDescriptor,
    document: OpenDocumentArgs
  ) => Promise<LspOpenDocumentResult>
}): Promise<LspOpenDocumentResult> {
  const descriptor = await resolveLspServerForLanguage(args.document.languageId, args.probe)
  const primary = descriptor ? await args.ensureDocument(descriptor, args.document) : args.noSession
  const diagnosticSessions = await openDiagnosticSessions(args, primary.serverId)
  if (primary.sessionId) {
    return { ...primary, diagnosticSessions }
  }
  const fallback = diagnosticSessions[0]
  if (!fallback) {
    return args.noSession
  }
  return {
    sessionId: fallback.sessionId,
    fileUri: pathToFileURL(args.document.filePath).toString(),
    serverId: fallback.serverId,
    pullDiagnostics: fallback.pullDiagnostics,
    diagnosticSessions: diagnosticSessions.slice(1)
  }
}

async function openDiagnosticSessions(
  args: {
    document: OpenDocumentArgs
    probe?: (command: string) => Promise<boolean>
    ensureDocument: (
      descriptor: LspServerDescriptor,
      document: OpenDocumentArgs
    ) => Promise<LspOpenDocumentResult>
  },
  skipServerId: string | null
): Promise<LspDiagnosticSession[]> {
  const descriptors = await resolveDiagnosticCompanionServers(args.document.languageId, args.probe)
  const sessions: LspDiagnosticSession[] = []
  for (const descriptor of descriptors) {
    if (descriptor.serverId === skipServerId) {
      continue
    }
    const opened = await args.ensureDocument(descriptor, args.document)
    if (!opened.sessionId || !opened.serverId) {
      continue
    }
    sessions.push({
      sessionId: opened.sessionId,
      serverId: opened.serverId,
      pullDiagnostics: opened.pullDiagnostics
    })
  }
  return sessions
}
