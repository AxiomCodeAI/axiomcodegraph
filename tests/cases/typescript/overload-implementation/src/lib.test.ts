import { expect, it } from 'vitest'
import { Box, pick } from './lib'

it('picks', () => {
  expect(pick(1)).toBe(1)
})

it('boxes', () => {
  expect(new Box().get('a')).toBe('a')
})
