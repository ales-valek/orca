import { describe, expect, it } from 'vitest'
import type { languages } from 'monaco-editor'
import { withDecoratorToken } from './decorator-tokens'

const base: languages.IMonarchLanguage = {
  defaultToken: 'invalid',
  tokenizer: {
    root: [{ include: '@common' }],
    common: [[/#?[a-z_$][\w$]*/, 'identifier']]
  }
}

describe('withDecoratorToken', () => {
  it('tokenizes @Decorator before the identifier rule', () => {
    const language = withDecoratorToken(base)
    expect(language.tokenizer.common?.[0]).toEqual([/@[a-zA-Z_$][\w$]*/, 'keyword'])
    expect(language.tokenizer.common).toHaveLength(2)
    expect(language.defaultToken).toBe('invalid')
  })

  it('leaves a grammar without a common state unchanged', () => {
    const language: languages.IMonarchLanguage = { tokenizer: { root: [] } }
    expect(withDecoratorToken(language)).toBe(language)
  })
})
