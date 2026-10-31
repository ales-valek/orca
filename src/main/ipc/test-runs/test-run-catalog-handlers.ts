import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { TestCatalog } from '../../../shared/test-runs/test-catalog-types'
import { getRepoKey } from '../../../shared/test-runs/test-identity'
import {
  PLAYWRIGHT_CONFIG_FILE_PATTERN,
  type TestRunTarget
} from '../../../shared/test-runs/test-run-launch-types'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import type { Store } from '../../persistence'
import { TestCatalogs } from '../../test-runs/test-catalog'
import { getFeatureScope } from '../../test-runs/test-feature-scope'
import { generateTestSuggestions } from '../../test-runs/test-suggestions'
import type { createTestRunLaunchHandlers } from './test-run-launch-handlers'

const CatalogArgs = z.object({
  targetId: z.string().min(1),
  sourceId: z.string().min(1),
  configFile: z.string().regex(PLAYWRIGHT_CONFIG_FILE_PATTERN)
})
const FeatureScopeArgs = z.object({ sourceId: z.string().min(1) })
const SuggestArgs = CatalogArgs.extend({ worktreeId: z.string().min(1) })

function emptyCatalog(configFile: string, error: string): TestCatalog {
  return { sourceCommit: null, configFile, entries: [], error, builtAt: Date.now() }
}

async function readGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return (await gitExecFileAsync(args, { cwd })).stdout.trim() || null
  } catch {
    return null
  }
}

/** Test list, feature scope and suggestions: what to run, before running it. */
export function createTestRunCatalogHandlers(deps: {
  store: Store
  dir: string
  launches: ReturnType<typeof createTestRunLaunchHandlers>
}): {
  handlers: Record<string, (event: IpcMainInvokeEvent, args: unknown) => unknown>
  getCatalogById: (targetId: string, sourceId: string, configFile: string) => Promise<TestCatalog>
} {
  const { store, dir } = deps
  const { listTargets, listSources, prepareTestSource } = deps.launches
  const catalogs = new TestCatalogs()
  const suggestionCache = new Map<
    string,
    { suggestions: { identity: string; reason: string }[]; isListShortened: boolean }
  >()

  const getCatalog = async (
    target: { id: string; target: TestRunTarget },
    sourceId: string,
    configFile: string
  ): Promise<TestCatalog> => {
    const prepared = await prepareTestSource(
      { target: target.target, sourceId },
      undefined,
      join(dir, 'catalog.log'),
      { reuseCheckout: true }
    )
    if ('error' in prepared) {
      return emptyCatalog(configFile, prepared.error)
    }
    const [originUrl, commit, status, toplevel] = await Promise.all([
      readGit(['remote', 'get-url', 'origin'], prepared.cwd),
      readGit(['rev-parse', 'HEAD'], prepared.cwd),
      readGit(['status', '--porcelain'], prepared.cwd),
      readGit(['rev-parse', '--show-toplevel'], prepared.cwd)
    ])
    return catalogs.get({
      ...prepared,
      configFile,
      repoRoot: prepared.cwd,
      // Why toplevel: the reporter names a repo without origin by its real top-level folder.
      repoKey: getRepoKey({ root: toplevel ?? prepared.cwd, originUrl }),
      commit,
      isDirty: status !== null,
      cacheKey: `${sourceId}|${target.id}`
    })
  }

  const getCatalogById = async (
    targetId: string,
    sourceId: string,
    configFile: string
  ): Promise<TestCatalog> => {
    const target = listTargets().find((entry) => entry.id === targetId)
    return target
      ? getCatalog(target, sourceId, configFile)
      : emptyCatalog(configFile, 'This target no longer exists.')
  }

  const handlers: Record<string, (event: IpcMainInvokeEvent, args: unknown) => unknown> = {
    'testRuns:getCatalog': async (_event, raw) => {
      const { targetId, sourceId, configFile } = CatalogArgs.parse(raw)
      return getCatalogById(targetId, sourceId, configFile)
    },
    'testRuns:getFeatureScope': async (_event, raw) => {
      const { sourceId } = FeatureScopeArgs.parse(raw)
      const source = (await listSources()).find((entry) => entry.id === sourceId)
      return source?.kind === 'worktree'
        ? getFeatureScope({ path: source.path })
        : { baseCommit: null, since: null, changedSpecFiles: [], changedOtherFiles: [] }
    },
    'testRuns:suggest': async (_event, raw) => {
      const { worktreeId, targetId, sourceId, configFile } = SuggestArgs.parse(raw)
      const workspacePath = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
      const target = listTargets().find((entry) => entry.id === targetId)
      if (!workspacePath || !target) {
        return { error: 'This workspace or target no longer exists.' }
      }
      const scope = await getFeatureScope({ path: workspacePath })
      const changedFiles = [...scope.changedSpecFiles, ...scope.changedOtherFiles]
      if (changedFiles.length === 0) {
        return { error: 'This workspace has no changes against its default branch.' }
      }
      const catalog = await getCatalog(target, sourceId, configFile)
      if (catalog.entries.length === 0) {
        return { error: catalog.error ?? 'No tests to choose from.' }
      }
      const head = (await readGit(['rev-parse', 'HEAD'], workspacePath)) ?? 'uncommitted'
      const cacheKey = `${worktreeId}|${head}|${changedFiles.join(',')}|${catalog.sourceCommit}`
      const cached = suggestionCache.get(cacheKey)
      if (cached) {
        return cached
      }
      const diffStat =
        (await readGit(['diff', '--stat', `${scope.baseCommit ?? 'HEAD'}`], workspacePath)) ?? ''
      const result = await generateTestSuggestions({
        settings: store.getSettings(),
        cwd: workspacePath,
        changedFiles,
        diffStat,
        tests: catalog.entries.map((entry, index) => ({
          index,
          title: entry.titlePath.join(' › '),
          file: entry.file,
          tags: entry.tags
        }))
      })
      if ('error' in result) {
        return result
      }
      const response = {
        isListShortened: result.isListShortened,
        suggestions: result.suggestions.map((suggestion) => ({
          identity: catalog.entries[suggestion.index].identity,
          reason: suggestion.reason
        }))
      }
      suggestionCache.set(cacheKey, response)
      return response
    }
  }
  return { handlers, getCatalogById }
}
