// fixture: flow/false-positive/flow-scoped-package.js
// module system: ESM (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: PROJECT — plain JavaScript, must be emitted in full — the detector fires on a scoped package specifier
//
// A second false-positive vector, and a subtler one: the detector matches the
// pragma token as a bare WORD, and `/` is a word boundary — so a scoped package
// specifier under that npm scope matches. The token appears nowhere in this
// header; it is in the import on the first code line, in a string, and in a
// template, and those three are the whole trigger.
//
// MEASURED: fires. Flow's toolchain publishes real packages under that scope
// and beside it, any of which a plain JavaScript file may depend on
// — a file that merely CONSUMES Flow tooling is not itself Flow.
//
// Also covered: the word inside a string literal and inside a template, neither
// of which is a comment and neither of which any pragma convention honours.

import parser from '@flow/parser';

const toolName = '@flow/config';
const message = `run @flow check before committing`;

export function scopedPackageFalsePositiveMarker(source) {
  return parser.parse(source, { name: toolName, message });
}
