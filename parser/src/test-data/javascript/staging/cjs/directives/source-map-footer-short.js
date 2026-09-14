// fixture: cjs/directives/source-map-footer-short.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// HALF ONE OF A PAIRED REPRO. This file and source-map-footer-long.js carry the
// SAME trailing a source-map footer comment line and differ only in length. Under
// js-module-extractor.ts @ a00dc10 they receive OPPOSITE provenance verdicts:
// this one is GENERATED_MONOLITH, the long one is PROJECT.
//
// Neither is generated. Both are hand-written fixtures.
//
// The cause is that `sourceMappingURL` sits in a list called BUNDLER_PREAMBLES
// which is searched only in `sourceText.slice(0, 4096)` — a bound whose stated
// purpose is that a bundler token "appearing in a comment halfway down a
// hand-written file is not evidence the file is generated". For any file under
// 4 KB the head window IS the whole file, so the bound does nothing here, while
// for the long file it excludes the only evidence there is. A source map URL is
// a FOOTER by convention; the other four patterns in that list are genuine
// headers and are correctly bounded.
//
// Measured on this checkout's node_modules: of 42 files carrying a source-map
// footer and no other preamble pattern, 21 are flagged and 21 are not, split
// purely by length. Two files from ONE build in this checkout's dependencies
// (2,230 B and 4,701 B) get opposite verdicts — same build, same directory.
//
// Why this matters beyond tidiness: gate 7.3.5 says a file whose sourceProvenance
// is not PROJECT contributes zero rows to any coverage denominator. So the error
// is silent in both directions — a fixture drops out of coverage while reading
// green, and a genuinely generated file is counted as project source.
//
// Owner of the fix: js-impl. This pair exists so the fix has a repro that does
// not depend on anyone's node_modules.

'use strict';

function short() {
  return 'under 4 KB, so the head window is the whole file';
}

module.exports = { short };

//# sourceMappingURL=source-map-footer-short.js.map
