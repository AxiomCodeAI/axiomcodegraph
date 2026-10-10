import { describe, expect, it, test } from 'vitest'
import { discount, rounding, shipping, total } from './pricing'

// a table-driven test: test.each(rows) returns the registrar, which is then called
test.each([[[1, 2], 3], [[4], 4]])('total of %o', (items, want) => {
  expect(total(items as number[])).toBe(want)
})

// a table-driven suite: the suite body registers ordinary tests
describe.each([150, 50])('discount of %d', (amount) => {
  it('is never more than the amount', () => {
    expect(discount(amount)).toBeLessThanOrEqual(amount)
  })
})

// a modifier written as a member: the runner still runs it
it.concurrent('ships by weight', () => {
  expect(shipping(2)).toBe(4)
})

// a modifier chain ending in a table
test.concurrent.each([1.005, 2.5])('rounds %d', (v) => {
  expect(rounding(v)).toBeGreaterThan(0)
})
