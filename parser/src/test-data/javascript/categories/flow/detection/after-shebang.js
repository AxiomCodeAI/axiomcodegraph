#!/usr/bin/env node
// @flow
// fixture: flow/detection/after-shebang.js
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: FLOW_REJECTED — the detector must fire on line 2, behind a shebang
// detector: the pragma is not the first line, because a shebang must be. Any
//   detector that requires the pragma at offset 0 misses every Flow CLI entry
//   point, and `bin` scripts are exactly where Flow-typed tools put them.

export function flowAfterShebangMarker(argv: Array<string>): number {
  return argv.length;
}
