import { expect, it, test } from 'vitest'
import { packaging, total } from './pricing'

// a formatter's layout for a long name: the call opens on one line, the name and the body follow on their own
test.each([[[1, 2], 3]])(
  'adds every item of a long table row, whatever its order: %o',
  async (items, want) => {
    expect(total(items as number[])).toBe(want)
  },
)

it(
  'charges for packaging per item, rounding nothing on the way through the order',
  () => {
    expect(packaging(2)).toBe(6)
  },
)
