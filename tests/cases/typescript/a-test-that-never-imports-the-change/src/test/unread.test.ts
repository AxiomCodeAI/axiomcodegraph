import { run } from '../src/runner'
import { alpha } from '~/mw/alpha'

test('an alias no config here declares', () => {
  expect(run(alpha, 1)).toBe(2)
})
