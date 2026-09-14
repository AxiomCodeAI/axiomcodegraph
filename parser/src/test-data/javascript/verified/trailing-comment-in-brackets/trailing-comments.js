// fixture: verified/trailing-comment-in-brackets/trailing-comments.js
// nature: runtime-bearing
// VERIFIED REPRO — a trailing comment inside a bracketed construct emits no js_comment row.
//
// Verified against js-impl@ba8846c (pushed). Source only; no expected facts.
//
// THREE CONTROLS, all emitted: a leading line comment, a trailing comment after
// a STATEMENT, and a leading block comment. The extractor attaches trailing
// comments at statement level and is correct there.
//
// FOUR LOST, one per bracketed construct: a trailing comment after an element of
// an ARRAY literal, after a property of an OBJECT literal, and after an entry of
// a PARAMETER list. None produces a row. 2,211 of 64,157 comment ranges in the
// corpus (3.4%), found by completing the AST-recall instrument across
// js_comment, which the first harness did not walk.
//
// Not a row-count-visible defect — the comment relation is 96.6% populated and
// nothing else references the missing rows — which is the kind that only a
// positional walk against the compiler's own comment ranges can see.
//
// module system: CommonJS, governed by verified/package.json.
'use strict';
// CONTROL A — a leading line comment.
const a = 1; // CONTROL B — a trailing comment after a statement.

/* CONTROL C — a leading block comment. */
const arr = [
  1, // 1. LOST — trailing comment inside an ARRAY literal
  2, // 2. LOST — another
];

const obj = {
  x: 1, // 3. LOST — trailing comment inside an OBJECT literal
  y: 2,
};

function f(
  p, // 4. LOST — trailing comment inside a PARAMETER list
  q
) { return p + q; }

module.exports = { a, arr, obj, f };
