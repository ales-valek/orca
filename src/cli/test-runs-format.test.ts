import { describe, expect, it } from 'vitest'
import { formatTestResults } from './test-runs-format'

describe('formatTestResults', () => {
  it('prints results with status, title and location', () => {
    expect(
      formatTestResults({
        results: [
          {
            status: 'failed',
            title: 'ESH-CART › ESH-CART-07 upsell modal',
            location: 'tests/eshop/tier-1/cart.spec.ts:12',
            trigger: 'agent',
            startedAt: 0,
            error: 'expect(locator).toBeVisible()'
          },
          {
            status: 'passed',
            title: 'ADM-INV-05 stock export',
            location: 'tests/admin/tier-3/stock.spec.ts:3',
            trigger: 'user',
            startedAt: 0,
            error: null
          }
        ]
      })
    ).toBe(
      [
        '✗ ESH-CART › ESH-CART-07 upsell modal  tests/eshop/tier-1/cart.spec.ts:12',
        '    expect(locator).toBeVisible()',
        '✓ ADM-INV-05 stock export  tests/admin/tier-3/stock.spec.ts:3',
        '',
        '1 passed, 1 failed'
      ].join('\n')
    )
  })
})
