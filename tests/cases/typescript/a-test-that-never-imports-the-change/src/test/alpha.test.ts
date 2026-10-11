import {
  run,
} from '../src/runner'
import {
  alpha,
} from '../src/mw/alpha'

test('alpha', () => {
  expect(run(alpha, 1)).toBe(2)
})
