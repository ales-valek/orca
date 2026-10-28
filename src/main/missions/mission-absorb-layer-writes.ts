import {
  buildZeroContextPatch,
  mapHunkOntoLayer,
  parseZeroContextDiff,
  type ZeroContextHunk
} from '../../shared/mission-absorb-patch'
import type { AbsorbAssignment, AbsorbHunk } from '../../shared/mission-absorb-plan'
import type { MissionTask } from '../../shared/mission-types'
import { gitReadOptionsForWorktree } from '../git/git-runtime-options'
import { gitExecFileAsync } from '../git/runner'
import { autosquashLayer, commitFixup, restoreLayerTip } from '../git/stack-layer-git'
import {
  revertPreviewTrackedEdits,
  type PreviewEditFile,
  type PreviewEdits
} from './mission-preview-edits'

const PLAIN_COMMIT_MESSAGE = 'Absorb preview edits'

/** A task layer verified on `tip`, sitting on `parentTip`. */
export type AbsorbLayer = {
  task: MissionTask
  worktreeId: string
  worktreePath: string
  parentTip: string
  tip: string
  /** `parentTip..tip`, newest first. */
  commits: string[]
}

type LayerWrite = { layer: AbsorbLayer; commits: { fixupOf: string | null; patch: string }[] }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every patch is built before the first write, so a hunk that cannot be placed changes nothing. */
export async function buildLayerWrites(
  involved: AbsorbLayer[],
  assignments: AbsorbAssignment[],
  edits: PreviewEdits,
  diffs: LayerToPreviewDiffs
): Promise<LayerWrite[]> {
  const writes: LayerWrite[] = []
  for (const layer of involved) {
    const groups = new Map<string | null, AbsorbHunk[]>()
    for (const { hunk, taskId, fixupOf } of assignments) {
      if (taskId === layer.task.id) {
        groups.set(fixupOf, [...(groups.get(fixupOf) ?? []), hunk])
      }
    }
    if (groups.size === 0) {
      continue
    }
    const placer = new LayerHunkPlacer(layer, diffs)
    const commits: LayerWrite['commits'] = []
    for (const [fixupOf, hunks] of groups) {
      const patches: string[] = []
      for (const file of edits.files) {
        const sources = hunks.flatMap((hunk) => {
          const source = edits.hunks.get(hunk)
          return source?.file === file ? [source] : []
        })
        if (sources.length > 0) {
          patches.push(
            await placer.buildFilePatch(
              file,
              sources.map(({ hunk }) => hunk)
            )
          )
        }
      }
      commits.push({ fixupOf, patch: patches.join('') })
    }
    writes.push({ layer, commits })
  }
  return writes
}

/** Writes layers bottom-up, then reverts the preview; any failure puts every written layer back. */
export async function writeLayersThenRevertPreview(
  writes: LayerWrite[],
  previewPath: string,
  files: PreviewEditFile[]
): Promise<void> {
  // Why: a layer joins only once it holds an absorb commit; one refused as dirty was never ours to reset.
  const written = new Set<AbsorbLayer>()
  try {
    for (const { layer, commits } of writes) {
      if ((await commitAndSquashLayer(layer, commits, written)) === 'conflict') {
        // Why: later commits of the layer touch neighbouring lines; folding into its tip keeps the edit in the layer.
        await restoreLayerTip(layer.worktreePath, layer.tip)
        written.delete(layer)
        const tip = layer.commits[0] ?? null
        const retargeted = commits.map((commit) => ({
          ...commit,
          fixupOf: commit.fixupOf && tip
        }))
        if ((await commitAndSquashLayer(layer, retargeted, written)) === 'conflict') {
          throw new Error('mission_absorb_squash_conflict')
        }
      }
    }
    await revertPreviewTrackedEdits(previewPath, files)
  } catch (error) {
    const failures: string[] = []
    for (const layer of [...written].toReversed()) {
      await restoreLayerTip(layer.worktreePath, layer.tip).catch((restoreError: unknown) =>
        failures.push(`${layer.task.branchName}: ${toErrorMessage(restoreError)}`)
      )
    }
    if (failures.length > 0) {
      throw new Error(`${toErrorMessage(error)}; could not restore ${failures.join(', ')}`)
    }
    throw error
  }
}

