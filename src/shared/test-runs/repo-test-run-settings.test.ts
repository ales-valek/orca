import { describe, expect, it } from 'vitest'
import {
  getKnownBugAnnotations,
  getTierPattern,
  normalizeRepoTestRunSettings
} from './repo-test-run-settings'

describe('repo test run settings', () => {
  it('keeps valid settings and drops junk', () => {
    expect(
      normalizeRepoTestRunSettings({
        tierPattern: 'smoke-(\\d+)',
        cumulativeTiers: true,
        knownBugAnnotations: ['bug-pin', '', 3, 'issue'],
        extra: 'x'
      })
    ).toEqual({
      tierPattern: 'smoke-(\\d+)',
      cumulativeTiers: true,
      knownBugAnnotations: ['bug-pin', 'issue']
    })
    expect(normalizeRepoTestRunSettings('nope')).toBeUndefined()
    expect(normalizeRepoTestRunSettings({ cumulativeTiers: 'yes' })).toEqual({})
  })

  it('falls back to the default tier pattern for invalid or capture-less input', () => {
    expect(getTierPattern(undefined).exec('tests/eshop/tier-3/a.spec.ts')?.[1]).toBe('3')
    expect(getTierPattern({ tierPattern: '(' }).exec('tests/tier-2/a.spec.ts')?.[1]).toBe('2')
    expect(getTierPattern({ tierPattern: 'tier' }).exec('tests/tier-2/a.spec.ts')?.[1]).toBe('2')
    expect(getTierPattern({ tierPattern: 'smoke-(\\d+)' }).exec('e2e/smoke-4/a.spec.ts')?.[1]).toBe(
      '4'
    )
  })

  it('reads custom known-bug annotations', () => {
    expect(getKnownBugAnnotations(undefined)).toEqual(['bug-pin'])
    expect(getKnownBugAnnotations({ knownBugAnnotations: ['issue'] })).toEqual(['issue'])
    expect(getKnownBugAnnotations({ knownBugAnnotations: [] })).toEqual(['bug-pin'])
  })
})
