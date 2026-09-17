import { describe, it, expect } from 'vitest';
import { normalize, shout } from './lib';

function build(raw: string): string {
  return normalize(raw);
}

describe('normalize', () => {
  it('trims', () => {
    expect(normalize(' a ')).toBe('a');
  });

  it('is used by a helper', () => {
    expect(build(' b ')).toBe('b');
  });
});

describe('shout', () => {
  it('upper-cases', () => {
    expect(shout('c')).toBe('C');
  });
});
