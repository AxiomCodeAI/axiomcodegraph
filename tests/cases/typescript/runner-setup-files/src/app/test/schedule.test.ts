import { expect, it } from 'vitest'
import { schedule } from '../lib/client'

it('schedules', () => {
  let ran = false
  schedule(() => { ran = true })
  expect(ran).toBe(true)
})
