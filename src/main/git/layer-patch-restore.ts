import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { gitReadOptionsForWorktree, type GitRuntimeOptions } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

type GitExecOptions = Parameters<typeof gitExecFileAsync>[1]

/** Paths a patch touches, read without applying it; a rename lists both sides. */
export async function listPatchPaths(
  worktreePath: string,
  patch: string,
  applyFlags: readonly string[],
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  const { stdout } = await gitExecFileAsync(['apply', '--numstat', '-z', ...applyFlags], {
    ...gitReadOptionsForWorktree(worktreePath, options),
    stdin: patch
  })
  const tokens = stdout.split('\0')
  const paths: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const fields = tokens[index].split('\t')
    if (fields.length < 3) {
      continue
    }
    const name = fields.slice(2).join('\t')
    if (name) {
      paths.push(name)
    } else {
      // Why: with -z a rename leaves the name empty and lists source and destination next.
      paths.push(...tokens.slice(index + 1, index + 3).filter(Boolean))
      index += 2
    }
  }
  return [...new Set(paths)]
}

/**
 * Puts only `paths` back to HEAD in the index and worktree; edits to any other file stay.
 * Files the patch added are deleted only when `removeAdded` says the patch wrote them.
 */
export async function restorePatchPaths(
  worktreePath: string,
  paths: readonly string[],
  removeAdded: boolean,
  execOptions: GitExecOptions
): Promise<void> {
  if (paths.length === 0) {
    return
  }
  // Why: patch paths are file names, never pathspec patterns.
  const literal = ['--literal-pathspecs']
  const { stdout } = await gitExecFileAsync(
    [...literal, 'ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...paths],
    execOptions
  )
  const inHead = new Set(stdout.split('\0').filter(Boolean))
  const tracked = paths.filter((entry) => inHead.has(entry))
  const added = paths.filter((entry) => !inHead.has(entry))
  if (tracked.length > 0) {
    await gitExecFileAsync(
      [...literal, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked],
      execOptions
    )
  }
  if (!removeAdded || added.length === 0) {
    return
  }
  await gitExecFileAsync(
    [...literal, 'rm', '-q', '--cached', '--ignore-unmatch', '--', ...added],
    execOptions
  )
  for (const entry of added) {
    await rm(path.join(worktreePath, entry), { force: true })
  }
}
