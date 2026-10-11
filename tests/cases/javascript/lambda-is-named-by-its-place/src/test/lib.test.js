import test from 'node:test';
import { Orders, wire } from '../lib.js';

test('totals', () => { new Orders().totals([1, -1]); });
test('wire', () => { wire([1]); });
