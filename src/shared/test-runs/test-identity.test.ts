import { describe, expect, it } from 'vitest'
import { getRepoKey, getTestIdentity, getTestTier, normalizeOriginUrl } from './test-identity'

const TEST = {
  configFile: 'playwright.config.ts',
  project: 'chromium',
  file: 'tests/eshop/tier-1/cart.spec.ts',
  titlePath: ['ESH-CART-01 — Add single product', 'adds it']
}

describe('test identity', () => {
  it('builds the same identity from two worktrees of one repo', () => {
    const fromMain = getTestIdentity({
      ...TEST,
      originUrl: 'git@github.com:ordermage/tests.git',
      repoRootName: 'tests'
    })
    const fromFeature = getTestIdentity({
      ...TEST,
      originUrl: 'https://github.com/ordermage/tests',
      repoRootName: 'omp-2697'
    })
    expect(fromFeature).toBe(fromMain)
  })

  it('falls back to the repo folder name without a remote', () => {
    expect(getTestIdentity({ ...TEST, originUrl: null, repoRootName: 'tests' })).toBe(
      'tests|playwright.config.ts|chromium|tests/eshop/tier-1/cart.spec.ts|ESH-CART-01 — Add single product › adds it'
    )
  })

  it('reads the tier from a tier-N folder', () => {
    expect(getTestTier('tests/eshop/tier-3/x.spec.ts')).toBe(3)
    expect(getTestTier('tests/x.spec.ts')).toBeNull()
  })

  it('accepts a custom tier pattern', () => {
    expect(getTestTier('e2e/smoke-2/x.spec.ts', /(?:^|\/)smoke-(\d+)\//)).toBe(2)
  })

  it('normalizes ssh and https origin urls to one value', () => {
    expect(normalizeOriginUrl('git@github.com:Org/Repo.git')).toBe('github.com/org/repo')
    expect(normalizeOriginUrl('https://user:token@github.com/Org/Repo')).toBe('github.com/org/repo')
    expect(normalizeOriginUrl('ssh://git@github.com/Org/Repo.git/')).toBe('github.com/org/repo')
  })
})

describe('getRepoKey', () => {
  it('uses the remote, or the folder name of a repo without one', () => {
    expect(getRepoKey({ root: '/w/feature', originUrl: 'git@github.com:o/tests.git' })).toBe(
      'github.com/o/tests'
    )
    expect(getRepoKey({ root: 'C:\\w\\tests', originUrl: null })).toBe('tests')
  })
})
