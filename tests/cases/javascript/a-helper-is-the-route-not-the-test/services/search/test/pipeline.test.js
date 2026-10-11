import { test } from 'node:test';
import { ingest } from '../src/pipeline.js';

test('ingest walks the whole pipeline', () => {
  ingest({ payload: 1 });
});
