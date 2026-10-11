import { describe, it, expect } from 'vitest'
import { sum } from '../sum'

describe('sum', () => {
  it('adds', () => {
    expect(sum(1, 2)).toBe(4)
  })
})
