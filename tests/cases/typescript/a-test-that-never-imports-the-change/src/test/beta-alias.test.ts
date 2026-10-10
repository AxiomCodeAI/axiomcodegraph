import { run } from '@app/runner'
import { beta } from '@app/mw/beta'

test('beta by its alias', () => {
  expect(run(beta, 2)).toBe(4)
})
