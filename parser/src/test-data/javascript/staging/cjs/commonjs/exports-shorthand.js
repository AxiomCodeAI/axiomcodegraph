// fixture: cjs/commonjs/exports-shorthand.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// `exports.foo = ...` — the EXPORTS_MEMBER form, 118 sites in the schema's
// corpus. `exports` is a free variable that starts out === module.exports, and
// the whole point of this fixture is that the aliasing is fragile in ways the
// syntax does not show.
//
// Grounded in a runtime's querystring module and a web framework's utils.

'use strict';

// The plain form.
exports.stringify = function stringify(obj) {
  return JSON.stringify(obj);
};

exports.parse = function parse(text) {
  return JSON.parse(text);
};

// A value, not a function.
exports.escape = encodeURIComponent;

// Rebinding a local alias of `exports` and assigning through it. Same effect,
// different callee text — a matcher keyed on the identifier `exports` misses it.
const ex = exports;
ex.unescape = decodeURIComponent;

// Object.assign onto `exports`. N export edges from one call, and the names are
// the object literal's keys, not anything in the assignment target.
Object.assign(exports, {
  encode: exports.escape,
  decode: exports.unescape,
  sep: '&',
  eq: '='
});

// `exports` used as a value rather than an assignment target. Not an export
// edge; a read of the object.
const exportedNames = Object.keys(exports);
exports.count = exportedNames.length;

// The trap: reassigning the local `exports` binding does NOT change what the
// module exports, because module.exports is what is returned. Everything
// assigned after this line is invisible to an importer. A fact base that
// records `lost` as an export asserts something that is false at runtime.
exports = { lost: true };
exports.lost = true;
