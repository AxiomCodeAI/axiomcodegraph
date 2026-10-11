import { expect, it } from 'vitest'
import { late, settle } from './pricing'

// control: inside a test body, a callback on its own line is the argument of `settle(`, not of `it(`
it('settles late', () => {
  const got = settle(
    () => late(),
  )
  expect(got).toBe(1)
})
