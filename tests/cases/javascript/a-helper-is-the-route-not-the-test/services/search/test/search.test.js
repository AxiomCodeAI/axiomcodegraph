import { test } from 'node:test';
import { testApp } from './helpers.js';

test('a created document is indexed through the app', async () => {
  await testApp();
});
