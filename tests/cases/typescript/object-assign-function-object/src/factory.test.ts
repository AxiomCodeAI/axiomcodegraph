import { expect, it } from 'vitest'
import { direct, factory } from './factory'

it('builds through the factory', () => {
  expect(factory(1)).toBe(2)
})

it('builds through the direct merge', () => {
  expect(direct(1)).toBe(2)
})
