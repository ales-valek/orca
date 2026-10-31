import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'
import { DEV_ENV_COMMAND_TIMEOUT_MS, runDevEnvShellCommand } from '../dev-env/dev-env-shell-command'

type GitRunner = (args: string[], cwd: string) => Promise<string>
type InstallRunner = (
  command: string,
  cwd: string,
  logPath: string,
  signal?: AbortSignal
) => Promise<void>

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
const INSTALL_STAMP = '.orca-install-stamp'
const SOURCE_REF = 'refs/remotes/source/main'

async function runGit(args: string[], cwd: string): Promise<string> {
  return (await gitExecFileAsync(args, { cwd })).stdout
}

async function runInstallCommand(
  command: string,
  cwd: string,
  logPath: string,
  signal?: AbortSignal
): Promise<void> {
  const result = await runDevEnvShellCommand(command, {
    cwd,
    logPath,
    timeoutMs: DEV_ENV_COMMAND_TIMEOUT_MS,
    signal
  })
  if (!result.ok) {
    throw new Error(`${command} failed; see the run output`)
  }
}

function getLockfileHash(dir: string): string {
  const hash = createHash('sha1')
  for (const name of LOCKFILES) {
    const path = join(dir, name)
    if (existsSync(path)) {
      hash.update(name).update(readFileSync(path))
    }
  }
  return hash.digest('hex')
}

/**
 * Orca's own checkouts of a test repo's default branch. Why a shared clone, not a worktree:
 * Orca lists every worktree of a repo, and these must stay out of the user's way.
 */
export class TestRunCheckouts {
  /** Why: a list and a launch must never clean one checkout at the same time. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly deps: { dir: string; git?: GitRunner; runInstall?: InstallRunner }
  ) {}

  getPath(key: string): string {
    return join(this.deps.dir, 'checkouts', key)
  }

  /** Resolves once no preparation of this checkout is running. */
  whenIdle(key: string): Promise<void> {
    return (this.queues.get(key) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined
    )
  }

  exists(key: string): boolean {
    return existsSync(join(this.getPath(key), '.git'))
  }

  /** Removes checkouts of targets that no longer exist; returns their keys. */
  removeUnused(keepKeys: ReadonlySet<string>): string[] {
    const root = join(this.deps.dir, 'checkouts')
    const unused = existsSync(root) ? readdirSync(root).filter((key) => !keepKeys.has(key)) : []
    for (const key of unused) {
      rmSync(join(root, key), { recursive: true, force: true })
    }
    return unused
  }

  prepare(input: {
    key: string
    repoPath: string
    install: string[]
    logPath: string
    signal?: AbortSignal
  }): Promise<{ path: string; commit: string }> {
    const previous = this.queues.get(input.key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.prepareNow(input))
    this.queues.set(input.key, next)
    return next
  }

  private async prepareNow(input: {
    key: string
    repoPath: string
    install: string[]
    logPath: string
    signal?: AbortSignal
  }): Promise<{ path: string; commit: string }> {
    const path = this.getPath(input.key)
    let commit: string
    try {
      commit = await this.syncCheckout(input, path)
    } catch {
      // Why: a force-push plus gc in the source repo can leave a shared clone git rejects.
      appendFileSync(input.logPath, 'The checkout was broken; cloning it again.\n')
      rmSync(path, { recursive: true, force: true })
      commit = await this.syncCheckout(input, path)
    }
    await this.installIfNeeded(input, path)
    return { path, commit }
  }

  /** Clone if needed, then reset to the source repo's default branch; returns its commit. */
  private async syncCheckout(
    input: { repoPath: string; logPath: string },
    path: string
  ): Promise<string> {
    const git = this.deps.git ?? runGit
    if (!existsSync(join(path, '.git'))) {
      mkdirSync(join(this.deps.dir, 'checkouts'), { recursive: true })
      await git(
        ['clone', '--quiet', '--shared', '--no-checkout', input.repoPath, path],
        this.deps.dir
      )
    }
    // Why: a shared clone's origin is the local repo path; runs and lists in it must carry the
    // same repo identity as runs in the user's own worktrees.
    const originUrl = await git(['remote', 'get-url', 'origin'], input.repoPath).then(
      (url) => url.trim(),
      () => ''
    )
    if (originUrl) {
      await git(['remote', 'set-url', 'origin', originUrl], path)
    }
    try {
      await git(['fetch', '--quiet', 'origin'], input.repoPath)
    } catch {
      appendFileSync(
        input.logPath,
        'Could not fetch origin; using the last fetched default branch.\n'
      )
    }
    const defaultBranch = await git(
      ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
      input.repoPath
    ).then(
      (ref) => ref.trim(),
      () => 'origin/main'
    )
    await git(
      ['fetch', '--quiet', input.repoPath, `+refs/remotes/${defaultBranch}:${SOURCE_REF}`],
      path
    )
    await git(['checkout', '--quiet', '--force', '--detach', SOURCE_REF], path)
    await git(['clean', '-fdxq', '-e', 'node_modules', '-e', INSTALL_STAMP], path)
    return (await git(['rev-parse', 'HEAD'], path)).trim()
  }

  private async installIfNeeded(
    input: { install: string[]; logPath: string; signal?: AbortSignal },
    path: string
  ): Promise<void> {
    const stampPath = join(path, INSTALL_STAMP)
    const lockfileHash = getLockfileHash(path)
    const stamp = existsSync(stampPath) ? readFileSync(stampPath, 'utf8') : null
    if (!existsSync(join(path, 'node_modules')) || stamp !== lockfileHash) {
      for (const command of input.install) {
        await (this.deps.runInstall ?? runInstallCommand)(
          command,
          path,
          input.logPath,
          input.signal
        )
      }
      writeFileSync(stampPath, lockfileHash)
    }
  }
}
