// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type {
  GitBranchChangeEntry,
  GitBranchCompareSummary
} from '../../../../shared/git/diff/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../shared/git/status/git-status-types'
import type { DiffContent, FileContent } from './editor-panel-content-types'

const mocks = vi.hoisted(() => ({
  readRuntimeFileContent: vi.fn(),
  getRuntimeGitDiff: vi.fn(),
  getRuntimeGitBranchDiff: vi.fn(),
  getConnectionId: vi.fn(),
  getConnectionIdForFile: vi.fn(),
  isWorktreeConnectionResolved: vi.fn(() => true),
  getState: vi.fn()
}))

vi.mock('@/runtime/files/runtime-file-routing', () => ({
  getRuntimeFileReadScope: vi.fn(
    (
      target: { kind: 'local' } | { kind: 'environment'; environmentId: string },
      connectionId?: string
    ) => connectionId ?? (target.kind === 'environment' ? target.environmentId : null)
  )
}))
vi.mock('@/runtime/files/reads/runtime-file-read-client', () => ({
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))
vi.mock('@/runtime/files/watching/runtime-file-watch-client', () => ({
  subscribeRuntimeFileChanges: vi.fn()
}))

vi.mock('@/runtime/source-control/git/runtime-git-diff-client', () => ({
  getRuntimeGitBranchDiff: mocks.getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff: vi.fn(),
  getRuntimeGitDiff: mocks.getRuntimeGitDiff
}))
vi.mock('@/runtime/source-control/git/runtime-git-client-context', () => ({
  getRuntimeGitScope: vi.fn(() => null)
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: mocks.getConnectionId,
  getConnectionIdForFile: mocks.getConnectionIdForFile,
  isWorktreeConnectionResolved: mocks.isWorktreeConnectionResolved
}))

vi.mock(
  '@/lib/workspace/ownership/worktree-host-connection-phase',
  () => import('./local-host-test-fixture')
)

vi.mock('@/lib/runtime-workspace-file-route', () => ({
  findWorkspaceFileRoute: vi.fn(() => null)
}))

// Fixture owners: `repo-runtime::` workspaces live on runtime-1, everything else here is local.
vi.mock('@/lib/file-owner-runtime-target', () => {
  const ownerTarget = (_s: unknown, worktreeId?: string, owner?: string | null) => {
    const id = owner === undefined && worktreeId?.startsWith('repo-runtime::') ? 'runtime-1' : owner
    return id ? { kind: 'environment', environmentId: id } : { kind: 'local' }
  }
  return {
    getRuntimeTargetForFileOwner: ownerTarget,
    requireRuntimeTargetForFileOwner: ownerTarget
  }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (select: (state: ReturnType<typeof mocks.getState>) => unknown) => select(mocks.getState()),
    { getState: mocks.getState }
  )
}))

import { useEditorPanelContentState } from './useEditorPanelContentState'
import { createTestStore } from '@/store/testing/app-store-test-fixture'

type ProbeProps = {
  activeFile: OpenFile | null
  openFiles: OpenFile[]
  gitStatusByWorktree?: Record<string, GitStatusEntry[]>
  gitBranchChangesByWorktree?: Record<string, GitBranchChangeEntry[]>
  gitBranchCompareSummaryByWorktree?: Record<string, GitBranchCompareSummary | null>
}

// Why: opening any liveTail tab arms useLocalLogTail's change subscription.
const onLocalLogTailChanged = vi.fn(() => () => {})
const fsApi = { onLocalLogTailChanged }
let latestFileContents: Record<string, FileContent> = {}
let latestDiffContents: Record<string, DiffContent> = {}
const EMPTY_GIT_STATUS_BY_WORKTREE: Record<string, GitStatusEntry[]> = {}
const EMPTY_GIT_BRANCH_CHANGES_BY_WORKTREE: Record<string, GitBranchChangeEntry[]> = {}
const EMPTY_GIT_BRANCH_COMPARE_SUMMARY_BY_WORKTREE: Record<string, GitBranchCompareSummary | null> =
  {}

