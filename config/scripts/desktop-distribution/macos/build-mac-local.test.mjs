import { describe, expect, it } from 'vitest'
import { createLocalBuildVersion, resolveLocalBuildBaseVersion } from './build-mac-local.mjs'

describe('createLocalBuildVersion', () => {
  it('creates unique valid prerelease versions without changing the release base', () => {
    expect(createLocalBuildVersion('1.4.159-rc.0', 123456, 'abc123')).toBe(
      '1.4.159-rc.0.local.123456.abc123'
    )
    expect(createLocalBuildVersion('1.4.159', 123456, 'abc123')).toBe('1.4.159-local.123456.abc123')
  })

  it('sanitizes commit identifiers', () => {
    expect(createLocalBuildVersion('1.0.0', 1, 'abc/def')).toBe('1.0.0-local.1.abcdef')
  })
})

describe('resolveLocalBuildBaseVersion', () => {
  it('sorts above the newest stable tag, ignoring prereleases', () => {
    const tags = ['v1.4.9', 'v1.4.250', 'v1.4.251-rc.0', 'mobile-android-v9.9.9', '']
    expect(resolveLocalBuildBaseVersion('1.4.214', tags)).toBe('1.4.251')
  })

  it('keeps the package version when no tag is newer or tags are missing', () => {
    expect(resolveLocalBuildBaseVersion('1.4.214', [])).toBe('1.4.214')
    expect(resolveLocalBuildBaseVersion('1.4.214-rc.0', ['v1.4.100'])).toBe('1.4.214-rc.0')
  })
})
