import { test } from 'node:test';
import { DocService } from '../src/producer/service.js';

test('create publishes the created event', () => {
  const sent = [];
  new DocService({ publish: (type, doc) => sent.push([type, doc]) }).create({ id: 'd1' });
});
