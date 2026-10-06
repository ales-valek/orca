import { describe, expect, it } from 'vitest'
import { answerLspServerRequest } from './lsp-eslint-configuration'

describe('answerLspServerRequest', () => {
  it('returns one null per configuration item except eslint settings', () => {
    expect(
      answerLspServerRequest('workspace/configuration', {
        items: [{ section: 'typescript' }, { section: 'eslint' }, { section: 'javascript' }]
      })
    ).toEqual([null, expect.objectContaining({ validate: 'on', run: 'onType' }), null])
  })

  it('approves eslint execution and leaves other requests empty', () => {
    expect(answerLspServerRequest('eslint/confirmESLintExecution', { scope: '/repo' })).toBe(4)
    expect(answerLspServerRequest('window/showMessageRequest', {})).toBeNull()
    expect(answerLspServerRequest('workspace/configuration', {})).toBeNull()
  })
})
