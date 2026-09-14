// fixture: cjs/directives/directive-comments.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Comments that are INSTRUCTIONS rather than prose. js_comment.directiveKind
// enumerates six, and a directive comment changes how a tool treats the file —
// so reading it as an ordinary comment loses a fact about the analysis itself,
// not about the program.
//
// The source-map footer that used to live at the bottom of this file has moved
// to source-map-footer-short.js and source-map-footer-long.js, because it was
// making this file read as GENERATED_MONOLITH — and a file with that provenance
// contributes zero rows to any coverage denominator (gate 7.3.5), so the
// @ts-check coverage below was being silently dropped. Keeping the two concerns
// in one file made this fixture's own coverage depend on an unrelated ruling.
//
// The one that matters most here is @ts-check / @ts-nocheck. The schema's oracle
// runs with `checkJs: true` project-wide, and these two comments OVERRIDE that
// PER FILE — §9 of BUILDING-A-PARSER.md, read the governing config per file, in
// its smallest form. A file with @ts-nocheck yields no diagnostics at all, so an
// oracle that ignores the comment reports a clean file as evidence.
//
// Grounded in the @ts-check adoption pattern used across Node's own tools and in
// the sourceMappingURL footer every build step appends.

// @ts-check

'use strict';

/* eslint-disable no-console */
// eslint-disable-next-line no-unused-vars
const unusedOnPurpose = 1;

/**
 * @param {string} name
 * @returns {string}
 */
function greet(name) {
  // @ts-expect-error - the next line is wrong on purpose and the comment says so
  return name.notAMethod();
}

// @ts-ignore
const alsoWrong = greet(42);

/* istanbul ignore next */
function uncovered() { return null; }

// A directive-LOOKING comment that is not one. `@ts-check` only counts at the
// top of a file, and prose mentioning @ts-nocheck is prose.
// This line talks about @ts-nocheck without being it.

// And the same trap for the linter. MEASURED: the directive detector is
// `/\beslint(-disable|-enable|\s)/`, so the word followed by a SPACE in prose
// is classified as an ESLINT directive. The next line is prose about how an
// eslint config resolver loads plugins, and it must NOT be a DIRECTIVE row. A
// real directive names a rule or an action; a sentence does not.
// Found because a scrub of a different fixture's prose made a DIRECTIVE row
// disappear from the fact base, and the fingerprint diff noticed.

module.exports = { greet, alsoWrong, uncovered, unusedOnPurpose };
