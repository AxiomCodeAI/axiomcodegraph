/**
 * The extension of the file a specifier resolved to.
 *
 * Recorded because the specifier does not determine it. Verified on 6.0.3:
 * `"./a.js"` resolves to `a.ts` with extension `.ts` — the specifier names the
 * EMIT and resolution finds the SOURCE. A consumer that reads the specifier and
 * assumes the extension is wrong under `node16` and `nodenext`, which is most
 * current code.
 *
 * `.d.ts` is the member that matters for provenance: it means the target is
 * declarations only, so the engine stages it into `lib_ts_*` rather than
 * treating it as project source.
 *
 * Schema §4.12 c17.
 */
export enum TsResolvedExtension {
  /** `.ts` — including a `"./a.js"` specifier that resolved to source. */
  TS = '.ts',
  /** `.tsx`. */
  TSX = '.tsx',
  /** `.d.ts` — declarations only, so the target has no bodies. */
  DTS = '.d.ts',
  /** `.mts`. */
  MTS = '.mts',
  /** `.cts`. */
  CTS = '.cts',
  /** `.json` under `resolveJsonModule`. */
  JSON = '.json',
  /** `.js` — resolved to emitted or hand-written JavaScript. */
  JS = '.js',
}
