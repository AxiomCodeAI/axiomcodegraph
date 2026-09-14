/**
 * The five parameter kinds Python distinguishes, plus the two bare markers.
 *
 * This is required for argument→parameter flow, which is the **primary** typing
 * mechanism given that 68.2% of parameters carry no annotation. Getting the kind
 * wrong misaligns every positional argument after it.
 *
 * ## Examples
 *
 * ```python
 * def f(a, /, b, *args, c, **kwargs): ...
 * #     ^      ^  ^      ^   ^
 * #     |      |  |      |   VAR_KEYWORD
 * #     |      |  |      KEYWORD_ONLY
 * #     |      |  VAR_POSITIONAL
 * #     |      POSITIONAL_OR_KEYWORD
 * #     POSITIONAL_ONLY  (the `/` itself is POSITIONAL_ONLY_MARKER)
 * ```
 *
 * Schema v6 §2.8 c12.
 */
export enum PythonParameterKind {
  /** The default: bindable by position or by name. */
  POSITIONAL_OR_KEYWORD = 'POSITIONAL_OR_KEYWORD',

  /** Before `/` (PEP 570) — cannot be passed by name. */
  POSITIONAL_ONLY = 'POSITIONAL_ONLY',

  /** After `*` — must be passed by name. */
  KEYWORD_ONLY = 'KEYWORD_ONLY',

  /** `*args`. */
  VAR_POSITIONAL = 'VAR_POSITIONAL',

  /** `**kwargs`. */
  VAR_KEYWORD = 'VAR_KEYWORD',

  /** The bare `/` marker. Binds no name. */
  POSITIONAL_ONLY_MARKER = 'POSITIONAL_ONLY_MARKER',

  /** The bare `*` marker. Binds no name. */
  KEYWORD_ONLY_MARKER = 'KEYWORD_ONLY_MARKER',
}
