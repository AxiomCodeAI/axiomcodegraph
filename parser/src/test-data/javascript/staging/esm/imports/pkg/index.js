// fixture: esm/imports/pkg/index.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2015
//
// A barrel. Every re-export form in one file: each line is an import edge and an
// export edge at once, and none of them binds a local name — which is what
// distinguishes `export { x } from './y'` from `import { x } from './y'; export { x }`.
// The second binds x locally; the first does not, and a fact base that models
// them identically claims a binding that is not in scope.
//
// MEASURED at a5f6aab: this file's three re-export forms come out as follows.
// `export { a as b } from` -> EXPORT_DECLARATION with the right names.
// `export * from`          -> EXPORT_ALL.
// `export * as util from`  -> NOTHING. No row at all. The construct has been in
// this file since it was written and the missing row was found only when the
// line was checked by name rather than the file counted. That is the whole
// argument for checking every line of a fixture, and it is the parser defect
// this file now exists to hold.

export { normalize, Formatter } from './util.js';
export { normalize as clean } from './util.js';
export { default as greet } from './util.js';
export { default } from './util.js';
export * from './util.js';
export * as util from './util.js';

// A re-export whose target does not exist. Structural, not environmental.
export { nothing } from './does-not-exist.js';
