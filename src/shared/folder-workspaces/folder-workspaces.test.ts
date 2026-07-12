import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeFolderWorkspaces } from './folder-workspaces'
import type { ProjectGroup } from '../project-group-types'
import type { FolderWorkspace } from './folder-workspace-types'

const missionRootPath = path.join(path.sep, 'home', 'orca', 'missions', 'referral')

const folderGroup = {
  id: 'group-1',
  name: 'Projects',
  parentPath: '/tmp/projects',
  connectionId: null
} as unknown as ProjectGroup

describe('normalizeFolderWorkspaces host attribution', () => {
  it('drops a stored executionHostId instead of round-tripping it', () => {
    const [workspace] = normalizeFolderWorkspaces(
      [
        {
          id: 'ws-1',
          projectGroupId: 'group-1',
          name: 'Nightly',
          folderPath: '/tmp/projects/nightly',
          connectionId: null,
          executionHostId: 'runtime:env-7'
        }
      ],
      [folderGroup]
    )

    // Runtime stamps name an authority the desktop store does not own and lack a generation fence; persisting them recreates #12 divergence.
    expect(workspace).toBeDefined()
    expect(workspace.executionHostId).toBeUndefined()
    expect(Object.keys(workspace)).not.toContain('executionHostId')
  })

  it('keeps connectionId as the durable host pin', () => {
    const [pinned] = normalizeFolderWorkspaces(
      [
        {
          id: 'ws-2',
          projectGroupId: 'group-1',
          name: 'Pinned',
          folderPath: '/tmp/projects/pinned',
          connectionId: 'ssh-box',
          executionHostId: 'local'
        }
      ],
      [folderGroup]
    )

    expect(pinned.connectionId).toBe('ssh-box')
    expect(pinned.executionHostId).toBeUndefined()
  })

  it('inherits the group connection when the workspace omits one', () => {
    const [inherited] = normalizeFolderWorkspaces(
      [{ id: 'ws-3', projectGroupId: 'group-1', name: 'Inherited' }],
      [{ ...folderGroup, connectionId: 'ssh-group' } as ProjectGroup]
    )

    expect(inherited.connectionId).toBe('ssh-group')
  })
})

function makeWorkspace(overrides: Partial<FolderWorkspace> & { id: string }): FolderWorkspace {
  return {
    projectGroupId: 'group-1',
    name: 'WS',
    folderPath: '/tmp/projects',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('normalizeFolderWorkspaces (mission-owned)', () => {
  it('keeps mission-owned workspaces when their mission exists', () => {
    const result = normalizeFolderWorkspaces(
      [makeWorkspace({ id: 'fw1', projectGroupId: 'mission:m1', missionId: 'm1' })],
      [],
      [{ id: 'm1', rootPath: missionRootPath }]
    )
    expect(result).toHaveLength(1)
    expect(result[0].missionId).toBe('m1')
    expect(result[0].projectGroupId).toBe('mission:m1')
  })

  it('drops mission-owned workspaces whose mission is gone', () => {
    const result = normalizeFolderWorkspaces(
      [makeWorkspace({ id: 'fw1', projectGroupId: 'mission:m1', missionId: 'm1' })],
      [folderGroup],
      []
    )
    expect(result).toHaveLength(0)
  })

  it('falls back mission workspace folderPath to the mission rootPath', () => {
    const result = normalizeFolderWorkspaces(
      [
        makeWorkspace({
          id: 'fw1',
          projectGroupId: 'mission:m1',
          missionId: 'm1',
          folderPath: ''
        })
      ],
      [],
      [{ id: 'm1', rootPath: missionRootPath }]
    )
    expect(result[0].folderPath).toBe(missionRootPath)
  })

  it('keeps group-owned behavior unchanged (orphans still drop)', () => {
    const result = normalizeFolderWorkspaces(
      [makeWorkspace({ id: 'ok' }), makeWorkspace({ id: 'orphan', projectGroupId: 'missing' })],
      [folderGroup],
      []
    )
    expect(result.map((ws) => ws.id)).toEqual(['ok'])
  })
})
