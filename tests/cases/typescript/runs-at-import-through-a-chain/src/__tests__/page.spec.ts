import { describe, it, expect } from 'vitest'
import { page } from '../page'

describe('page', () => {
  it('wraps', () => {
    expect(page('x')).toBe('<b>x')
  })
})
