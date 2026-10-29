import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { runProcess } from '@orca/process-host'

export type DevEnvExecResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type DevEnvExec = (
  program: string,
  args: string[],
  opts: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs: number
    /** Output streams into this file instead of being captured. */
    logPath?: string
    signal?: AbortSignal
  }
) => Promise<DevEnvExecResult>

/** Installs and seeds can take a while on a cold cache. */
export const DEV_ENV_COMMAND_TIMEOUT_MS = 30 * 60_000

const CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024

export const runDevEnvExec: DevEnvExec = async (program, args, opts) => {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env
  if (!opts.logPath) {
    const result = await runProcess({
      program,
      args,
      cwd: opts.cwd,
      env,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      maxOutputBytes: CAPTURE_LIMIT_BYTES
    })
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut
    }
  }
  mkdirSync(dirname(opts.logPath), { recursive: true })
  const fd = openSync(opts.logPath, 'a')
  try {
    writeSync(fd, `$ ${[program, ...args].join(' ')}\n`)
    // Why: long installs must show progress in the log while they run, not only at the end.
    const result = await runProcess({
      program,
      args,
      cwd: opts.cwd,
      env,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      stdio: ['ignore', fd, fd]
    })
    writeSync(fd, `[exit ${result.timedOut ? 'timeout' : String(result.code)}]\n`)
    return { code: result.code, stdout: '', stderr: '', timedOut: result.timedOut }
  } finally {
    closeSync(fd)
  }
}

function getShellInvocation(command: string): { program: string; args: string[] } {
  if (process.platform === 'win32') {
    return { program: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  // Why: a login shell picks up the user's PATH (nvm, Homebrew) that Electron does not inherit.
  return { program: process.env.SHELL || '/bin/sh', args: ['-lc', command] }
}

export async function runDevEnvShellCommand(
  command: string,
  opts: {
    cwd: string
    env?: Record<string, string>
    logPath: string
    timeoutMs: number
    signal?: AbortSignal
  },
  exec: DevEnvExec = runDevEnvExec
): Promise<{ ok: boolean; code: number | null; timedOut: boolean }> {
  const { program, args } = getShellInvocation(command)
  const result = await exec(program, args, opts)
  return { ok: result.code === 0 && !result.timedOut, code: result.code, timedOut: result.timedOut }
}
