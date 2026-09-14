// fixture: mismatch/esm-under-commonjs/mixed-both-systems.js
// module system: MIXED — both `import` and `require` in one file
//   governing: staging/mismatch/esm-under-commonjs/package.json, "type": "commonjs"
// nature: runtime-bearing — and it cannot run under EITHER system. As CommonJS
//   the `import` is a syntax error; as ESM the `require` is undefined and
//   `module.exports` is not declared.
// syntax floor: ES2015
//
// contradictionKind = MIXED. This is the row the module-system coherence gate
// (§7.3.4) exists for: "no file emits both require and import module edges
// unless contradictsGoverningConfig is true". A gate needs a file that violates
// the unflagged form to be able to fail, and this is it.
//
// Real provenance: a half-finished ESM migration. Both edges are genuinely in
// the source, so both must be emitted; what must not happen is a fact base that
// records two module systems with no column saying the file is incoherent.

import { EventEmitter } from 'node:events';

const path = require('path');
const { format } = require('util');

export function describe(file) {
  return format('%s in %s', path.basename(file), path.dirname(file));
}

module.exports.legacyDescribe = describe;

export default class Bus extends EventEmitter {}
