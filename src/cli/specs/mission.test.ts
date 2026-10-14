import { describe, expect, it } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../args'
import { specPaths } from '../command-spec'
import { HANDLER_COMMAND_KEYS } from '../dispatch'
import { getRepeatedStringFlag } from '../flags'
import { ROOT_HELP_TEXT_PRIMARY } from '../root-help-text-primary'
import { CLI_COMMAND_NAMES } from '../../main/startup/cli-command-names'
import { COMMAND_SPECS } from './index'
import { MISSION_COMMAND_SPECS } from './mission'

const commandPaths = COMMAND_SPECS.flatMap(specPaths)

function parse(argv: string[]) {
  return normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv, commandPaths, COMMAND_SPECS))
}

describe('orca mission command specs', () => {
  it('registers every mission command in specs, dispatcher, help, and launch redirect', () => {
    for (const spec of MISSION_COMMAND_SPECS) {
      const command = spec.path.join(' ')
      expect(COMMAND_SPECS).toContain(spec)
      expect(HANDLER_COMMAND_KEYS.has(command)).toBe(true)
      expect(ROOT_HELP_TEXT_PRIMARY).toContain(`  ${command} `)
    }
    expect(CLI_COMMAND_NAMES).toContain('mission')
  })

  it('maps the bare Mission selector onto --mission', () => {
    expect(parse(['mission', 'rm', 'Referral', '--keep-worktrees'])).toMatchObject({
      commandPath: ['mission', 'rm'],
      flags: new Map<string, string | boolean>([
        ['keep-worktrees', true],
        ['mission', 'Referral']
      ])
    })
  })

  it('accepts repeated --repo selectors', () => {
    const parsed = parse(['mission', 'add-repo', 'Referral', '--repo', 'a', '--repo', 'b'])
    expect(parsed.commandPath).toEqual(['mission', 'add-repo'])
    expect(getRepeatedStringFlag(parsed.flags, 'repo')).toEqual(['a', 'b'])
  })

  it('marks rm as destructive so typo recovery never steers into it', () => {
    const rm = MISSION_COMMAND_SPECS.find((spec) => spec.path.join(' ') === 'mission rm')
    expect(rm?.destructive).toBe(true)
  })
})
