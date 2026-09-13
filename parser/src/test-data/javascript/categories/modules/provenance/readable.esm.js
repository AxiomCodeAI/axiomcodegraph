// fixture: cjs/provenance/readable.esm.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// expected provenance: PROJECT — RULED 2026-09-13: `esm` is to be REMOVED from
//   JS_MINIFIED_NAME_PATTERN. `min` and `bundle` name a BUILD PRODUCT; `esm` names
//   a MODULE FORMAT, and index.esm.js beside index.cjs.js is how a person writes
//   a dual package's entry. Until js-impl lands the removal this file reads
//   BUNDLED_EXCLUDED and the provenance check fails BY NAME, which is the point.
// syntax floor: ES2015
//
// The contents of this file are ordinary, short, readable, hand-written source.
// Nothing about them is bundled or minified. The only thing that makes it
// BUNDLED_EXCLUDED is the .esm.js suffix, matched by JS_MINIFIED_NAME_PATTERN
// (/\.(min|bundle|umd|esm)\.[cm]?jsx?$/i) before any content heuristic runs.
//
// One file per alternate of that pattern, so each branch is discriminated on its
// own. The general rule from the ruling: where a name signal and a content
// signal disagree, the CONTENT signal wins — including a bundle inflates a
// denominator DETECTABLY (line length, source-map footer, row density all say
// so), while deleting real source leaves nothing behind to notice. Prefer the
// error that can be found.
//
// Requested as shape (5) of the day-one gates: a .min.js inside a NON-skipped
// directory. Recorded earlier as unreachable from a fixture; that was wrong — the
// content heuristic is unreachable honestly, the name rule is not.

'use strict';

function esmMarker(value) {
  return String(value).toUpperCase();
}

module.exports = { esmMarker };
