import type { Store } from '../../persistence/loading-store/store'
import type { CommitMessageAgentEnvironmentResolvers } from '../../text-generation/commit-message-agent-environment'
import { registerFilesystemHandlers } from '../filesystem/filesystem'
import { registerFilesystemWatcherHandlers } from '../filesystem/watchers/filesystem-watcher-handlers'
import { registerLspHandlers } from '../lsp'

/** File reads, watchers, and language servers for workspace files. */
export function registerWorkspaceFileHandlers(
  store: Store,
  commitMessageAgentEnv: CommitMessageAgentEnvironmentResolvers | undefined
): void {
  if (commitMessageAgentEnv) {
    registerFilesystemHandlers(store, commitMessageAgentEnv)
  } else {
    registerFilesystemHandlers(store)
  }
  registerFilesystemWatcherHandlers()
  registerLspHandlers(store)
}
