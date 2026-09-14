// fixture: ext/cjs-package/plain.js
// module system: CommonJS  (governing: staging/ext/cjs-package/package.json,
//   "type": "commonjs" — declared, so moduleSystemSource = PKG_TYPE_COMMONJS,
//   which is NOT the same value as the defaulted case in pkg-absent-type/)
// nature: runtime-bearing
// syntax floor: ES5
//
// The control for override.mjs, and the second half of the declared-vs-defaulted
// contrast that pkg-absent-type/defaulted.js completes.

'use strict';

exports.moduleSystem = 'commonjs-by-package-type';
exports.noop = function noop() {};
