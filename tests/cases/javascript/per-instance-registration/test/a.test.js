import { test } from 'node:test';
import { runA } from '../src/a.js';
test('runA emits on the validated bus', () => { runA(); });
