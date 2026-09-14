import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cjs = require('./cjs.cjs');
export function callCjs() { return cjs.fromCjs(); }
