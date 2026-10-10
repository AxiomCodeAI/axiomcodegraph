/**
 * A name a declaration's value (or an at-rule's prelude) REFERS TO.
 *
 * Each is a join the engine makes, not the parser: `var(--x)` reaches every declaration
 * of `--x` that applies, which depends on the cascade; `animation: spin 1s` reaches the
 * `@keyframes spin` of whichever stylesheet wins. The parser emits the name as written
 * and resolves only what a name alone decides — a URL to a file on disk.
 */
export enum CssValueReferenceKind {
  /** `var(--name)`, `var(--name, fallback)` — `name` is `--name`; `fallbackText` the fallback. */
  VARIABLE = 'VARIABLE',

  /** `url(…)` in any property: `background`, `src` of `@font-face`, `cursor`, `mask`, … */
  URL = 'URL',

  /** The target of `@import url(x) …;` or `@import "x" …;` — on the at-rule, not a declaration. */
  IMPORT = 'IMPORT',

  /** The identifier in `animation` / `animation-name` that names an `@keyframes` rule. */
  KEYFRAMES = 'KEYFRAMES',

  /** `@layer a, b;` / `@layer a { }` / `@import … layer(a)` — a cascade layer name. */
  LAYER = 'LAYER',

  /** `container-name: x` / `@container x (…)` — a container query name. */
  CONTAINER = 'CONTAINER',

  /** `font-family: "Inter", sans-serif` — each family name; joins to `@font-face { font-family }`. */
  FONT_FAMILY = 'FONT_FAMILY',
}
