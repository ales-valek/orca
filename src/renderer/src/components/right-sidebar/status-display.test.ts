import { describe, expect, it } from 'vitest'
import { mergeBranchAndWorktreeEntries } from './status-display'

describe('mergeBranchAndWorktreeEntries', () => {
  it('prefers the worktree entry over a higher-priority branch entry for the same path', () => {
    const merged = mergeBranchAndWorktreeEntries(
      [{ path: 'src/file.ts', status: 'deleted' }],
      [{ path: 'src/file.ts', status: 'modified' }]
    )
    expect(merged).toEqual([{ path: 'src/file.ts', status: 'modified' }])
  })

  it('keeps the branch entry for a path that is clean in the worktree', () => {
    const merged = mergeBranchAndWorktreeEntries(
      [{ path: 'src/clean-but-changed.ts', status: 'modified' }],
      [{ path: 'src/other.ts', status: 'added' }]
    )
    expect(merged).toEqual([
      { path: 'src/clean-but-changed.ts', status: 'modified' },
      { path: 'src/other.ts', status: 'added' }
    ])
  })

  it('returns the worktree entries unchanged when there are no branch entries', () => {
    const worktreeEntries = [{ path: 'src/file.ts', status: 'modified' as const }]
    expect(mergeBranchAndWorktreeEntries([], worktreeEntries)).toEqual(worktreeEntries)
  })
})
