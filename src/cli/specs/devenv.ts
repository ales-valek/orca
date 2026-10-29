import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const ENV_SELECTOR_NOTE = 'Environment selectors accept the env id, key (e.g. kiosek) or name.'

function envCommand(
  name: string,
  summary: string,
  flags: string[] = [],
  extra: Partial<CommandSpec> = {}
): CommandSpec {
  const flagUsage = extra.usage ?? ''
  return {
    path: ['devenv', name],
    summary,
    usage: `orca devenv ${name} <env>${flagUsage} [--json]`,
    allowedFlags: [...GLOBAL_FLAGS, 'env', ...flags],
    positionalArgs: ['env'],
    notes: [ENV_SELECTOR_NOTE, ...(extra.notes ?? [])],
    ...(extra.examples ? { examples: extra.examples } : {})
  }
}

export const DEVENV_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['devenv', 'list'],
    summary: 'List Dev Environments with their state and port ranges',
    usage: 'orca devenv list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  envCommand('show', 'Show one Dev Environment: services, ports, URLs and setup state', [], {
    examples: ['orca devenv show kiosek', 'orca devenv show kiosek --json']
  }),
  envCommand(
    'setup',
    'Run the setup steps again (all, or one step / one slot)',
    ['step', 'slot', 'seed'],
    {
      usage: ' [--step ports|env|install|infra|data|seed] [--slot <slot>] [--seed]',
      notes: ['Setup runs in the background; follow it with `orca devenv show <env>`.']
    }
  ),
  envCommand('up', 'Start the services (all, or one) in dependency order', ['service'], {
    usage: ' [--service <name>]'
  }),
  envCommand('down', 'Stop the services (all, or one)', ['service'], {
    usage: ' [--service <name>]'
  }),
  envCommand('restart', 'Restart one service', ['service'], { usage: ' --service <name>' }),
  envCommand('url', 'Print the URL of one service', ['service'], { usage: ' --service <name>' }),
  envCommand('env', 'Print rendered env values with their source; secrets stay masked', ['file'], {
    usage: ' [--file <slot>/<path>]'
  }),
  envCommand('seed', 'Run the template seed command'),
  envCommand('reset', 'Drop and recreate this environment data', ['reseed', 'yes'], {
    usage: ' --yes [--reseed]',
    notes: ['Drops the environment databases and buckets; --yes confirms.']
  }),
  {
    path: ['devenv', 'mode'],
    summary: 'Switch between dev commands and prod-build commands',
    usage: 'orca devenv mode <env> dev|prod [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'env', 'mode'],
    positionalArgs: ['env', 'mode'],
    notes: [ENV_SELECTOR_NOTE, 'Stops the services; the next up runs the chosen commands.']
  },
  envCommand('snapshots', 'List the data snapshots of this environment'),
  envCommand('snapshot', 'Save this environment data as a named snapshot', ['name'], {
    usage: ' --name <name>',
    notes: ['Names use lowercase letters, digits and dashes; an existing name is overwritten.']
  }),
  envCommand('restore', 'Restore this environment data from a snapshot', ['name', 'yes'], {
    usage: ' --name <name> --yes',
    notes: ['Stops the services, restores, then starts the ones that were up; --yes confirms.']
  }),
  envCommand(
    'bind',
    'Pair a dependency with another local Dev Environment',
    ['dependency', 'provider'],
    {
      usage: ' --dependency <service> --provider <env>|none',
      notes: ['Only local environments can be providers here.']
    }
  ),
  {
    path: ['devenv', 'create'],
    summary: 'Create a Dev Environment for an existing mission or worktree from a template',
    usage:
      'orca devenv create (--mission <selector> | --worktree <selector>) --template <id|name> [--bind <service>=<env>...] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'worktree', 'template', 'bind'],
    repeatableFlags: ['bind'],
    notes: [
      'Setup starts right away; follow it with `orca devenv show <env>`.',
      '--bind pairs a dependency with another local environment (worktree environments only).'
    ],
    examples: [
      'orca devenv create --mission Kiosek --template "OrderMage full"',
      'orca devenv create --worktree branch:fix/OMP-3011 --template "Eshop only" --bind admin-api=kiosek'
    ]
  },
  {
    path: ['devenv', 'infra'],
    summary: 'Show, start or stop the shared Docker infra',
    usage: 'orca devenv infra status|up|down [--service <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'action', 'service'],
    positionalArgs: ['action']
  }
]
