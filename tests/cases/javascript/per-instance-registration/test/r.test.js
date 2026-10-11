import { test } from 'node:test';
import { runR2 } from '../src/d.js';
test('the second registry runs its handler', () => { runR2(); });
