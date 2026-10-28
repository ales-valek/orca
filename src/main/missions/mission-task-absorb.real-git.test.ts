import { chmod, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MissionTaskAbsorb } from './mission-task-absorb'
import { MissionTaskRestack } from './mission-task-restack'
import {
  commitFile,
  createTaskStackFixture,
  git,
  MISSION_BRANCH,
  removeTaskStackFixtures,
  tipOf,
  type TaskStackFixture
} from './mission-task-stack-test-fixture'

afterEach(removeTaskStackFixtures)

// t2 prepends lines to t1.txt, so task 1's last line sits lower in the preview than in task 1.
async function createAbsorbStack(): Promise<TaskStackFixture> {
  const fixture = await createTaskStackFixture(['t1', 't2'])
  const { paths } = fixture
  await commitFile(paths.t1, 'shared.txt', 'one\ntwo\nthree\n', 't1 shared')
  git(paths.t2, ['rebase', '-q', tipOf(paths.t1)])
  fixture.mission.tasks![1].parentBaseSha = tipOf(paths.t1)
  await commitFile(paths.t2, 'shared.txt', 'one\ntwo\nthree\nfour\n', 't2 shared')
  await commitFile(paths.t1, 't1.txt', 'a\nb\nc\nt1\n', 't1 grows')
  await commitFile(paths.t1, 'mission.txt', 'mission\nt1 adds\n', 't1 extends mission')
  git(paths.t2, ['rebase', '-q', tipOf(paths.t1)])
  fixture.mission.tasks![1].parentBaseSha = tipOf(paths.t1)
  await commitFile(paths.t2, 't1.txt', 'from t2\n\na\nb\nc\nt1\n', 't2 prepends')
  git(paths.preview, ['reset', '-q', '--hard', tipOf(paths.t2)])
  fixture.mission.previews![0].followedSha = tipOf(paths.t2)
  return fixture
}

function createAbsorb(
  { deps }: TaskStackFixture,
  isWorktreeAgentWorking = deps.isWorktreeAgentWorking
): MissionTaskAbsorb {
  return new MissionTaskAbsorb({
    store: deps.store,
    restacker: new MissionTaskRestack({ ...deps, isWorktreeAgentWorking }),
    isWorktreeAgentWorking
  })
}

// Why: hooks are shared by every worktree, so the script picks the checkout it acts in.
async function installPreCommitHook(root: string, checkout: string, body: string) {
  const hook = path.join(root, '.git', 'hooks', 'pre-commit')
  const script = `#!/bin/sh\ncase "$(git rev-parse --show-toplevel)" in */${checkout})\n${body}\n;; esac\n`
  await writeFile(hook, script, 'utf8')
  await chmod(hook, 0o755)
}

function toShellPath(file: string): string {
  return file.replace(/\\/g, '/')
}

async function editT1LineAndAddFile(previewPath: string) {
  await writeFile(path.join(previewPath, 't1.txt'), 'from t2\n\na\nb\nc\nt1 tuned\n', 'utf8')
  await writeFile(path.join(previewPath, 'extra.txt'), 'extra\n', 'utf8')
}

function layerCount(cwd: string, base: string): number {
  return Number(git(cwd, ['rev-list', '--count', `${base}..HEAD`]))
}

function previewEditsOf(previewPath: string) {
  return {
    diff: git(previewPath, ['diff', 'HEAD']),
    untracked: git(previewPath, ['ls-files', '--others', '--exclude-standard'])
  }
}

