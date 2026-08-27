/**
 * How specifiers resolve, read from the tsconfig that GOVERNS the file.
 *
 * Never a run-wide constant. A repository is not one program: two directories
 * can declare different modes, and the same specifier legitimately resolves
 * differently under each. `./a.js` means "the file a.js" under `NODE10` and "the
 * emit of a.ts" under `NODE16`, so a fact base that flattens the modes cannot
 * explain its own `ts_import.resolvedFilePath` values.
 *
 * Paired with `ts_import.resolutionKind`: that column says WHERE a specifier
 * landed, and this one says under which rules.
 *
 * Schema §4.1 c13.
 */
export enum TsModuleResolutionMode {
  /** `node16` — extension-bearing relative specifiers, `exports` honoured. */
  NODE16 = 'NODE16',

  /** `nodenext` — as `node16`, tracking Node's current behaviour. */
  NODENEXT = 'NODENEXT',

  /** `bundler` — extensionless specifiers, `exports` honoured. */
  BUNDLER = 'BUNDLER',

  /** `node`/`node10` — the classic CommonJS algorithm. */
  NODE10 = 'NODE10',

  /** `classic` — pre-Node resolution; almost never seen in current code. */
  CLASSIC = 'CLASSIC',
}
