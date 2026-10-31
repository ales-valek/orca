import type { HandlerGroup } from './handler-group-manifest'

export const TEST_RUN_HANDLER_GROUP: HandlerGroup = {
  name: 'test',
  keys: ['test results', 'test list', 'test run'],
  load: async () => (await import('./handlers/test-runs.js')).TEST_RUN_HANDLERS
}
