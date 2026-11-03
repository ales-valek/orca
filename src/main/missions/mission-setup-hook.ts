import { accessSync, appendFileSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Mission } from '../../shared/mission-types'
import { runProcess } from '@orca/process-host'
import { promptGuardShellEnv } from '../git/runner'
import { dropIncoherentCondaActivationEnv } from '../pty/shell-startup/conda-activation-env'
import { MISSION_SETUP_LOG_NAME } from './mission-root'

type ProcessResult = Awaited<ReturnType<typeof runProcess>>

export type MissionSetupHookEvent = 'create' | 'members-added'

// Why generous: setup hooks typically install dependencies across every member repo.
const MISSION_SETUP_HOOK_TIMEOUT_MS = 30 * 60_000
const MISSION_SETUP_HOOK_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024

export function getMissionSetupHookPath(homeDir: string = homedir()): string {
  return path.join(homeDir, '.orca', 'hooks', 'mission-setup')
}

function isExecutableFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) {
      return false
    }
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function buildMissionSetupHookEnv(
  mission: Mission,
  rootPath: string,
  event: MissionSetupHookEvent,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  // Why process.env: startup hydrates it with the login-shell PATH, same as orca.yaml hooks.
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ORCA_MISSION_ID: mission.id,
    ORCA_MISSION_NAME: mission.name,
    ORCA_MISSION_ROOT: rootPath,
    ORCA_MISSION_EVENT: event
  }
  if (mission.branchName) {
    env.ORCA_MISSION_BRANCH = mission.branchName
  } else {
    delete env.ORCA_MISSION_BRANCH
  }
  dropIncoherentCondaActivationEnv(env)
  // Why: hooks run unattended; block interactive Git credential prompts like orca.yaml hooks do.
  return promptGuardShellEnv(env)
}

function describeOutcome(result: ProcessResult): string | null {
  if (result.timedOut) {
    return `timed out after ${MISSION_SETUP_HOOK_TIMEOUT_MS}ms`
  }
  if (result.code !== 0) {
    return result.code === null
      ? `terminated by ${result.signal ?? 'signal'}`
      : `exited with code ${result.code}`
  }
  return null
}

function appendLog(logPath: string, text: string): void {
  try {
    appendFileSync(logPath, text, 'utf8')
  } catch (error) {
    console.error(
      `[missions] failed to write ${logPath}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/** Run `~/.orca/hooks/mission-setup` in the Mission root when it exists and is executable. */
export async function runMissionSetupHook(
  mission: Mission,
  event: MissionSetupHookEvent,
  options: { homeDir?: string; timeoutMs?: number } = {}
): Promise<void> {
  const rootPath = mission.rootPath
  const hookPath = getMissionSetupHookPath(options.homeDir)
  if (!rootPath || !isExecutableFile(hookPath)) {
    return
  }
  const logPath = path.join(rootPath, MISSION_SETUP_LOG_NAME)
  appendLog(
    logPath,
    `\n=== ${new Date().toISOString()} mission-setup event=${event} mission=${mission.id} ===\n`
  )
  let result: ProcessResult
  try {
    result = await runProcess(
      {
        program: hookPath,
        cwd: rootPath,
        env: buildMissionSetupHookEnv(mission, rootPath, event),
        timeoutMs: options.timeoutMs ?? MISSION_SETUP_HOOK_TIMEOUT_MS,
        maxOutputBytes: MISSION_SETUP_HOOK_OUTPUT_LIMIT_BYTES
      },
      'tail'
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(logPath, `[orca] failed to start ${hookPath}: ${message}\n`)
    console.error(`[missions] mission-setup hook failed to start in ${rootPath}:`, message)
    return
  }
  const output = [result.stdout, result.stderr].filter((text) => text.length > 0).join('\n')
  const failure = describeOutcome(result)
  appendLog(
    logPath,
    `${output}${output.endsWith('\n') || !output ? '' : '\n'}[orca] ${failure ?? 'completed'}\n`
  )
  if (failure) {
    console.error(`[missions] mission-setup hook ${failure} in ${rootPath}`)
  }
}
