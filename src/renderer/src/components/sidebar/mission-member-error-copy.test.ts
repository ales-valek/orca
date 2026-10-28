import { describe, expect, it } from 'vitest'
import { formatMissionMemberError } from './mission-member-error-copy'

describe('formatMissionMemberError', () => {
  it('maps the CLI-flavored default-base-ref error to actionable copy', () => {
    const formatted = formatMissionMemberError(
      'Could not resolve a default base ref for this repo. Pass an explicit --base and try again.'
    )
    expect(formatted).toContain('no commits or default branch')
    expect(formatted).not.toContain('--base')
  })

  it('passes unknown errors through verbatim', () => {
    const raw = 'Branch "mission/x" already exists locally. Pick a different branch.'
    expect(formatMissionMemberError(raw)).toBe(raw)
  })

  it('maps stack error codes to short sentences', () => {
    expect(formatMissionMemberError('mission_absorb_layers_busy')).toBe(
      'A task layer has uncommitted changes or a working agent. Absorb needs every affected layer clean and idle.'
    )
    expect(
      formatMissionMemberError('Layer mission-task/x/a: mission_layer_not_clean')
    ).not.toContain('mission_layer_not_clean')
  })
})
