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
  git(paths.t2, ['rebase', '-q', tipOf(paths.t1)])
  fixture.mission.tasks![1].parentBaseSha = tipOf(paths.t1)
  await commitFile(paths.t2, 't1.txt', 'from t2\n\na\nb\nc\nt1\n', 't2 prepends')
  git(paths.preview, ['reset', '-q', '--hard', tipOf(paths.t2)])
  fixture.mission.previews![0].followedSha = tipOf(paths.t2)
  return fixture
}

function createAbsorb({ deps }: TaskStackFixture): MissionTaskAbsorb {
  return new MissionTaskAbsorb({
    store: deps.store,
    restacker: new MissionTaskRestack(deps),
    isWorktreeAgentWorking: deps.isWorktreeAgentWorking
  })
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
    await writeFile(path.join(paths.preview, 't1.txt'), 'from t2\n\na\nb\nc\nt1 tuned\n', 'utf8')
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')
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

  it('lists a hunk spanning two layers without touching anything, then applies the chosen layer', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths } = fixture
    // Why: lines 3 and 4 of shared.txt come from task 1 and task 2.
    await writeFile(path.join(paths.preview, 'shared.txt'), 'one\ntwo\nTHREE\nFOUR\n', 'utf8')
    const tips = { t1: tipOf(paths.t1), t2: tipOf(paths.t2) }
    const absorb = createAbsorb(fixture)

    const listed = await absorb.absorbRepo(mission, 'r1')

    expect(listed).toEqual({
      applied: 0,
      ambiguous: [{ file: 'shared.txt', line: 3, candidateTaskIds: ['t1', 't2'] }]
    })
    expect({ t1: tipOf(paths.t1), t2: tipOf(paths.t2) }).toEqual(tips)

    const chosen = await absorb.absorbRepo(mission, 'r1', { 'shared.txt:3': 't2' })

    expect(chosen).toEqual({ applied: 1, ambiguous: [] })
    expect(tipOf(paths.t1)).toBe(tips.t1)
    expect(layerCount(paths.t2, 'mission-task/x/t1')).toBe(3)
    expect(git(paths.t2, ['show', 'HEAD:shared.txt'])).toBe('one\ntwo\nTHREE\nFOUR')
    expect(git(paths.preview, ['status', '--porcelain'])).toBe('')
  })

  it('restores every rewritten layer and keeps the preview edits when a higher layer fails', async () => {
    const fixture = await createAbsorbStack()
    const { mission, paths, root } = fixture
    const hook = path.join(root, '.git', 'hooks', 'pre-commit')
    // Why: only commits in task 2's checkout fail, after task 1 already took its fixup.
    await writeFile(
      hook,
      '#!/bin/sh\ncase "$(git rev-parse --show-toplevel)" in */t2) exit 1;; esac\n',
      'utf8'
    )
    await chmod(hook, 0o755)
    await writeFile(path.join(paths.preview, 't1.txt'), 'from t2\n\na\nb\nc\nt1 tuned\n', 'utf8')
    await writeFile(path.join(paths.preview, 'extra.txt'), 'extra\n', 'utf8')
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
})
