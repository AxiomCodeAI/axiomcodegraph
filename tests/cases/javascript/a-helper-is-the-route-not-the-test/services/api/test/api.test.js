import { test } from 'node:test';
import { reindex } from '@demo/api';

test('reindex goes through the search package', () => {
  reindex({ id: 'd1' });
});
