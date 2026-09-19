import { describe, it, expect } from 'vitest'
import { check } from '../tags'

describe('tags', () => {
  it('knows a void tag', () => {
    expect(check('br')).toBe(true)
  })
})
