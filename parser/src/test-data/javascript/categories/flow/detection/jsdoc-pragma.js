/**
 * fixture: flow/detection/jsdoc-pragma.js
 * nature: runtime-bearing — it has statements; what the parser does with them is the next line
 * expected provenance: FLOW_EXCLUDED — the detector must fire on a pragma inside a JSDoc block among other tags
 *
 * detector: the pragma inside a JSDoc block, surrounded by other tags. This is
 * the shape a file acquires when someone adds Flow to a documented module, and
 * it is the one where a detector that looks only at the FIRST comment's first
 * line would miss it.
 *
 * @module jsdoc-pragma
 * @flow
 * @author fixture
 */

export function flowJsdocPragmaMarker(items: Array<mixed>): number {
  return items.length;
}
