import { describe, expect, it } from 'vitest'
import { getDevEnvServiceShellCommand } from './dev-env-service-shell'

describe('getDevEnvServiceShellCommand', () => {
  it('exits with the service status in sh, bash, zsh and fish', () => {
    // Why: fish rejects `$?`; a bare `exit` keeps the last status in every POSIX-style shell and fish.
    expect(getDevEnvServiceShellCommand('npm run dev', 'darwin')).toBe('npm run dev; exit')
  })

  it('leaves Windows commands unchanged', () => {
    expect(getDevEnvServiceShellCommand('npm run dev', 'win32')).toBe('npm run dev')
  })
})
