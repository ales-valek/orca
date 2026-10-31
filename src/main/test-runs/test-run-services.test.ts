import { describe, expect, it } from 'vitest'
import type {
  TestRunSourceOption,
  TestRunTargetOption
} from '../../shared/test-runs/test-run-launch-types'
import { pickTestRunDefaults } from './test-run-services'

const TARGETS: TestRunTargetOption[] = [
  { id: 'preset:dev', target: { kind: 'preset', name: 'dev' }, label: 'dev', isShared: true },
  {
    id: 'dev-env:kiosek',
    target: { kind: 'dev-env', devEnvId: 'kiosek' },
    label: 'Kiosek',
    isShared: false
  }
]
const SOURCES: TestRunSourceOption[] = [
  {
    id: 'origin-main:tests',
    kind: 'origin-main',
    repoId: 'tests',
    path: '/r/tests',
    label: 'tests @ origin/main',
    configFiles: ['playwright.config.ts']
  },
  {
    id: 'worktree:w-tests',
    kind: 'worktree',
    repoId: 'tests',
    path: '/w/tests',
    label: 'tests · feature',
    configFiles: ['playwright.config.ts']
  }
]

describe('pickTestRunDefaults', () => {
  it("uses the workspace's environment and its own tests when it is the test repo", () => {
    expect(
      pickTestRunDefaults({
        targets: TARGETS,
        sources: SOURCES,
        worktreeId: 'w-tests',
        devEnvId: 'kiosek'
      })
    ).toEqual({
      targetId: 'dev-env:kiosek',
      sourceId: 'worktree:w-tests'
    })
  })

  it('falls back to origin/main and the first target', () => {
    expect(
      pickTestRunDefaults({
        targets: TARGETS,
        sources: SOURCES,
        worktreeId: 'w-eshop',
        devEnvId: null
      })
    ).toEqual({
      targetId: 'preset:dev',
      sourceId: 'worktree:w-tests'
    })
    expect(
      pickTestRunDefaults({
        targets: TARGETS,
        sources: SOURCES,
        worktreeId: 'w-eshop',
        devEnvId: 'kiosek'
      })
    ).toEqual({
      targetId: 'dev-env:kiosek',
      sourceId: 'origin-main:tests'
    })
  })

  it('honours a named target and source', () => {
    expect(
      pickTestRunDefaults({
        targets: TARGETS,
        sources: SOURCES,
        worktreeId: 'w-eshop',
        devEnvId: null,
        target: 'Kiosek',
        source: 'tests @ origin/main'
      })
    ).toEqual({ targetId: 'dev-env:kiosek', sourceId: 'origin-main:tests' })
  })
})
