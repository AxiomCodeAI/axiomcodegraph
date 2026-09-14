// fixture: cjs/commonjs/export-overwrite-unconditional.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The overwrite the schema claims: `module.exports.foo = 1` followed by an
// UNCONDITIONAL `module.exports = {}`. At runtime this module exports `b` and
// `c` and nothing else. Every edge written before line 30 is discarded.
//
// overwritesPreviousExport = true is what stops the fact base asserting exports
// that do not exist. Suppressing the earlier rows instead would lose the fact
// that the assignment executed, which is why the schema keeps both rows and
// flags them.
//
// This file is the paired control for export-overwrite-conditional.js. The two
// must be DISTINGUISHABLE: same construct, different reachability, and only
// this one is an unconditional overwrite. Grounded in the common refactor
// accident where a file grows `exports.x =` members and later acquires a
// `module.exports = class` at the bottom.

'use strict';

// --- edges that will be discarded ------------------------------------------

exports.a = function a() { return 'a'; };
module.exports.alsoA = 1;
Object.defineProperty(exports, 'hiddenA', { get() { return true; } });

// --- the unconditional overwrite -------------------------------------------
//
// Top level, no guard, no branch above it that could skip it. Everything above
// is now unreachable through this module's public surface.

module.exports = {
  b: function b() { return 'b'; },
  c: 3
};

// --- edges added AFTER the overwrite, which do survive ----------------------

module.exports.d = 4;
exports.e = 5; // does NOT survive: `exports` still aliases the OLD object.

// --- a second unconditional overwrite --------------------------------------
//
// Two overwrites in one file. Only the last one decides the module's exports,
// so `d` is gone too. A parser that flags "an overwrite happened" without
// ordering cannot say which edges survived.

module.exports = function finalExport() {
  return 'final';
};

module.exports.tail = true;
