import { expect, it } from 'vitest'
import { merged } from './factory'

it('calls the merged target', () => {
  expect(merged(1)).toBe(1)
})
