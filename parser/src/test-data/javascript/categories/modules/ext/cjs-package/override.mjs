// fixture: ext/cjs-package/override.mjs
// module system: ESM BY EXTENSION, inside a CommonJS package
//   governing: staging/ext/cjs-package/package.json, "type": "commonjs"
//   moduleSystemSource = EXT_MJS. Again no contradiction — the extension is
//   authoritative, and this file runs.
// nature: runtime-bearing
// syntax floor: ES2020 (import.meta), ES2022 for the top-level await below
//
// Grounded in the .mjs entry points that CommonJS packages add for ESM
// consumers — the `*.mjs` shim beside a CommonJS main.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sibling = require('./plain.js');

// Top-level await. Legal ONLY in an ES module, and its presence is itself
// evidence of the module system — js_module.hasTopLevelAwait exists to record
// that. [ES2022 / Node >= 14.8]
const { EOL } = await import('node:os');

assert.ok(sibling);

export default function join(parts) {
  return parts.join(EOL);
}