describe('MissionTaskAbsorb', () => {
  it('folds an edit into the owning layer and a new file into the top task, then the preview follows', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    const counts = {
      t1: layerCount(paths.t1, MISSION_BRANCH),
      t2: layerCount(paths.t2, 'mission-task/x/t1')
    }
    await writeFile(path.join(paths.preview, 't1.txt'), 'from t2\n\na\nb\nc\nt1 tuned\n', 'utf8')
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')

    const result = await createAbsorb(fixture).absorbRepo(mission, 'r1')

    expect(result).toEqual({ applied: 2, ambiguous: [] })
    expect(layerCount(paths.t1, MISSION_BRANCH)).toBe(counts.t1)
    expect(git(paths.t1, ['show', 'HEAD:t1.txt'])).toBe('a\nb\nc\nt1 tuned')
    expect(layerCount(paths.t2, 'mission-task/x/t1')).toBe(counts.t2)
    expect(git(paths.t2, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toContain(
      'extra.txt'
    )
    expect(git(paths.preview, ['status', '--porcelain'])).toBe('')
    expect(tipOf(paths.preview)).toBe(tipOf(paths.t2))
    expect(await readFile(path.join(paths.preview, 't1.txt'), 'utf8')).toBe(
      'from t2\n\na\nb\nc\nt1 tuned\n'
    )
    expect(await readFile(path.join(paths.preview, 'extra.txt'), 'utf8')).toBe('extra\n')
  })

  it('refuses while a layer above the owner is dirty and changes nothing', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    await writeFile(path.join(paths.t2, 'scratch.txt'), 'wip\n', 'utf8')
    await editT1LineAndAddFile(paths.preview)
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }
    const edits = previewEditsOf(paths.preview)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'mission_absorb_layers_busy'
    )

    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }).toEqual(
      tips
    )
    expect(previewEditsOf(paths.preview)).toEqual(edits)
  })

  it('assigns a hunk spanning two layers to the only layer it can be placed in', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    // Why: lines 3 and 4 of shared.txt come from task 1 and task 2; task 1 lacks line 4.
    await writeFile(path.join(paths.preview, 'shared.txt'), 'one\ntwo\nTHREE\nFOUR\n', 'utf8')
    const t1Tip = tipOf(paths.t1)

    const result = await createAbsorb(fixture).absorbRepo(mission, 'r1')

    expect(result).toEqual({ applied: 1, ambiguous: [] })
    expect(tipOf(paths.t1)).toBe(t1Tip)
    expect(layerCount(paths.t2, 'mission-task/x/t1')).toBe(3)
    expect(git(paths.t2, ['show', 'HEAD:shared.txt'])).toBe('one\ntwo\nTHREE\nFOUR')
    expect(git(paths.preview, ['status', '--porcelain'])).toBe('')
  })

  it('lists a hunk two placeable layers own without touching anything, then applies the chosen one', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    // Why: line 1 comes from the mission branch (top task) and line 2 from task 1.
    await writeFile(path.join(paths.preview, 'mission.txt'), 'MISSION\nT1 ADDS\n', 'utf8')
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2) }
    const absorb = createAbsorb(fixture)

    const listed = await absorb.absorbRepo(mission, 'r1')

    expect(listed).toEqual({
      applied: 0,
      ambiguous: [{ file: 'mission.txt', line: 1, candidateTaskIds: ['t1', 't2'] }]
    })
    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2) }).toEqual(tips)

    const chosen = await absorb.absorbRepo(mission, 'r1', { 'mission.txt:1': 't1' })

    expect(chosen).toEqual({ applied: 1, ambiguous: [] })
    expect(git(paths.t1, ['show', 'HEAD:mission.txt'])).toBe('MISSION\nT1 ADDS')
    expect(git(paths.preview, ['status', '--porcelain'])).toBe('')
    expect(tipOf(paths.preview)).toBe(tipOf(paths.t2))
  })

  it('rejects a choice of a layer the hunk cannot be placed in and writes nothing', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    await writeFile(path.join(paths.preview, 'shared.txt'), 'one\ntwo\nTHREE\nFOUR\n', 'utf8')
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }
    const edits = previewEditsOf(paths.preview)

    await expect(
      createAbsorb(fixture).absorbRepo(mission, 'r1', { 'shared.txt:3': 't1' })
    ).rejects.toThrow('mission_absorb_override_unplaceable: shared.txt:3')

    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }).toEqual(
      tips
    )
    expect(previewEditsOf(paths.preview)).toEqual(edits)
  })

  it('ignores a dirty or busy layer below the lowest owner', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    await writeFile(path.join(paths.t1, 'scratch.txt'), 'wip\n', 'utf8')
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')
    const t1Tip = tipOf(paths.t1)

    const result = await createAbsorb(fixture, (id) => id === `r1::${paths.t1}`).absorbRepo(
      mission,
      'r1'
    )

    expect(result.applied).toBe(1)
    expect(tipOf(paths.t1)).toBe(t1Tip)
    expect(git(paths.t1, ['status', '--porcelain'])).toBe('?? scratch.txt')
    expect(git(paths.t2, ['show', 'HEAD:extra.txt'])).toBe('extra')
  })

  it('refuses a stack whose layers are not on their parents', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    await commitFile(paths.t1, 'late.txt', 'late\n', 't1 late')
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')
    const t2Tip = tipOf(paths.t2)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'mission_absorb_stack_stale'
    )
    expect(tipOf(paths.t2)).toBe(t2Tip)
  })

  it('refuses a layer moved off its parent although its recorded base still matches', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    // Why: t2 keeps its tree but leaves t1's tip; autosquash onto that tip would drag t1 into it.
    const moved = git(paths.t2, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD~1', '-m', 'moved'])
    git(paths.t1, ['commit', '-q', '--amend', '-m', 't1 extends mission (amended)'])
    git(paths.t2, ['reset', '-q', '--hard', moved])
    mission.tasks![1].parentBaseSha = tipOf(paths.t1)
    git(paths.preview, ['reset', '-q', '--hard', tipOf(paths.t2)])
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')
    const t2Tip = tipOf(paths.t2)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'mission_absorb_stack_stale'
    )
    expect(tipOf(paths.t2)).toBe(t2Tip)
  })

  it('restores every rewritten layer and keeps the preview edits when a higher layer fails', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths, root } = fixture
    // Why: only commits in task 2's checkout fail, after task 1 already took its fixup.
    await installPreCommitHook(root, 't2', 'exit 1')
    await editT1LineAndAddFile(paths.preview)
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }
    const edits = previewEditsOf(paths.preview)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow()

    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }).toEqual(
      tips
    )
    expect(git(paths.t1, ['status', '--porcelain'])).toBe('')
    expect(git(paths.t2, ['status', '--porcelain'])).toBe('')
    expect(previewEditsOf(paths.preview)).toEqual(edits)
  })

  it('never resets a layer that became dirty after the idle check', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths, root } = fixture
    // Why: an agent edits task 2 while task 1 takes its fixup.
    const t2File = toShellPath(path.join(paths.t2, 't2.txt'))
    await installPreCommitHook(root, 't1', `printf 'agent edit\\n' > '${t2File}'`)
    await editT1LineAndAddFile(paths.preview)
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2) }
    const edits = previewEditsOf(paths.preview)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'mission_layer_not_clean'
    )

    expect(await readFile(path.join(paths.t2, 't2.txt'), 'utf8')).toBe('agent edit\n')
    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2) }).toEqual(tips)
    expect(previewEditsOf(paths.preview)).toEqual(edits)
  })

  it('keeps a written layer that became dirty and reports it as not restored', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths, root } = fixture
    // Why: an agent edits task 1's absorbed file, then task 2's commit fails.
    const t1File = toShellPath(path.join(paths.t1, 't1.txt'))
    await installPreCommitHook(root, 't2', `printf 'agent edit\\n' > '${t1File}'\nexit 1`)
    await editT1LineAndAddFile(paths.preview)
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2) }
    const edits = previewEditsOf(paths.preview)

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'could not restore mission-task/x/t1'
    )

    expect(await readFile(path.join(paths.t1, 't1.txt'), 'utf8')).toBe('agent edit\n')
    expect(tipOf(paths.t1)).not.toBe(tips.t1)
    expect(tipOf(paths.t2)).toBe(tips.t2)
    expect(previewEditsOf(paths.preview)).toEqual(edits)
  })

  it('puts the layers back when the preview changed during the absorb', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths, root } = fixture
    const extraFile = toShellPath(path.join(paths.preview, 'extra.txt'))
    await installPreCommitHook(root, 't2', `printf 'more\\n' >> '${extraFile}'`)
    await editT1LineAndAddFile(paths.preview)
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }

    await expect(createAbsorb(fixture).absorbRepo(mission, 'r1')).rejects.toThrow(
      'mission_absorb_preview_changed'
    )

    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2), preview: tipOf(paths.preview) }).toEqual(
      tips
    )
    expect(await readFile(path.join(paths.preview, 'extra.txt'), 'utf8')).toBe('extra\nmore\n')
    expect(await readFile(path.join(paths.preview, 't1.txt'), 'utf8')).toBe(
      'from t2\n\na\nb\nc\nt1 tuned\n'
    )
  })
})
