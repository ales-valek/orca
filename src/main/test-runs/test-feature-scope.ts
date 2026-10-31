import { resolveDefaultBaseRefViaExec } from '../../shared/git-default-base-ref'
import type { FeatureScope } from '../../shared/test-runs/test-catalog-types'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'

type GitRunner = (args: string[], cwd: string) => Promise<string>

const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/
const EMPTY_SCOPE: FeatureScope = {
  baseCommit: null,
  since: null,
  changedSpecFiles: [],
  changedOtherFiles: []
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return (await gitExecFileAsync(args, { cwd })).stdout
}

function getLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** What a branch changed since it left the default branch, committed or not. */
export async function getFeatureScope(input: {
  path: string
  git?: GitRunner
}): Promise<FeatureScope> {
  const git = input.git ?? runGit
  try {
    const defaultRef = await resolveDefaultBaseRefViaExec(async (argv) => ({
      stdout: await git(argv, input.path)
    }))
    if (!defaultRef) {
      return EMPTY_SCOPE
    }
    const baseCommit = (await git(['merge-base', defaultRef, 'HEAD'], input.path)).trim()
    const committed = getLines(
      await git(['diff', '--name-only', `${baseCommit}..HEAD`], input.path)
    )
    const uncommitted = getLines(await git(['diff', '--name-only', 'HEAD'], input.path))
    const files = [...new Set([...committed, ...uncommitted])].toSorted()
    const committedAt = Number(
      (await git(['show', '-s', '--format=%ct', baseCommit], input.path)).trim()
    )
    return {
      baseCommit,
      since: Number.isFinite(committedAt) ? committedAt * 1000 : null,
      changedSpecFiles: files.filter((file) => SPEC_FILE.test(file)),
      changedOtherFiles: files.filter((file) => !SPEC_FILE.test(file))
    }
  } catch {
    // Folder workspaces and branches without a common history have no feature scope.
    return EMPTY_SCOPE
  }
}
