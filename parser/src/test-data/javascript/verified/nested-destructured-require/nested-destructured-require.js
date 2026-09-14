// fixture: verified/nested-destructured-require/nested-destructured-require.js
// nature: runtime-bearing
// VERIFIED REPRO — nested destructuring off require().
//
// Verified against js-impl@1b99d0d (pushed) and re-verified against b9e2676.
// Source only; no expected facts.
//
// FIVE CONTROLS IN THE SAME FILE: flat destructuring, renamed destructuring, a
// default value, array destructuring and a rest element all emit js_import rows.
//
// The two NESTED patterns emit nothing at all — no js_import, and no js_parse_gap
// either, so the module edge is absent AND unrecorded. The bound names carry no
// importLinkHash on their js_variable rows, so there is no second route to the
// edge. 72 of 13,190 require edges corpus-wide, 68 of them in the platform runtime's own library, which
// uses this shape for its error tables.
//
// A CAUTION THAT BELONGS WITH THE FIXTURE. The first measurement of this said
// 2,229 missing require rows. It was a harness artefact: a destructured require
// mints one row PER BINDING, positioned at the BINDING rather than at the
// `require(...)` call, and the probe was keyed on the call's own column. 2,226 of
// the 2,229 were perfectly good rows. Anyone re-measuring this should key on
// file + statement line span + specifier, not on the call position.
//
// module system: CommonJS, governed by verified/package.json.

// CONTROL — flat destructuring: must produce import rows.
const { readFile, writeFile } = require('fs');
// CONTROL — renamed flat destructuring.
const { join: pathJoin } = require('path');
// 1. NESTED destructuring
const { codes: { ERR_A, ERR_B } } = require('./errors');
// 2. nested with rename at the outer level
const { outer: { inner: renamed } } = require('./deep');
// 3. default value
const { maybe = 1 } = require('./defaults');
// 4. array destructuring
const [first] = require('./arr');
// 5. rest element
const { keep, ...rest } = require('./rest');
module.exports = { readFile, writeFile, pathJoin, ERR_A, ERR_B, renamed, maybe, first, keep, rest };
