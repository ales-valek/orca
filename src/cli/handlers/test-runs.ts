import type { TestRunLaunch } from '../../shared/test-runs/test-run-launch-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag } from '../flags'
import { printResult } from '../format'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
import {
  formatTestLaunch,
  formatTestList,
  formatTestResults,
  type TestResultLine
} from '../test-runs-format'

async function worktree(ctx: HandlerContext): Promise<string> {
  return (
    (await getOptionalWorktreeSelector(ctx.flags, 'worktree', ctx.cwd, ctx.client)) ??
    (await resolveCurrentWorktreeSelector(ctx.cwd, ctx.client))
  )
}

function choices(ctx: HandlerContext): { target?: string; source?: string; config?: string } {
  return {
    target: getOptionalStringFlag(ctx.flags, 'target'),
    source: getOptionalStringFlag(ctx.flags, 'source'),
    config: getOptionalStringFlag(ctx.flags, 'config')
  }
}

export const TEST_RUN_HANDLERS: Record<string, CommandHandler> = {
  'test results': async (ctx) => {
    const result = await ctx.client.call<{ results: TestResultLine[] }>('testRuns.results', {
      worktree: await worktree(ctx),
      ...(ctx.flags.get('failed') === true ? { failed: true } : {})
    })
    printResult(result, ctx.json, formatTestResults)
  },
  'test list': async (ctx) => {
    const result = await ctx.client.call<{
      tests: { title: string; location: string }[]
      error: string | null
    }>('testRuns.list', {
      worktree: await worktree(ctx),
      ...choices(ctx),
      grep: getOptionalStringFlag(ctx.flags, 'grep')
    })
    printResult(result, ctx.json, formatTestList)
  },
  'test run': async (ctx) => {
    const result = await ctx.client.call<TestRunLaunch>('testRuns.run', {
      worktree: await worktree(ctx),
      ...choices(ctx),
      // Why: Playwright reads filters as regular expressions, where a Windows \\ is an escape.
      filters: getRepeatedStringFlag(ctx.flags, 'filter').map((filter) =>
        filter.replaceAll('\\', '/')
      ),
      ...(ctx.flags.get('headed') === true ? { headed: true } : {})
    })
    printResult(result, ctx.json, formatTestLaunch)
  }
}
