import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const MISSION_SELECTOR_NOTE =
  'Mission selectors accept id:<id>, name:<name>, or a bare Mission id or name.'
const REPO_SELECTOR_NOTE =
  '--repo repeats; each value is a registered repo selector such as id:<id>, name:<name>, or path:<path>.'
const SETUP_HOOK_NOTE =
  'If ~/.orca/hooks/mission-setup is executable it runs in the Mission root afterwards, logging to .orca-mission-setup.log.'

export const MISSION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mission', 'list'],
    summary: 'List Missions',
    usage: 'orca mission list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['mission', 'show'],
    summary: 'Show one Mission with its member worktrees',
    usage: 'orca mission show <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission'],
    positionalArgs: ['mission'],
    notes: [MISSION_SELECTOR_NOTE],
    examples: ['orca mission show referral', 'orca mission show id:<missionId> --json']
  },
  {
    path: ['mission', 'current'],
    summary: 'Show the Mission whose root or member worktree contains the current directory',
    usage: 'orca mission current [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['mission', 'create'],
    summary: 'Create a Mission root with one worktree per repo on a shared branch',
    usage:
      'orca mission create --name <name> --repo <selector> [--repo <selector>...] [--branch <branch>] [--agent <agent>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'repo', 'branch', 'agent'],
    repeatableFlags: ['repo'],
    notes: [
      REPO_SELECTOR_NOTE,
      '--branch defaults to a branch derived from the Mission name.',
      '--agent picks the agent auto-launched when the Mission session first opens.',
      SETUP_HOOK_NOTE
    ],
    examples: [
      'orca mission create --name referral --repo name:api --repo name:web',
      'orca mission create --name referral --repo id:<repoId> --branch mission/referral --agent claude --json'
    ]
  },
  {
    path: ['mission', 'session'],
    summary: 'Open the Mission root session and print its folder selector for terminals',
    usage: 'orca mission session <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Idempotent. Use the printed selector with `orca terminal create --worktree folder:<id>` to run a terminal in the Mission root.'
    ],
    examples: [
      'orca mission session referral',
      'orca terminal create --worktree "folder:$(orca mission session referral --json | jq -r .result.folderId)" --command claude'
    ]
  },
  {
    path: ['mission', 'add-repo'],
    summary: 'Add repos to a Mission, creating their worktrees on the Mission branch',
    usage: 'orca mission add-repo <selector> --repo <selector> [--repo <selector>...] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'repo'],
    repeatableFlags: ['repo'],
    positionalArgs: ['mission'],
    notes: [MISSION_SELECTOR_NOTE, REPO_SELECTOR_NOTE, SETUP_HOOK_NOTE],
    examples: ['orca mission add-repo referral --repo name:mobile']
  },
  {
    path: ['mission', 'rm'],
    destructive: true,
    summary: 'Delete a Mission and its member worktrees',
    usage: 'orca mission rm <selector> [--keep-worktrees] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'keep-worktrees'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Worktrees with uncommitted changes are never force-removed; the Mission stays listed so you can retry.',
      '--keep-worktrees detaches member worktrees instead of deleting them.'
    ],
    examples: ['orca mission rm referral', 'orca mission rm referral --keep-worktrees --json']
  }
]
