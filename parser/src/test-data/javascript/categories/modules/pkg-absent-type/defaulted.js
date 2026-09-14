// fixture: pkg-absent-type/defaulted.js
// module system: CommonJS BY DEFAULT
//   governing: staging/pkg-absent-type/package.json — which exists and has NO
//   "type" field. moduleSystemSource = PKG_TYPE_ABSENT_DEFAULT.
// nature: runtime-bearing
// syntax floor: ES2015
//
// 76.0% of the schema's corpus is governed this way, and the reason
// moduleSystemSource is a column rather than a boolean is that this file and
// ext/cjs-package/plain.js have the SAME moduleSystem for DIFFERENT reasons.
// A defaulted CommonJS becomes an ESM the day someone adds one line to a
// package.json this file does not contain; a declared one does not. Without the
// column those two futures are indistinguishable in the fact base.
//
// The third value, NO_PACKAGE_JSON_DEFAULT (15.4% of the corpus), is NOT
// reachable from a fixture: this repository has a package.json at its root, so
// nearest-ancestor lookup always finds one. Recorded in MANIFEST.md as an
// absence with a reason rather than faked.

'use strict';

const os = require('os');

function cpuCount() {
  return os.cpus().length;
}

module.exports = { cpuCount };
