// @flow
// fixture: flow/detection/line-pragma.js
// module system: ESM (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: FLOW_REJECTED — the detector must fire on `// @flow` line 1
// detector: `// @flow` line comment, first line. The canonical form.
//
// Payload is uniquely named so a leak is greppable: nothing else in the corpus
// declares `flowLinePragmaMarker`.

export function flowLinePragmaMarker(x: number): string {
  return String(x);
}
