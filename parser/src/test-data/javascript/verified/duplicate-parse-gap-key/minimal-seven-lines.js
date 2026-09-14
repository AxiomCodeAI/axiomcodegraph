// fixture: verified/duplicate-parse-gap-key/minimal-seven-lines.js
// nature: runtime-bearing
// THE MINIMAL CASE — 7 lines of code, no function, no framework source, no Flow pragma.
//
// THIS HEADER MUST NOT SPELL THE PRAGMA. It did, in prose, and the file was
// classified FLOW_REJECTED (FLOW_EXCLUDED before the 2026-09-13 rename) — one module row and nothing else — so the repro it
// exists to carry silently stopped reproducing. js-fixtures hit the same trap and
// wrote it down: a fixture that names the pattern it is testing trips it. The
// detector is right; this comment was wrong. Every mention below is spelled
// "the pragma" for that reason.
//
// Verified against js-impl@a7bf1c3 (pushed), typescript@6.0.3, ScriptKind.JS.
// Emits 10 js_parse_gap rows for 8 distinct positions: 6:3 and 7:1 are each
// emitted TWICE, byte-identical, under one primary key.
//
// FOUR CONDITIONS, ALL REQUIRED. This is why six earlier shapes reproduced
// nothing — each is missing at least one, and three of the four look irrelevant
// until you ablate them:
//
//   1. a Flow cast            ((expr: T1): T2)
//   2. T2 GENERIC WITH EXACTLY ONE TYPE ARGUMENT.  `S<any>` duplicates,
//      `S` does not, and `Map<K, V>` does NOT — the comma stops it. This is the
//      condition that matters and the one no reduction would guess: under
//      ScriptKind.JS the languageVariant is already JSX (DECISION-MEMO §3, and
//      that memo proves it), so `<any>` opens a JSX ELEMENT and the parser
//      commits to a JSX parse it then has to abandon.
//   3. the cast's expression contains a MULTI-LINE element access `a[\n i \n]`.
//      A single-line access, and a cast merely split across lines, both emit one
//      diagnostic and no duplicate.
//   4. TWO levels of enclosing braces. One is not enough. This is what makes the
//      tail a RUN of closing braces, and the run is what gets re-reported.
//
// ABLATION — each row is one edit from the case above it:
//      function + for + trailing statement     DUP
//      drop the trailing statement             DUP
//      drop the `for`   (one brace level)      clean
//      drop the `function` (one brace level)   clean
//      `if` instead of `for`                   DUP
//      two bare blocks   <- this file          DUP
//      one bare block                          clean
//      no element access                       clean
//      non-generic cast target                 clean
//
// WHAT ACTUALLY COLLIDES. The two diagnostics are DISTINCT OBJECTS with ZERO
// differing own properties: same start, length, end, code 1381, category,
// messageText, and the same SourceFile object. A field-by-field diff shows
// nothing. They are indistinguishable by anything except their INDEX in
// `sf.parseDiagnostics` — here 4 and 6, and 5 and 7 for the second position.
// Note the interleaving: it is two passes over the same run, not two adjacent
// reports, so "collapse consecutive duplicates" would not catch it either.
//
// So NO key built from diagnostic CONTENT can separate them. Dedupe at the
// source, or put the ordinal in the key. That is js-impl's and js-oracle's call.
//
// A REAL INSTANCE, for anyone who wants one that is not contrived:
//   one Flow-typed reconciler file in the UI-framework stratum (identity in the
//   private manifest): byte offset 43859, length 1, source text "}", code 1381,
//   parseDiagnostics[18] and [21], line 1372 column 11.
//   That file yields 721 parse diagnostics for 698 distinct
//   (code, line, col, message), and 17 positions collide.
//
// module system: CommonJS, governed by verified/package.json.
{
  {
    const m = ((a[
      i
    ]: any): S<any>);
  }
}
