/**
 * The `ts.ScriptKind` this file was parsed with. Schema §3.1 c6.
 *
 * ## Recorded as provenance, and never read from a config
 *
 * `ts-fact-extractor.ts` records that "`ts.ScriptKind` decides whether `<` opens
 * JSX, so it cannot be guessed", and that is true for TypeScript: `.ts` and
 * `.tsx` genuinely parse differently, because in `.ts` a `<T>` is a type
 * assertion.
 *
 * **For JavaScript it is not.** The schema measured **0 of 2,942 `.js` files**
 * parsing differently under `ScriptKind.JS` versus `ScriptKind.JSX`, because
 * `ScriptKind.JS` already carries `languageVariant = JSX` inside the compiler —
 * there is no type-assertion syntax for `<` to be ambiguous with. So the
 * script-kind decision that §3 of `BUILDING-JAVASCRIPT.md` warned about does not
 * exist for this language, and the column is here to say which value was
 * actually passed rather than to carry a decision.
 *
 * That is worth having written down: an always-`JS` column reads as a bug to
 * the next person otherwise, and the reason it is safe is a measurement, not an
 * assumption.
 */
export enum JsScriptKind {
  /** `.js`, `.mjs`, `.cjs` — and JSX inside them parses anyway. */
  JS = 'JS',

  /** `.jsx`, where the extension states the intent. */
  JSX = 'JSX',
}
