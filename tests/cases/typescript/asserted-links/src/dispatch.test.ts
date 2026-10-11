import { describe, it, expect } from 'vitest';
import { dispatch, runTable } from './dispatch';
import { onLoad } from './handlers';

describe('dispatch', () => {
  it('saves', () => {
    expect(dispatch('onSave', {}).audited).toBe(true);
  });
  it('runs a table', () => {
    expect(runTable({ load: onLoad }, 'load', {})).toEqual({});
  });
});
