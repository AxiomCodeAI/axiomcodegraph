/* @flow */
// fixture: flow/detection/block-pragma.js
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: FLOW_REJECTED — the detector must fire on `/* @flow */`
// detector: `/* @flow */` block comment. The form Flow's own upstream source uses.

export function flowBlockPragmaMarker(x: ?string): string {
  return x == null ? '' : x;
}
