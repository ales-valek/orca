import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import {
  buildZeroContextPatch,
  parseZeroContextDiff,
  type ZeroContextHunk
} from '../../shared/mission-absorb-patch'
import type { AbsorbHunk } from '../../shared/mission-absorb-plan'
import { gitOptionsForWorktree, gitReadOptionsForWorktree } from '../git/git-runtime-options'
import { gitExecFileAsync } from '../git/runner'
import { bulkUnstageFiles } from '../git/source-control/staging'
import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'

/** One changed path in the preview. Text edits keep their hunks; anything else moves as a whole file. */
export type PreviewEditFile = {
  file: string
  /** The path's exact `-U0 --binary` diff against HEAD (or from nothing when untracked). */
  diff: string
  /** Header lines before the first hunk; used to rebuild a patch from a subset of hunks. */
  header: string[]
  /** Empty for a whole-file change. */
  hunks: ZeroContextHunk[]
  untracked: boolean
  opaque: boolean
}

export type PreviewEdits = { files: PreviewEditFile[]; hunks: Map<AbsorbHunk, PreviewHunkSource> }

export type PreviewHunkSource = { file: PreviewEditFile; hunk: ZeroContextHunk | null }

// Why: user diff config (noprefix, external tools, textconv, color) must not change the patch git apply reads.
const PATCH_DIFF_ARGS = [
  '-U0',
  '--binary',
  '--full-index',
  '--no-renames',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/'
]

const NUL = '\0'

function literal(file: string): string {
  return `:(literal)${file}`
}

function splitNul(stdout: string): string[] {
  return stdout.split(NUL).filter(Boolean)
}

/** Text edits keep hunks; binary, deleted, type, mode or submodule changes are opaque to blame. */
function classifyTracked(file: string, status: string, diff: string): PreviewEditFile {
  const parsed = parseZeroContextDiff(diff)
  const isGitlink = /^(index \S+|(new|deleted) file mode) 160000$/m.test(diff)
  const special =
    isGitlink ||
    /^(GIT binary patch|Binary files |old mode |new mode )/m.test(diff) ||
    /^(index \S+|(new|deleted) file mode) 120000$/m.test(diff) ||
    // Why: a text that is not valid UTF-8 cannot round-trip through a string patch.
    diff.includes('\uFFFD')
  const whole = status !== 'M' || special
  return {
    file,
    diff,
    header: parsed.header,
    hunks: whole ? [] : parsed.hunks,
    untracked: false,
    // Why: a new file is a pure addition wherever it lands; a new submodule is not a file.
    opaque: whole && (status !== 'A' || isGitlink)
  }
}

/** `git diff --no-index` exits 1 when files differ, which is the normal case here. */
async function diffUntracked(previewPath: string, file: string): Promise<string> {
  try {
    await gitExecFileAsync(
      ['diff', '--no-index', ...PATCH_DIFF_ARGS, '--', '/dev/null', file],
      gitReadOptionsForWorktree(previewPath)
    )
  } catch (error) {
    const stdout =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 1
        ? 'stdout' in error && error.stdout
        : null
    if (typeof stdout === 'string' && stdout) {
      return stdout
    }
    throw error
  }
  return ''
}

/** Reads every tracked and untracked edit in the preview without touching its index or files. */
export async function readPreviewEdits(previewPath: string): Promise<PreviewEditFile[]> {
  const readOptions = gitReadOptionsForWorktree(previewPath)
  const { stdout: statusOut } = await gitExecFileAsync(
    ['diff', '--name-status', '-z', '--no-renames', '--ignore-submodules=none', 'HEAD'],
    readOptions
  )
  const entries = splitNul(statusOut)
  const files: PreviewEditFile[] = []
  for (let index = 0; index + 1 < entries.length; index += 2) {
    const status = entries[index] ?? ''
    const file = entries[index + 1] ?? ''
    if (status === 'U') {
      throw new Error('mission_absorb_layers_busy')
    }
    const { stdout } = await gitExecFileAsync(
      ['diff', ...PATCH_DIFF_ARGS, 'HEAD', '--', literal(file)],
      readOptions
    )
    files.push(classifyTracked(file, status, stdout))
  }
  const { stdout: untrackedOut } = await gitExecFileAsync(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    readOptions
  )
  // Why: a nested repository is listed as a directory; it is not a file edit and stays put.
  for (const file of splitNul(untrackedOut).filter((entry) => !entry.endsWith('/'))) {
    const diff = await diffUntracked(previewPath, file)
    const { header } = parseZeroContextDiff(diff)
    files.push({ file, diff, header, hunks: [], untracked: true, opaque: false })
  }
  return files
}

/** Absorb units: each text hunk, or the whole file for anything else. */
export function toAbsorbHunks(files: PreviewEditFile[]): PreviewEdits {
  const hunks = new Map<AbsorbHunk, PreviewHunkSource>()
  for (const file of files) {
    if (file.hunks.length === 0) {
      const whole: AbsorbHunk = { file: file.file, patch: file.diff, touchedOldLines: [] }
      hunks.set(file.opaque ? { ...whole, opaque: true } : whole, { file, hunk: null })
      continue
    }
    for (const hunk of file.hunks) {
      const touchedOldLines = Array.from({ length: hunk.oldCount }, (_, i) => hunk.oldStart + i)
      const patch = buildZeroContextPatch(file.header, [hunk])
      hunks.set({ file: file.file, patch, touchedOldLines }, { file, hunk })
    }
  }
  return { files, hunks }
}

function getSnapshot(files: PreviewEditFile[]): string {
  return files
    .map((file) => `${file.untracked ? 'untracked' : 'tracked'}${NUL}${file.diff}`)
    .join(NUL)
}

/**
 * Takes the absorbed edits out of the preview, failing before any change when the preview no
 * longer holds exactly those edits. Untracked files are removed by `removeAbsorbedUntrackedFiles`.
 */
export async function revertPreviewTrackedEdits(
  previewPath: string,
  files: PreviewEditFile[]
): Promise<void> {
  await runWithGitWorktreeOperationLock(previewPath, undefined, async () => {
    if (getSnapshot(await readPreviewEdits(previewPath)) !== getSnapshot(files)) {
      throw new Error('mission_absorb_preview_changed')
    }
    const tracked = files.filter((file) => !file.untracked)
    if (tracked.length === 0) {
      return
    }
    await bulkUnstageFiles(
      previewPath,
      tracked.map((file) => file.file)
    )
    await gitExecFileAsync(['apply', '-R', '--unidiff-zero'], {
      ...gitOptionsForWorktree(previewPath),
      stdin: tracked.map((file) => file.diff).join('')
    })
  })
}

/** Deletes the untracked files absorb moved into a layer; they now come back through restack. */
export async function removeAbsorbedUntrackedFiles(
  previewPath: string,
  files: PreviewEditFile[]
): Promise<void> {
  for (const file of files.filter((entry) => entry.untracked)) {
    await rm(path.join(previewPath, file.file), { force: true })
  }
}
