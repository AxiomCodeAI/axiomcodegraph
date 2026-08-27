/**
 * Which decorator system governs a decorator, from the GOVERNING tsconfig.
 *
 * ## This cannot be got right from the source
 *
 * The source is IDENTICAL under both systems and the facts are not. Standard
 * TC39 decorators and legacy `experimentalDecorators` differ in evaluation
 * ORDER, in what the decorator function RECEIVES, and in whether parameter
 * decorators are legal at all. Nothing in the file says which applies — only the
 * tsconfig that governs it does.
 *
 * ## Why a per-run constant is wrong
 *
 * A repository is not one program. In this repository's own fixture corpus:
 *
 * ```
 * staging/                       38 decorators   STANDARD_TC39
 * staging/annotations/legacy/    18 decorators   LEGACY_EXPERIMENTAL
 * ```
 *
 * Three directories apart, one corpus, two answers — because `legacy/` has its
 * own tsconfig with `experimentalDecorators: true`, and the two systems cannot
 * share one program. A parser assuming one system per run gets one of them
 * wrong, and gets it wrong in a way that looks entirely plausible: the rows are
 * well formed and the count is right.
 *
 * That is why the resolver walks up from each file to the nearest tsconfig that
 * actually CLAIMS it, honouring `include`, `exclude` and `extends`. Nearest
 * alone is not enough: the nearest ancestor of `legacy/legacy-decorators.ts` is
 * the config that explicitly excludes it.
 *
 * ## The falsifiable consequence
 *
 * A PARAMETER decorator is legal only under `experimentalDecorators`. That is
 * grammar, not policy — so one stamped `STANDARD_TC39` proves the value came
 * from somewhere other than the governing tsconfig, and the gate fails on it.
 *
 * Schema §4.18 c13.
 */
export enum TsDecoratorSystem {
  /** TS 5.0+, ECMAScript stage 3. The default when `experimentalDecorators` is off. */
  STANDARD_TC39 = 'STANDARD_TC39',
  /** `experimentalDecorators: true`. Angular, NestJS, TypeORM. Parameter decorators legal. */
  LEGACY_EXPERIMENTAL = 'LEGACY_EXPERIMENTAL',
}
