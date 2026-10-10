import { run } from '../src/runner'
import { beta } from '../src/mw/beta'

test('beta', () => {
  expect(run(beta, 1)).toBe(2)
})
