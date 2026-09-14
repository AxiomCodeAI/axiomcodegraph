/**
 * `ts.ScriptKind` — how the file is PARSED, not merely what it is named.
 *
 * Load-bearing for exactly one reason: it decides whether `<` opens a JSX
 * element or a type assertion. `<T>x` is a cast in `.ts` and a JSX element in
 * `.tsx`, so the same bytes produce different trees and the kind cannot be
 * guessed from content.
 *
 * `.mts` and `.cts` are parsed as `TS`; they differ in module RESOLUTION, which
 * `ts_module.moduleResolutionMode` records separately. Only `.tsx` changes the
 * grammar.
 *
 * Schema §4.1 c6.
 */
export enum TsScriptKind {
  /** `.ts` — `<T>x` is a type assertion. */
  TS = 'TS',

  /** `.tsx` — `<T>` opens JSX, so a type assertion must be written `x as T`. */
  TSX = 'TSX',

  /** `.d.ts` — declarations only. */
  DTS = 'DTS',

  /** `.mts` — parsed as TS, resolved as ESM. */
  MTS = 'MTS',

  /** `.cts` — parsed as TS, resolved as CommonJS. */
  CTS = 'CTS',

  /** `.json` under `resolveJsonModule`. */
  JSON = 'JSON',
}
