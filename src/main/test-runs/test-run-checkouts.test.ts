import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestRunCheckouts } from './test-run-checkouts'

let dir: string
let origin: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function commitToOrigin(file: string, content: string): void {
  const work = join(dir, 'pusher')
  if (!existsSync(work)) {
    git(dir, 'clone', '-q', origin, work)
  }
  writeFileSync(join(work, file), content)
  git(work, 'add', '.')
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file)
  git(work, 'push', '-q', 'origin', 'HEAD:main')
}

describe('TestRunCheckouts', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-run-checkouts-'))
    origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    commitToOrigin('pnpm-lock.yaml', 'v1')
    repo = join(dir, 'repo')
    git(dir, 'clone', '-q', origin, repo)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resets to origin/main, keeps node_modules, reinstalls only when the lockfile changed', async () => {
    const installs: string[] = []
    const checkouts = new TestRunCheckouts({
      dir: join(dir, 'store'),
      runInstall: async (command, cwd) => {
        installs.push(command)
        mkdirSync(join(cwd, 'node_modules'), { recursive: true })
        writeFileSync(join(cwd, 'node_modules', 'marker'), '')
      }
    })
    const input = {
      key: 'tests__dev-env-kiosek',
      repoPath: repo,
      install: ['pnpm install'],
      logPath: join(dir, 'log')
    }

    const first = await checkouts.prepare(input)
    expect(first.path).toBe(join(dir, 'store', 'checkouts', 'tests__dev-env-kiosek'))
    expect(installs).toHaveLength(1)

    writeFileSync(join(first.path, 'stale.txt'), 'left over')
    await checkouts.prepare(input)
    expect(installs).toHaveLength(1)
    expect(existsSync(join(first.path, 'node_modules', 'marker'))).toBe(true)
    expect(existsSync(join(first.path, 'stale.txt'))).toBe(false)

    commitToOrigin('pnpm-lock.yaml', 'v2')
    const third = await checkouts.prepare(input)
    expect(installs).toHaveLength(2)
    expect(third.commit).toBe(git(join(dir, 'pusher'), 'rev-parse', 'HEAD').trim())
  })

  it('keeps working when fetching from origin fails', async () => {
    const checkouts = new TestRunCheckouts({ dir: join(dir, 'store'), runInstall: async () => {} })
    const input = { key: 'k', repoPath: repo, install: [], logPath: join(dir, 'log') }
    await checkouts.prepare(input)
    git(repo, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))
    await expect(checkouts.prepare(input)).resolves.toMatchObject({
      path: join(dir, 'store', 'checkouts', 'k')
    })
  })

  it('removes checkouts whose environment is gone', () => {
    const checkouts = new TestRunCheckouts({ dir: join(dir, 'store') })
    mkdirSync(join(dir, 'store', 'checkouts', 'tests__dev-env-kiosek'), { recursive: true })
    mkdirSync(join(dir, 'store', 'checkouts', 'tests__dev-env-deleted'), { recursive: true })
    expect(checkouts.removeUnused(new Set(['tests__dev-env-kiosek']))).toEqual([
      'tests__dev-env-deleted'
    ])
    expect(existsSync(join(dir, 'store', 'checkouts', 'tests__dev-env-kiosek'))).toBe(true)
    expect(existsSync(join(dir, 'store', 'checkouts', 'tests__dev-env-deleted'))).toBe(false)
  })
})
