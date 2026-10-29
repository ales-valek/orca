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
      'orca mission create (--name <name> --repo <selector> [--repo <selector>...] | --from-huly <milestone> [--project <key>] [--name <name>]) [--branch <branch>] [--agent <agent>] [--orchestrator-repo <selector>] [--devenv-template <template>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'repo',
      'branch',
      'agent',
      'orchestrator-repo',
      'from-huly',
      'project',
      'devenv-template'
    ],
    repeatableFlags: ['repo'],
    notes: [
      REPO_SELECTOR_NOTE,
      '--branch defaults to a branch derived from the Mission name.',
      '--agent picks the agent auto-launched when the Mission session first opens.',
      '--orchestrator-repo checks out the Mission branch of a non-member repo in the root; the Mission session runs there.',
      '--from-huly takes a Huly milestone id or exact label instead of --repo: each mapped component becomes a member repo, each issue a task layer, and MISSION.md is written to the root. It fails and lists unmapped issues or blockedBy cycles.',
      '--devenv-template creates a Dev Environment from that template (id or name) for the new Mission.',
      '--project is the Huly project key; it defaults to the only configured or workspace project. --name and --branch default to the milestone label.',
      SETUP_HOOK_NOTE
    ],
    examples: [
      'orca mission create --name referral --repo name:api --repo name:web',
      'orca mission create --name referral --repo id:<repoId> --branch mission/referral --agent claude --json',
      'orca mission create --from-huly Kiosek --project OMP --orchestrator-repo name:orchestration'
    ]
  },
  {
    path: ['mission', 'refresh'],
    summary: 'Compare a Huly-sourced Mission with its milestone and append new issues on top',
    usage: 'orca mission refresh <selector> [--apply] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'apply'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Without --apply it only prints the diff. With --apply it appends the new issues that belong after every existing task of their repo, then rewrites MISSION.md.',
      'Issues that would land in the middle of a stack, belong to a repo outside the Mission, or sit in a blockedBy cycle are listed as non-appendable and never added; the exit code stays 0.'
    ],
    examples: ['orca mission refresh kiosek', 'orca mission refresh kiosek --apply']
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
    path: ['mission', 'task', 'add'],
    summary: 'Append a task layer above a Mission repo stack, with its own branch and worktree',
    usage:
      'orca mission task add <selector> --repo <selector> --title <title> [--ref <key>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'repo', 'title', 'ref'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      '--repo is one registered repo selector that is already a Mission member.',
      '--ref is an external tracker key such as OMP-951; it names the task branch and selects the task for --choose.'
    ],
    examples: ['orca mission task add kiosek --repo name:eshop --title "Cart totals" --ref OMP-951']
  },
  {
    path: ['mission', 'task', 'rm'],
    destructive: true,
    summary: 'Remove the top task layer of a Mission repo stack and delete its worktree',
    usage: 'orca mission task rm <selector> --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'repo'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Only the top task can be removed. A layer with uncommitted changes is refused.'
    ],
    examples: ['orca mission task rm kiosek --repo name:eshop']
  },
  {
    path: ['mission', 'restack'],
    summary: 'Rebase task layers onto their parents and move the preview along',
    usage: 'orca mission restack <selector> [--repo <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'repo'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Without --repo every member repo is restacked. Layers with uncommitted changes, a working agent or a conflict are left alone and reported.'
    ],
    examples: ['orca mission restack kiosek', 'orca mission restack kiosek --repo name:eshop']
  },
  {
    path: ['mission', 'absorb'],
    summary: 'Move edits made in the preview worktree into the task layers that own them',
    usage:
      'orca mission absorb <selector> --repo <selector> [--choose <file:line=taskRef>...] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'repo', 'choose'],
    repeatableFlags: ['choose'],
    positionalArgs: ['mission'],
    notes: [
      MISSION_SELECTOR_NOTE,
      'Exits 1 and lists file:line of every hunk that more than one task could own; resolve each with --choose.',
      'taskRef is a task tracker key, task branch name or task id.'
    ],
    examples: [
      'orca mission absorb kiosek --repo name:eshop',
      'orca mission absorb kiosek --repo name:eshop --choose src/cart.ts:42=OMP-951'
    ]
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
