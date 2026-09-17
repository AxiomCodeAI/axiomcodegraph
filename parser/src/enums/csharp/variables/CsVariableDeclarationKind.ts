/**
 * What DECLARES a local — `cs_variable.declarationKind`.
 *
 * ## `OUT_VAR` is the second return channel, and it is declared HERE
 *
 * `int.TryParse(s, out var n)` declares `n` **inside the argument list** and
 * nowhere else. There is no `int n;` above it, so a walker that only reads
 * `local_declaration_statement` finds no declaration at all — and the engine
 * then sees a name used with nothing declaring it. `TryParse` is in every C#
 * codebase written.
 *
 * The same is true of `PATTERN` (`x is Foo f`) and `DECONSTRUCTION`
 * (`var (a, b) = t`): the binding site is an expression, not a statement.
 */
export enum CsVariableDeclarationKind {
  /** `int x = 1;` — an ordinary local. */
  LOCAL = 'LOCAL',
  /** `foreach (var x in xs)` — bound once per iteration. */
  FOREACH = 'FOREACH',
  /** `using var f = …` / `using (var f = …)` — disposed at scope exit. */
  USING = 'USING',
  /** `fixed (byte* p = …)` — pinned for the block. */
  FIXED = 'FIXED',
  /** `out var n` — declared in an ARGUMENT LIST. A second return channel. */
  OUT_VAR = 'OUT_VAR',
  /** `x is Foo f`, `case Foo f:` — declared by a pattern. */
  PATTERN = 'PATTERN',
  /** `var (a, b) = t` — one statement, N bindings. */
  DECONSTRUCTION = 'DECONSTRUCTION',
  /** `catch (Exception e)`. */
  CATCH = 'CATCH',
  /** `from x in xs` — a LINQ range variable, scoped to the query. */
  QUERY_RANGE = 'QUERY_RANGE',
}