async function commitAndSquashLayer(
  layer: AbsorbLayer,
  commits: LayerWrite['commits'],
  written: Set<AbsorbLayer>
): Promise<'done' | 'conflict'> {
  for (const { fixupOf, patch } of commits) {
    await commitFixup(
      layer.worktreePath,
      patch,
      fixupOf ? { fixupOf } : { message: PLAIN_COMMIT_MESSAGE },
      { unidiffZero: true }
    )
    written.add(layer)
  }
  if (!commits.some(({ fixupOf }) => fixupOf)) {
    return 'done'
  }
  const squashed = await autosquashLayer(layer.worktreePath, layer.parentTip)
  return squashed.status === 'conflict' ? 'conflict' : 'done'
}

/** `-U0` diffs from each layer tip to the preview HEAD, read once per layer and file. */
export class LayerToPreviewDiffs {
  private readonly cache = new Map<string, Promise<ZeroContextHunk[]>>()

  constructor(
    private readonly previewPath: string,
    private readonly previewHead: string
  ) {}

  read(layerTip: string, file: string): Promise<ZeroContextHunk[]> {
    if (layerTip === this.previewHead) {
      return Promise.resolve([])
    }
    const key = `${layerTip}\0${file}`
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }
    const read = gitExecFileAsync(
      [
        'diff',
        '-U0',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        layerTip,
        this.previewHead,
        '--',
        `:(literal)${file}`
      ],
      gitReadOptionsForWorktree(this.previewPath)
    ).then(({ stdout }) => parseZeroContextDiff(stdout).hunks)
    this.cache.set(key, read)
    return read
  }
}

/** Task ids each text hunk can be placed in; whole-file changes are not limited here. */
export async function getPlaceableTaskIds(
  layers: { taskId: string; tip: string }[],
  edits: PreviewEdits,
  diffs: LayerToPreviewDiffs
): Promise<Map<AbsorbHunk, Set<string>>> {
  const placeable = new Map<AbsorbHunk, Set<string>>()
  for (const [hunk, source] of edits.hunks) {
    const taskIds = new Set<string>()
    for (const layer of layers) {
      const textHunk = source.hunk
      if (!textHunk || mapHunkOntoLayer(textHunk, await diffs.read(layer.tip, hunk.file))) {
        taskIds.add(layer.taskId)
      }
    }
    placeable.set(hunk, taskIds)
  }
  return placeable
}

/** Places preview hunks at their lines in one layer's files, tracking hunks earlier commits added. */
class LayerHunkPlacer {
  private readonly placedByFile = new Map<string, ZeroContextHunk[]>()

  constructor(
    private readonly layer: AbsorbLayer,
    private readonly diffs: LayerToPreviewDiffs
  ) {}

  async buildFilePatch(file: PreviewEditFile, hunks: (ZeroContextHunk | null)[]): Promise<string> {
    const textHunks = hunks.filter((hunk): hunk is ZeroContextHunk => hunk !== null)
    if (textHunks.length < hunks.length) {
      return file.diff
    }
    const layerToPreview = await this.diffs.read(this.layer.tip, file.file)
    const placed = this.placedByFile.get(file.file) ?? []
    const onLayer = textHunks.map((hunk) => {
      const mapped = mapHunkOntoLayer(hunk, layerToPreview)
      if (!mapped) {
        throw new Error('mission_absorb_hunk_unplaceable')
      }
      return mapped
    })
    // Why: an earlier fixup commit in this layer already shifted the lines below its hunks.
    const moved = onLayer.map((hunk) => {
      const shift = placed
        .filter((earlier) => earlier.oldStart < hunk.oldStart)
        .reduce((sum, earlier) => sum + earlier.newCount - earlier.oldCount, 0)
      return { ...hunk, oldStart: hunk.oldStart + shift }
    })
    this.placedByFile.set(file.file, [...placed, ...onLayer])
    // Why: without a blob id git applies at the layer's own lines instead of merging from the preview's.
    const header = file.header.filter((line) => !line.startsWith('index '))
    return buildZeroContextPatch(header, moved)
  }
}
