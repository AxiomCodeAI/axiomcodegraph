import { test } from 'node:test';
import { runC } from '../src/c.js';
test('runC emits on a bare bus', () => { runC(); });
