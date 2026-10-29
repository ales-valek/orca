import type { HandlerGroup } from './handler-group-manifest'

export const DEVENV_HANDLER_GROUP: HandlerGroup = {
  name: 'devenv',
  keys: [
    'devenv list',
    'devenv show',
    'devenv setup',
    'devenv up',
    'devenv down',
    'devenv restart',
    'devenv url',
    'devenv env',
    'devenv seed',
    'devenv reset',
    'devenv bind',
    'devenv infra',
    'devenv create',
    'devenv snapshots',
    'devenv snapshot',
    'devenv restore',
    'devenv delete-snapshot',
    'devenv mode'
  ],
  load: async () => (await import('./handlers/devenv.js')).DEVENV_HANDLERS
}
