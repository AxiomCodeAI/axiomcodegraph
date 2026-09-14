/**
 * Which channel declared this position's type, if any. Schema §2.3.
 *
 * On `js_method` c19, `js_method_parameter` c4, `js_field` c8 and
 * `js_variable` c9 — every typed position carries it.
 *
 * ## The measurement that makes this the most important column in the schema
 *
 * | channel | share of parameters |
 * |---|---|
 * | nothing | 62.1% |
 * | **JSDoc** | **37.9%** |
 * | syntactic annotation | **0%** in the replication corpus — see below |
 *
 * TypeScript's schema is Java-shaped because 85.3% of its parameters are
 * annotated; declared-type receiver typing is its primary resolution mechanism.
 * Here that mechanism is **absent from the syntax**. JSDoc is not a comment
 * feature in this language — it is the type annotation, the compiler parses it
 * into `node.jsDoc` and uses it for inference under `checkJs`, and a schema that
 * treats it as trivia has no type channel at all.
 */
export enum JsDeclaredTypeSource {
  /** No declared type. 62.1% of parameters, and the normal case. */
  NONE = 'NONE',

  /**
   * A JSDoc tag: `@param {string} x`, `@type {Foo}`, `@returns {Promise<T>}`.
   *
   * 14,307 `@param`, 8,869 `@type`, 6,073 `@returns` measured. The tree it
   * describes lives in `js_type_reference`, because `Array<Object<string,
   * number>>` is three nodes and not a string.
   */
  JSDOC = 'JSDOC',

  /**
   * A **Flow** annotation in the source syntax.
   *
   * **The measurement behind this value has been retracted.** 64 syntactic
   * annotations were originally reported, all of them Flow; the replication
   * corpus measures **0**, because all 64 were in one package that corpus does
   * not contain.
   *
   * The value is kept rather than removed, on `js-oracle`'s ruling: the
   * held-back corpus (a Flow-typed framework, Flow throughout) was chosen specifically to
   * test it. If that holdout shows the column is wrong, that is the holdout doing its
   * job — which is the only thing a holdout is for. `ts.createSourceFile` parses Flow into real `.type` nodes where
   * the two grammars overlap and **mis-parses silently where they do not**, so
   * the annotation is present in the AST and means something slightly different
   * from what a TypeScript reader would assume.
   *
   * Recording it is what keeps a later reader from treating a Flow annotation as
   * a TypeScript one. `js_module.hasFlowPragma` is the corroborating evidence.
   */
  SYNTACTIC_FLOW = 'SYNTACTIC_FLOW',
}
