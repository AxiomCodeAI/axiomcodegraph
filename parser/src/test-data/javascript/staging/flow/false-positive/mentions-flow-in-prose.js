// fixture: flow/false-positive/mentions-flow-in-prose.js
// module system: ESM (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: PROJECT — this is plain JavaScript and must be emitted in full — the detector fires on prose, and that is the false positive
//
// The detector matches the pragma token as a bare word over the first 2,048
// bytes, and this file contains that token in ordinary prose, ONCE, in the
// migration note near the bottom. MEASURED: it fires, and the header above is
// deliberately written without the token so the trigger is attributable to that
// one comment and to nothing else.
//
// Under schema §2.6 a false positive is not a cosmetic problem. Exclusion means
// the file contributes ONE module row and nothing else, so a plain JavaScript
// file that trips the detector is silently deleted from the fact base — its
// functions, its call sites and its imports all vanish, and `FLOW_EXCLUDED`
// makes the deletion look deliberate. That is the mirror image of a detection
// miss and it is equally invisible to a count.
//
// A pragma is a DIRECTIVE: it must be in a leading comment, and Flow itself
// only honours it there. "The word appears in the first 2 KB" is a weaker test
// than that, and this file is the gap between the two.
//
// This one is not hypothetical. A migration note at the top of a file is the
// single most likely place for the word to appear, because that is where
// someone writes down why the file is NOT typed yet.

// TODO(build): this module is not @flow typed yet — the annotations were
// stripped when it moved out of the typed package. See the migration notes
// before adding @flow back; the indexer types do not survive the codemod.

export function proseFalsePositiveMarker(a, b) {
  return a + b;
}

export const config = { retries: 3 };
