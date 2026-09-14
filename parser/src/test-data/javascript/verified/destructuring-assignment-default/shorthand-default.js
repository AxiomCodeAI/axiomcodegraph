// fixture: verified/destructuring-assignment-default/shorthand-default.js
// nature: runtime-bearing
// VERIFIED REPRO — the default value of a shorthand property in a destructuring
// ASSIGNMENT is not walked.
//
// Verified against js-impl@24774d7 (pushed). Source only; no expected facts.
//
// These two are the ONLY call-site recall misses left in a 4,250-file corpus
// after sweep 3 — 2 of 195,781, down from 3,264. Both are in the platform runtime's own library, both are
// the same construct, and the sweep that found them is the same sweep that
// confirmed the other 3,262 fixed.
//
// FIVE CONTROLS, and they are what makes this a node-kind bug rather than a
// policy. In the same file the parser walks: a destructuring DECLARATION with a
// default, a plain assignment, a parenthesised assignment, an ARRAY destructuring
// assignment with a default, and a nested NON-shorthand property with a default.
//
// What it does not walk is `({ x = f() } = src)` — a ShorthandPropertyAssignment
// carrying an `objectAssignmentInitializer`, which is the only spelling where the
// defaulted name and the target name are the same token. `const { x = f() } = src`
// looks identical and works, because in a declaration the pattern is a
// BindingElement rather than an object literal reused as a pattern.
//
// The platform runtime's library writes it twice, both times losing `Buffer.alloc(16384)`:
//   its fs module:               ({ buffer = Buffer.alloc(16384) } = params ?? kEmptyObject);
//   its fs/promises module:      ({ buffer = Buffer.alloc(16384), offset = 0, ... } = ...);
//
// module system: CommonJS, governed by verified/package.json.
'use strict';
function mk(n) { return n; }
let buffer, offset, tail, arr;

// CONTROL 1 — destructuring DECLARATION with a defaulted property.
const { a = mk(1) } = {};

// CONTROL 2 — plain assignment with a call on the right.
buffer = mk(2);

// CONTROL 3 — parenthesised assignment, no destructuring.
(buffer = mk(3));

// 1. LOST — parenthesised destructuring assignment, defaulted shorthand property.
({ buffer = mk(4) } = {});

// 2. LOST — the same, multi-property, node's fs/promises shape.
({ buffer = mk(5), offset = 0, tail = mk(6) } = {});

// CONTROL 4 — ARRAY destructuring assignment with a default. Walked.
([arr = mk(7)] = []);

// CONTROL 5 — nested, NON-shorthand property with a default. Walked.
({ o: { buffer: tail = mk(8) } } = { o: {} });

module.exports = { a, buffer, offset, tail, arr };
