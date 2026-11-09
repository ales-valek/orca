import { toast } from 'sonner'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import { joinPath } from '@/lib/path'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { useAppStore } from '@/store'

/** Opens a service URL in Orca's browser inside the worktree the service runs in. */
export function openDevEnvUrl(worktreeId: string, url: string): void {
  activateAndRevealWorktree(worktreeId, { providesInitialSurface: true })
  useAppStore.getState().createBrowserTab(worktreeId, url, { activate: true })
}

/** Service terminals live in their worktree, titled `<env>:<service>`. */
export function revealDevEnvWorktree(worktreeId: string): void {
  activateAndRevealWorktree(worktreeId)
}

export function openDevEnvFile(
  worktreeId: string,
  worktreePath: string,
  relativePath: string
): void {
  const filePath = joinPath(worktreePath, relativePath)
  activateAndRevealWorktree(worktreeId)
  useAppStore.getState().openFile({
    filePath,
    relativePath,
    worktreeId,
    runtimeEnvironmentId: null,
    language: detectLanguage(filePath),
    mode: 'edit'
  })
}

/** Runs a dev env call and turns a rejection into a toast instead of an unhandled error. */
export async function runDevEnvAction<T>(
  label: string,
  action: () => Promise<T>
): Promise<T | null> {
  try {
    return await action()
  } catch (error) {
    toast.error(label, { description: error instanceof Error ? error.message : String(error) })
    return null
  }
}
