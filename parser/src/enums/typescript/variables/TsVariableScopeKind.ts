/**
 * Where a variable is scoped.
 *
 * Wider than Java's `LocalVariableScopeKind` because a module-level `const` is a
 * first-class declaration here: it merges, it is exported, it is imported by
 * name, and 161 measured call targets are arrow functions reached only through
 * the variable that binds them.
 *
 * ## The three that are not "a block"
 *
 * ```ts
 * for (let i = 0; …) { }        // FOR_BINDING   — re-bound per iteration for `let`
 * try { } catch (e) { }          // CATCH_BINDING — scoped to the catch clause alone
 * namespace N { const x = 1; }   // NAMESPACE_SCOPE
 * ```
 *
 * `FOR_BINDING` and `CATCH_BINDING` are separated because their scopes are not
 * the surrounding block: a `let` in a `for` header is a fresh binding each
 * iteration, which is what makes closures over it behave differently from `var`.
 *
 * Schema §4.11 c8.
 */
export enum TsVariableScopeKind {
  /** Top level of a module file. Exportable and importable. */
  MODULE_SCOPE = 'MODULE_SCOPE',
  /** Top level of a global script, or inside `declare global`. */
  GLOBAL_SCOPE = 'GLOBAL_SCOPE',
  /** Directly in a function body. */
  FUNCTION_BODY = 'FUNCTION_BODY',
  /** Directly in an arrow body. */
  ARROW_BODY = 'ARROW_BODY',
  /** In a nested block — a `let`/`const` shadowing an outer name. */
  BLOCK_SCOPE = 'BLOCK_SCOPE',
  /** A loop header binding, re-bound per iteration for `let`. */
  FOR_BINDING = 'FOR_BINDING',
  /** A `catch (e)` binding, scoped to the clause. */
  CATCH_BINDING = 'CATCH_BINDING',
  /** Inside a namespace body. */
  NAMESPACE_SCOPE = 'NAMESPACE_SCOPE',
  /** Inside a `.d.ts` or a `declare` context: no runtime existence. */
  AMBIENT_SCOPE = 'AMBIENT_SCOPE',
}
