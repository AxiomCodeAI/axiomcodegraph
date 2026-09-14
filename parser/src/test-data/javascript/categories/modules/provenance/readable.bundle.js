// fixture: cjs/provenance/readable.bundle.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// expected provenance: BUNDLED — by NAME, and by name alone
// syntax floor: ES2015
//
// The contents of this file are ordinary, short, readable, hand-written source.
// Nothing about them is bundled or minified. The only thing that makes it
// BUNDLED_EXCLUDED is the .bundle.js suffix, matched by JS_MINIFIED_NAME_PATTERN
// (/\.(min|bundle|umd|esm)\.[cm]?jsx?$/i) before any content heuristic runs.
//
// One file per alternate of that pattern, so each branch is discriminated on its
// own. RULED 2026-09-13: this alternate STAYS — it names a build product — and
// a BUNDLED_EXCLUDED file EMITS FULLY. The provenance column is the filter; no
// gate-time drop. Bundled is a PROVENANCE (correct facts about non-project code),
// not a REJECTION like FLOW_EXCLUDED (the parser cannot emit correct facts, so it
// stops at the module row). Same non-PROJECT column, two different kinds of
// thing; the naming that hides that is js-oracle's to settle.
//
// Requested as shape (5) of the day-one gates: a .min.js inside a NON-skipped
// directory. Recorded earlier as unreachable from a fixture; that was wrong — the
// content heuristic is unreachable honestly, the name rule is not.

'use strict';

function bundleMarker(value) {
  return String(value).toUpperCase();
}

module.exports = { bundleMarker };
