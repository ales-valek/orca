import type { PreloadApi } from '../../../../preload/api-types'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { callRuntimeResult } from './web-runtime-calls'
import { resolveRuntimeFilePath } from './web-runtime-worktree-catalog'

type GitApi = NonNullable<Partial<PreloadApi>['git']>

/** Line blame over the runtime RPC, for the paired web client. */
export const webGitBlame: NonNullable<GitApi['blame']> = async ({
  worktreePath,
  filePath,
  revision,
  contentsSource
}) => {
  const file = await resolveRuntimeFilePath(filePath, worktreePath)
  return callRuntimeResult('git.blame', {
    worktree: toRuntimeWorktreeSelector(file.worktree.id),
    filePath: file.relativePath,
    ...(revision ? { revision } : {}),
    ...(contentsSource ? { contentsSource } : {})
  })
}
