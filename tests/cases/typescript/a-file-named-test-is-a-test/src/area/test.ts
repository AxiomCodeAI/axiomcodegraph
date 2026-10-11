import { describe, it, expect } from 'vitest';
import { area } from './index';

describe('area', () => {
  it('multiplies the sides', () => {
    expect(area(2, 3)).toBe(6);
  });
});
