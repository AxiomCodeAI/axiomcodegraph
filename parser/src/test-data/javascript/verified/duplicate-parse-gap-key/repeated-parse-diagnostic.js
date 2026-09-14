// fixture: verified/duplicate-parse-gap-key/repeated-parse-diagnostic.js
// nature: runtime-bearing
// VERIFIED REPRO — two js_parse_gap rows with ONE primary key.
//
// Verified against js-impl@1b99d0d (pushed). Source only; no expected facts.
//
// EIGHT LINES, AND THE ROWS DOUBLE. `ts.createSourceFile` under ScriptKind.JS
// reports the SAME diagnostic — same code 1381, same line, same column, same
// message — TWICE for the closing braces at lines 7 and 8, because the Flow cast
// `((a[i]: any): Source<any>)` desynchronises the parser and error recovery walks
// the region twice. The extractor keys js_parse_gap on (kind, module, line,
// column, detail), so the second diagnostic mints the key the first one already
// has and the row is emitted again, byte-identical.
//
// §2 of BUILDING-A-PARSER.md: "Duplicate keys do not collide. They DOUBLE."
// Nothing looks wrong. Both rows are correct; there are simply two of them.
//
// WHY NO EXISTING GATE SEES IT. The construct needs a JavaScript file carrying
// Flow syntax, and neither the 95-file staging tree nor the 100-file categories
// tree nor js-impl's own 816-file corpus had one. Over 4,529 real files it is 121
// extra rows across 74 keys — 120 in the Flow-typed UI-framework stratum, 1 in a second UI library —
// against 0 in every fixture tree. PK uniqueness is point 4 of the seven-point
// merge bar, and it currently fails at scale and passes everywhere it is checked.
//
// Two fixes are available and they are not the same decision: dedupe identical
// diagnostics at the source, or put the diagnostic's ORDINAL in the key. The first
// loses the fact that the compiler said it twice; the second keeps a row whose
// only distinguishing feature is that it is a duplicate. That is js-impl's call.
//
// module system: CommonJS, governed by verified/package.json.
function f(a, i) {
  for (let k = 0; k < 2; k++) {
    const m = ((a[
      i
    ]: any): Source<any>);
    g(m);
  }
}
