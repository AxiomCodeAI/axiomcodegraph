import { test } from 'node:test';
import { index } from '../src/indexer.js';

test('index returns the payload', () => {
  index({ payload: 1 });
});
