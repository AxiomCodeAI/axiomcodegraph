// fixture: verified/export-star-as/index.js
// nature: runtime-bearing
// VERIFIED REPRO — `export * as X from 'm'` emits no js_export row.
//
// Verified against js-impl@ba8846c (pushed). Source only; no expected facts.
//
// A compiler package's seven-line re-export module is nothing but this
// form, and the parser emits ZERO export rows for the file — a module whose
// entire purpose is re-export is recorded as exporting nothing.
//
// The CONTROLS are the two neighbouring forms: `export * from 'm'` (bare
// star) and `export { a as b } from 'm'` (named re-export) both emit. The
// namespace re-export `export * as X` — ES2020, which TypeScript parses as an
// ExportDeclaration with a NamespaceExport clause — is the one form of the
// three the walk does not reach.
//
// module system: ESM, governed by export-star-as/package.json.
export * as Comparison from './comparison.js';
export * as Feature from './feature.js';
// CONTROL 1 — bare star re-export.
export * from './bare.js';
// CONTROL 2 — named re-export.
export { thing as renamed } from './named.js';
