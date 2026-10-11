import { describe, it, expect } from 'vitest';
import { purge, runTable } from './dispatch';
import { onLoad } from './handlers';

describe('dispatch', () => {
  it('purges', () => {
    expect(purge({}).audited).toBe(true);
  });
  it('runs a table', () => {
    expect(runTable({ load: onLoad }, 'load', {})).toEqual({});
  });
});
