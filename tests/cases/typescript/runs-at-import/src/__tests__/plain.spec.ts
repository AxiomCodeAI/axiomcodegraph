import { describe, it, expect } from 'vitest'
import { double } from '../plain'

describe('plain', () => {
  it('doubles', () => {
    expect(double(2)).toBe(4)
  })
})
