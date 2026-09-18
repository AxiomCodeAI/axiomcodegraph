/**
 * How a parameter passes its argument — `cs_method_parameter.parameterMode`.
 *
 * ## `out` is a SECOND RETURN CHANNEL
 *
 * This is the one that matters, and it is why the mode is a column on every
 * parameter rather than a flag on a few. `int.TryParse(s, out var n)` returns a
 * `bool` and produces an `int`, and **an engine that models only return values
 * loses that dataflow entirely.** `TryParse` is in every C# codebase written;
 * so is `Dictionary.TryGetValue`.
 *
 * `ref` is both channels at once — the argument flows in and out through the
 * same slot, so a write inside the callee is visible to the caller.
 *
 * ## Why this is a column and not a set of kinds
 *
 * §3: the variant belongs in a field. Multiplying `ref`/`out`/`in` into
 * parameter kinds would mean every rule that reads a parameter has to know all
 * of them, and adding C# 13's `ref readonly` would have broken each one.
 */
export enum CsParameterMode {
  /** By value. The default, and the overwhelming majority. */
  VALUE = 'VALUE',

  /** `ref` — an alias. Reads AND writes cross the boundary in both directions. */
  REF = 'REF',

  /**
   * `out` — a second return channel.
   *
   * The callee MUST assign it before returning, and the caller need not
   * initialise it. Dataflow is callee → caller only.
   */
  OUT = 'OUT',

  /** `in` — a readonly alias. Avoids a copy of a large struct; caller → callee. */
  IN = 'IN',

  /** `ref readonly` — C# 13. Like `in`, but the call site must say `in` or `ref`. */
  REF_READONLY = 'REF_READONLY',

  /**
   * `params` — the caller may pass any number of arguments, or one array.
   *
   * A call site with 3 arguments may be invoking a 1-parameter method. Any
   * arity-based matching that does not know this is wrong.
   */
  PARAMS = 'PARAMS',

  /**
   * `this` on the first parameter of a static method in a static class — an
   * EXTENSION METHOD. 4,147 measured.
   *
   * The single most important marker in this enum for reconstructing edges:
   * `xs.Count()` has a receiver that is NOT the declaring type, and the
   * declaring type is only reachable through this parameter.
   */
  THIS = 'THIS',
}
