import { test } from 'node:test';
import { TOPICS } from '../src/pkg/topics.js';

test('a delete is published by its type', () => {
  const bus = { publish() {} };
  bus.publish(TOPICS.DELETED, { id: 'd1' });
});
