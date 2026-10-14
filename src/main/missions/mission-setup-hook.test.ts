import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import { MISSION_SETUP_LOG_NAME } from './mission-root'
import {
  buildMissionSetupHookEnv,
  getMissionSetupHookPath,
  runMissionSetupHook
} from './mission-setup-hook'

function makeMission(rootPath: string | null): Mission {
  return {
    id: 'mission-1',
    name: 'Referral',
    branchName: 'mission/referral',
    members: [],
    tabOrder: 0,
    rootPath,
    createdAt: 1,
    updatedAt: 1
  }
}

describe.skipIf(process.platform === 'win32')('mission setup hook', () => {
  let scratch: string
  let homeDir: string
  let rootPath: string

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'orca-mission-setup-hook-'))
    homeDir = path.join(scratch, 'home')
    rootPath = path.join(scratch, 'root')
    mkdirSync(path.dirname(getMissionSetupHookPath(homeDir)), { recursive: true })
    mkdirSync(rootPath)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(scratch, { recursive: true, force: true })
  })

  function installHook(body: string, mode = 0o755): void {
    const hookPath = getMissionSetupHookPath(homeDir)
    writeFileSync(hookPath, `#!/bin/sh\n${body}\n`)
    chmodSync(hookPath, mode)
  }

  function readLog(): string {
    return readFileSync(path.join(rootPath, MISSION_SETUP_LOG_NAME), 'utf8')
  }

  it('runs in the Mission root with Mission env and appends output to the log', async () => {
    installHook(
      'echo "cwd=$(pwd -P)"; echo "id=$ORCA_MISSION_ID name=$ORCA_MISSION_NAME"; ' +
        'echo "root=$ORCA_MISSION_ROOT branch=$ORCA_MISSION_BRANCH event=$ORCA_MISSION_EVENT"; ' +
        'echo oops >&2'
    )

    await runMissionSetupHook(makeMission(rootPath), 'create', { homeDir })
    await runMissionSetupHook(makeMission(rootPath), 'members-added', { homeDir })

    const log = readLog()
    expect(log).toMatch(
      /=== \d{4}-\d{2}-\d{2}T[^ ]+ mission-setup event=create mission=mission-1 ===/
    )
    expect(log).toContain('mission-setup event=members-added')
    expect(log).toContain(`cwd=${realpathSync(rootPath)}`)
    expect(log).toContain('id=mission-1 name=Referral')
    expect(log).toContain(`root=${rootPath} branch=mission/referral event=create`)
    expect(log).toContain('event=members-added')
    expect(log).toContain('oops')
    expect(log.match(/\[orca\] completed/g)).toHaveLength(2)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs a failing hook without throwing', async () => {
    installHook('echo broken; exit 3')

    await expect(
      runMissionSetupHook(makeMission(rootPath), 'create', { homeDir })
    ).resolves.toBeUndefined()

    expect(readLog()).toContain('broken\n[orca] exited with code 3')
    expect(console.error).toHaveBeenCalledWith(
      `[missions] mission-setup hook exited with code 3 in ${rootPath}`
    )
  })

  it('does nothing when the hook is missing or not executable', async () => {
    await runMissionSetupHook(makeMission(rootPath), 'create', { homeDir })
    installHook('echo should-not-run', 0o644)
    await runMissionSetupHook(makeMission(rootPath), 'create', { homeDir })

    expect(() => readLog()).toThrow()
  })

  it('does nothing for a Mission without a root', async () => {
    installHook('echo should-not-run')

    await runMissionSetupHook(makeMission(null), 'create', { homeDir })

    expect(() => readLog()).toThrow()
  })

  it('does not leak an inherited ORCA_MISSION_BRANCH when the Mission has none', () => {
    const mission = { ...makeMission(rootPath), branchName: '' }
    const env = buildMissionSetupHookEnv(mission, rootPath, 'create', {
      ORCA_MISSION_BRANCH: 'stale',
      PATH: '/usr/bin'
    })

    expect(env.ORCA_MISSION_BRANCH).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.ORCA_MISSION_EVENT).toBe('create')
  })
})
