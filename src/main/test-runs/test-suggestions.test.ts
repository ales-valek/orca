import { describe, expect, it } from 'vitest'
import { buildTestSuggestionPrompt, parseTestSuggestions } from './test-suggestions'

describe('test suggestions', () => {
  it('builds a prompt listing changes and numbered tests', () => {
    const prompt = buildTestSuggestionPrompt({
      changedFiles: ['src/cart/Upsell.tsx', 'src/checkout/Summary.tsx'],
      diffStat: ' 2 files changed, 40 insertions(+)',
      tests: [
        {
          index: 0,
          title: 'ESH-CART › ESH-CART-07 upsell modal',
          file: 'tests/eshop/tier-1/cart.spec.ts',
          tags: ['@serial']
        },
        {
          index: 1,
          title: 'ADM-INV-05 stock export',
          file: 'tests/admin/tier-3/stock.spec.ts',
          tags: []
        }
      ]
    })
    expect(prompt).toContain('src/cart/Upsell.tsx')
    expect(prompt).toContain('2 files changed')
    expect(prompt).toContain(
      '0: ESH-CART › ESH-CART-07 upsell modal (tests/eshop/tier-1/cart.spec.ts) @serial'
    )
    expect(prompt).toContain('1: ADM-INV-05 stock export (tests/admin/tier-3/stock.spec.ts)')
    expect(prompt).toMatch(/at most 15/)
    expect(prompt).toMatch(/JSON array/)
  })

  it('keeps only known tests from a noisy agent answer', () => {
    const raw = `Sure! Here are the tests:
[{"index": 1, "reason": "touches stock"}, {"index": 7, "reason": "unknown"}, {"index": 1, "reason": "dup"}, {"index": "0", "reason": "string"}, {"index": 0, "reason": "upsell UI"}]
Hope this helps.`
    expect(parseTestSuggestions(raw, 2)).toEqual([
      { index: 1, reason: 'touches stock' },
      { index: 0, reason: 'upsell UI' }
    ])
  })

  it('returns no suggestions for an empty answer', () => {
    expect(parseTestSuggestions('', 2)).toEqual([])
    expect(parseTestSuggestions('no json here', 2)).toEqual([])
  })
})
