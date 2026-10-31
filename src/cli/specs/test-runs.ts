import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const WORKSPACE_NOTE =
  'Runs in the workspace of the current folder; --worktree picks another. Target and source default like the Tests panel.'

export const TEST_RUN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['test', 'results'],
    summary: 'Show the latest result of each test run in this workspace',
    usage: 'orca test results [--failed] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'failed', 'worktree'],
    notes: [WORKSPACE_NOTE]
  },
  {
    path: ['test', 'list'],
    summary: 'List every test of the test source, as Playwright lists it',
    usage:
      'orca test list [--grep <text>] [--target <name>] [--source <label>] [--config <file>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'grep', 'target', 'source', 'config', 'worktree'],
    notes: [WORKSPACE_NOTE]
  },
  {
    path: ['test', 'run'],
    summary: 'Run tests through Orca: one run per environment, recorded in the Tests panel',
    usage:
      'orca test run [--filter <file:line|path>]... [--headed] [--target <name>] [--source <label>] [--config <file>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'filter', 'headed', 'target', 'source', 'config', 'worktree'],
    repeatableFlags: ['filter'],
    notes: [WORKSPACE_NOTE, 'Without --filter the whole suite runs.'],
    examples: [
      'orca test run --filter tests/eshop/tier-1/cart.spec.ts:12',
      'orca test run --filter tests/eshop/tier-1/ --headed'
    ]
  }
]
