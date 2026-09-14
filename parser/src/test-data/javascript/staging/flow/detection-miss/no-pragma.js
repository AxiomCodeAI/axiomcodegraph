// fixture: flow/detection-miss/no-pragma.js
// module system: ESM (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: PROJECT — because there is nothing to detect — this is the tripwire, and SYNTACTIC_FLOW on its parameters is what says the file is Flow
//   ordinary `.js` extension. There is nothing for the detector to detect.
//
// THIS IS THE FIXTURE THE TRIPWIRE EXISTS FOR. Schema §2.6 changed
// `declaredTypeSource = SYNTACTIC_FLOW` from "a declared-type channel" to "a
// detection miss": a syntactic type annotation that survived into an emitted
// file, which can only happen if the file is Flow and carried no pragma.
//
// Its expected count in emitted files is 0. Deliberately NOT a zero-row
// assertion — §7.3c — because the population it measures is the failure of the
// detector, which is a corpus property. This file is the only thing in the
// corpus that can make it fire, so without it the column is untestable and a
// gate asserting zero would pass vacuously forever.
//
// Real provenance: the pragma is removed during a refactor, or a file is copied
// out of a Flow project into one that does not use it, or a codemod rewrites
// the header. The annotations stay. Every one below parses under `ScriptKind.JS`
// with ZERO diagnostics, so nothing else in the fact base can flag this file.
//
// Deliberately using only the SILENT half of Flow — measured, these produce no
// parse diagnostic at all. A loud construct would be caught by a parse gap and
// would make the fixture prove less than it claims.

export function flowNoPragmaMarker(value: mixed): string {
  return typeof value === 'string' ? value : '';
}

export function maybeMarker(input: ?string): number {
  return input == null ? 0 : input.length;
}

export function utilityMarker(config: $ReadOnly<{ host: string }>): string {
  return config.host;
}

export function indexerMarker(counts: { [string]: number }): number {
  return Object.keys(counts).length;
}

export class NoPragmaStore {
  entries: { [string]: mixed };
  size: number;

  constructor(size: number) {
    this.entries = {};
    this.size = size;
  }

  get(key: string): mixed {
    return this.entries[key];
  }
}
