/**
 * The statement form a block belongs to.
 *
 * Mirrors `java_block`'s kind where the languages agree and adds what Python has
 * that Java does not: `ELIF` is a distinct kind rather than a nested `IF`,
 * because CPython's own grammar chains them; `EXCEPT_STAR` is PEP 654;
 * `ASYNC_FOR` and `ASYNC_WITH` are separate because the suspension point matters
 * to a data-flow rule; and `MATCH`/`CASE` have no Java equivalent at all.
 *
 * `COMPREHENSION_BODY` is listed and is where the 3.12 question bites: under
 * PEP 709 a comprehension no longer has a scope of its own, so the block still
 * exists syntactically while the scope beneath it does not.
 *
 * Schema v7 §2.18 c0.
 */
export enum PythonBlockKind {
  IF = 'IF',
  ELIF = 'ELIF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  ASYNC_FOR = 'ASYNC_FOR',
  WHILE = 'WHILE',
  TRY = 'TRY',
  EXCEPT = 'EXCEPT',
  /** `except*` — PEP 654 exception groups. */
  EXCEPT_STAR = 'EXCEPT_STAR',
  FINALLY = 'FINALLY',
  WITH = 'WITH',
  ASYNC_WITH = 'ASYNC_WITH',
  MATCH = 'MATCH',
  CASE = 'CASE',
  FUNCTION_BODY = 'FUNCTION_BODY',
  CLASS_BODY = 'CLASS_BODY',
  MODULE_BODY = 'MODULE_BODY',
  LAMBDA_BODY = 'LAMBDA_BODY',
  COMPREHENSION_BODY = 'COMPREHENSION_BODY',
}
