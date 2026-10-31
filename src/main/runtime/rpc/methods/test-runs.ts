import {
  TestRunsListParams,
  TestRunsResultsParams,
  TestRunsRunParams
} from '../../../../shared/rpc-contract/test-runs-params'
import { isTestRunLaunch } from '../../../../shared/test-runs/test-run-launch-types'
import { getTestResultState } from '../../../../shared/test-runs/test-result-state'
import { getTestRunServices, pickTestRunDefaults } from '../../../test-runs/test-run-services'
import { defineMethod, type RpcContext } from '../core'

async function resolveWorkspace(context: RpcContext, worktree: string) {
  const services = getTestRunServices()
  const { id } = await context.runtime.showManagedWorktree(worktree)
  const [targets, sources] = [services.listTargets(), await services.listSources()]
  return { services, worktreeId: id, targets, sources }
}

async function resolveChoices(
  context: RpcContext,
  params: { worktree: string; target?: string; source?: string; config?: string }
) {
  const workspace = await resolveWorkspace(context, params.worktree)
  const { targetId, sourceId } = pickTestRunDefaults({
    targets: workspace.targets,
    sources: workspace.sources,
    worktreeId: workspace.worktreeId,
    devEnvId: workspace.services.getDevEnvIdForWorktree(workspace.worktreeId),
    target: params.target,
    source: params.source
  })
  const target = workspace.targets.find((option) => option.id === targetId)
  const source = workspace.sources.find((option) => option.id === sourceId)
  if (!target || !source) {
    throw new Error('No test target or test source; create a Dev Environment or a preset first.')
  }
  const configFile = params.config ?? source.configFiles[0] ?? 'playwright.config.ts'
  return { ...workspace, target, source, configFile }
}

export const testRunsResultsMethod = defineMethod({
  name: 'testRuns.results',
  permission: 'workspace',
  params: TestRunsResultsParams,
  handler: async (params, context) => {
    const { services, worktreeId } = await resolveWorkspace(context, params.worktree)
    const results = services
      .getLatestResults(worktreeId)
      .filter((entry) => !params.failed || getTestResultState(entry.result) === 'failed')
      .map((entry) => ({
        status: entry.result.status,
        title: entry.result.titlePath.join(' › '),
        location: `${entry.result.file}:${entry.result.line}`,
        trigger: entry.run.trigger,
        startedAt: entry.run.startedAt,
        error: entry.result.error?.message ?? null
      }))
    return { results }
  }
})

export const testRunsListMethod = defineMethod({
  name: 'testRuns.list',
  permission: 'workspace',
  params: TestRunsListParams,
  handler: async (params, context) => {
    const choices = await resolveChoices(context, params)
    const catalog = await choices.services.getCatalog(
      choices.target.id,
      choices.source.id,
      choices.configFile
    )
    const grep = params.grep?.toLowerCase()
    const tests = catalog.entries
      .map((entry) => ({
        title: entry.titlePath.join(' › '),
        location: `${entry.file}:${entry.line}`,
        project: entry.project,
        tags: entry.tags
      }))
      .filter((test) => !grep || `${test.title} ${test.location}`.toLowerCase().includes(grep))
    return {
      target: choices.target.label,
      source: choices.source.label,
      tests,
      error: catalog.error
    }
  }
})

export const testRunsRunMethod = defineMethod({
  name: 'testRuns.run',
  permission: 'workspace',
  params: TestRunsRunParams,
  handler: async (params, context) => {
    const choices = await resolveChoices(context, params)
    const launch = choices.services.launch({
      target: choices.target.target,
      sourceId: choices.source.id,
      configFile: choices.configFile,
      selection:
        params.filters.length > 0 ? { kind: 'paths', paths: params.filters } : { kind: 'all' },
      headed: params.headed === true,
      worktreeId: choices.worktreeId
    })
    if (!isTestRunLaunch(launch)) {
      throw new Error(launch.error)
    }
    return launch
  }
})

export const TEST_RUN_METHODS = [testRunsResultsMethod, testRunsListMethod, testRunsRunMethod]
