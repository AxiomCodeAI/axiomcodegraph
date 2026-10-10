import { run } from '@app/runner'
import { alpha } from '@app/mw/alpha'

test('alpha by its alias', () => {
  expect(run(alpha, 2)).toBe(3)
})