function HookProbe({
  activeFile,
  openFiles,
  gitStatusByWorktree = EMPTY_GIT_STATUS_BY_WORKTREE,
  gitBranchChangesByWorktree = EMPTY_GIT_BRANCH_CHANGES_BY_WORKTREE,
  gitBranchCompareSummaryByWorktree = EMPTY_GIT_BRANCH_COMPARE_SUMMARY_BY_WORKTREE
}: ProbeProps): null {
  const state = useEditorPanelContentState({
    activeFile,
    isChangesMode: false,
    openFiles,
    gitStatusEntries: activeFile ? gitStatusByWorktree[activeFile.worktreeId] : undefined,
    gitBranchEntries: activeFile ? gitBranchChangesByWorktree[activeFile.worktreeId] : undefined,
    gitBranchCompareSummary: activeFile
      ? gitBranchCompareSummaryByWorktree[activeFile.worktreeId]
      : undefined,
    changedLineHighlightsEnabled: true,
    editorViewMode: {}
  })
  latestFileContents = state.fileContents
  latestDiffContents = state.diffContents
  return null
}

function createOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('useEditorPanelContentState diff loading', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    latestFileContents = {}
    latestDiffContents = {}
    onLocalLogTailChanged.mockClear()
    ;(window as unknown as { api: unknown }).api = { fs: fsApi }
    mocks.readRuntimeFileContent.mockReset()
    mocks.getRuntimeGitDiff.mockReset()
    mocks.getRuntimeGitBranchDiff.mockReset()
    mocks.getConnectionId.mockReset()
    mocks.getConnectionId.mockReturnValue(undefined)
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.isWorktreeConnectionResolved.mockReset()
    mocks.isWorktreeConnectionResolved.mockReturnValue(true)
    mocks.getState.mockReset()
    mocks.getState.mockReturnValue({
      ...createTestStore().getState(),
      settings: null,
      repos: [{ id: 'repo-1', path: '/repo', hostId: 'local' }],
      worktreesByRepo: {
        'repo-1': [{ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' }]
      },
      openFiles: [],
      setLastKnownDiskSignature: vi.fn()
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  it('loads branch comparison diffs for normal edit tabs changed relative to base', async () => {
    const activeFile = createOpenFile({
      id: '/repo/src/file.ts',
      filePath: '/repo/src/file.ts',
      relativePath: 'src/file.ts',
      worktreeId: 'wt-1'
    })
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'new', isBinary: false })
    mocks.getRuntimeGitBranchDiff.mockResolvedValue({
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'new',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitBranchChangesByWorktree={{
            'wt-1': [{ path: 'src/file.ts', status: 'modified' }]
          }}
          gitBranchCompareSummaryByWorktree={{
            'wt-1': {
              baseRef: 'origin/main',
              compareRef: 'feature/example',
              baseOid: 'base',
              headOid: 'head',
              mergeBase: 'merge-base',
              changedFiles: 1,
              status: 'ready'
            }
          }}
        />
      )
    })

    await vi.waitFor(() => expect(latestDiffContents[activeFile.id]?.originalContent).toBe('old'))
    expect(mocks.getRuntimeGitBranchDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      }),
      expect.objectContaining({
        compare: expect.objectContaining({
          baseOid: 'base',
          headOid: 'head',
          mergeBase: 'merge-base'
        }),
        filePath: 'src/file.ts'
      }),
      // Showing the tab is a user act.
      { wakeWslDistro: true }
    )
    expect(mocks.getRuntimeGitDiff).not.toHaveBeenCalled()
  })

  it('loads a diff baseline for changed edit tabs outside Changes mode', async () => {
    const activeFile = createOpenFile()
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'fresh content', isBinary: false })
    mocks.getRuntimeGitDiff.mockResolvedValue({
      kind: 'text',
      originalContent: 'old content',
      modifiedContent: 'fresh content',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitStatusByWorktree={{
            'wt-1': [{ path: 'file.ts', status: 'modified', area: 'unstaged' }]
          }}
        />
      )
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]?.originalContent).toBe('old content')
    )
    expect(mocks.getRuntimeGitDiff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filePath: 'file.ts',
        compareAgainstHead: true,
        staged: false
      }),
      // Showing the tab is a user act.
      { wakeWslDistro: true }
    )
  })

  it('does not load a diff baseline for clean edit tabs outside Changes mode', async () => {
    const activeFile = createOpenFile()
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'fresh content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('fresh content'))
    expect(mocks.getRuntimeGitDiff).not.toHaveBeenCalled()
  })
})
