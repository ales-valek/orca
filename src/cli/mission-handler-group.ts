import type { HandlerGroup } from './handler-group-manifest'

export const MISSION_HANDLER_GROUP: HandlerGroup = {
  name: 'mission',
  keys: [
    'mission list',
    'mission show',
    'mission current',
    'mission create',
    'mission session',
    'mission add-repo',
    'mission task add',
    'mission task rm',
    'mission restack',
    'mission absorb',
    'mission rm'
  ],
  load: async () => (await import('./handlers/mission.js')).MISSION_HANDLERS
}
