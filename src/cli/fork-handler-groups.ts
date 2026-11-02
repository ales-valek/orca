import type { HandlerGroup } from './handler-group-manifest'
import { DEVENV_HANDLER_GROUP } from './devenv-handler-group'
import { MISSION_HANDLER_GROUP } from './mission-handler-group'
import { TEST_RUN_HANDLER_GROUP } from './test-runs-handler-group'

/** CLI groups for fork-only features, kept out of the upstream manifest list. */
export const FORK_HANDLER_GROUPS: readonly HandlerGroup[] = [
  MISSION_HANDLER_GROUP,
  DEVENV_HANDLER_GROUP,
  TEST_RUN_HANDLER_GROUP
]
