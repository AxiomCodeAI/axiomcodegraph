// @flow strict-local
// fixture: flow/detection/strict-pragma.js
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: FLOW_REJECTED — the detector must fire on a mode suffix
// detector: the pragma carries a MODE suffix. Flow has `@flow`, `@flow strict`,
//   `@flow strict-local` and `@flow weak`, and a detector anchored on the exact
//   string `@flow` followed by end-of-line matches none of the last three.

export function flowStrictPragmaMarker(value: mixed): boolean {
  return typeof value === 'string';
}
