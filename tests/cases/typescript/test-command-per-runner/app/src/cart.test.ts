import { describe, it, expect } from 'vitest';
import { total } from './cart';

describe('cart', () => {
  it('sums the prices', () => {
    expect(total([1, 2, 3])).toBe(6);
  });
});
