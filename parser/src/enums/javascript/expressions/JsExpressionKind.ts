/**
 * What an expression node is. Schema §3.10 c0 — the spine's vocabulary.
 *
 * ## The operator is a COLUMN, not a kind
 *
 * `+=`, `-=`, `**=`, `??=`, `||=` and `&&=` are **one** `ASSIGNMENT` kind with
 * `operatorString` distinguishing them. Java established this and TypeScript
 * follows it, and the reason is in §3 of `BUILDING-A-PARSER.md`: Python emitted
 * `x += 1` as two depth-0 roots with no wrapper and no parent, so 1,276
 * statements became unpairable.
 *
 * The failure mode is worse than lost rows. The proposed engine-side workaround
 * was to join target and value on `(scope, line, rootContext)`; on
 * `a += 1; b += 2` that yields four pairs, two of them wrong — `a` paired with
 * `2`. Flat output does not merely lose structure, it **invites a fix that
 * manufactures wrong edges**.
 *
 * So the rule for every construct here: one wrapper node, children parented to
 * it with an `edgeRole`, and the variant in a column. The five-minute checklist
 * asks whether it survives *two on one line*, and that is why.
 *
 * ## Reached by an ALLOWLIST of expression positions, never a generic walk
 *
 * §6: a generic tree walk puts JSDoc type names into the expression relation,
 * and type-only constructs then reach the call graph.
 */
export enum JsExpressionKind {
  // --------------------------------------------------------------- references
  /** A bare name: `foo`. The binder decides what it refers to. */
  IDENTIFIER = 'IDENTIFIER',

  /** `this`. 33,189 measured, and what it refers to depends on the call form. */
  THIS = 'THIS',

  /** `super`. */
  SUPER = 'SUPER',

  /**
   * `new.target` and `import.meta` — a MetaProperty, a keyword pair that
   * refers to a runtime slot and never to a binding.
   *
   * Ruled 2026-09-13 (#175): the last named expression residue, 5 sites on
   * the development corpus, and `import.meta.url` is the ESM idiom that
   * `createRequire` is fed with. `referencedName` is the pair as written;
   * `bindingResolution` is empty because no scope resolves it.
   */
  META_PROPERTY = 'META_PROPERTY',

  /** A literal: string, number, template, regex, `null`, `true`, bigint. */
  LITERAL = 'LITERAL',

  // ------------------------------------------------------------------- access
  /**
   * `obj.prop`. The name is fixed by syntax, so `name` is populated.
   */
  PROPERTY_ACCESS = 'PROPERTY_ACCESS',

  /**
   * `obj[expr]`. **715 computed member names measured.**
   *
   * `name` is `""` and `isComputedName` is true. A row that says the name is
   * unknown is complete; a row that guesses a name is worse than either.
   */
  ELEMENT_ACCESS = 'ELEMENT_ACCESS',

  /** `obj?.prop` / `obj?.[expr]`. Differs in reachability, not in target. */
  OPTIONAL_ACCESS = 'OPTIONAL_ACCESS',

  // -------------------------------------------------------------------- calls
  /** `fn(…)`, `obj.m(…)`. The 1:1 partner of a `js_call_site` row. */
  CALL = 'CALL',

  /** `new F(…)`. */
  NEW = 'NEW',

  /** ``tag`…` ``. Invokes `tag`; also a call site. */
  TAGGED_TEMPLATE = 'TAGGED_TEMPLATE',

  /**
   * `require('x')` or `import('x')`.
   *
   * `isModuleEdge` is true and **no `js_call_site` row is minted for a
   * `require`** — it is a module edge by ruling, and counting it as an
   * unresolved call is what made the raw resolution figure look worse than it
   * was. `import('x')` gets both, because its result genuinely flows somewhere.
   */
  MODULE_EDGE_CALL = 'MODULE_EDGE_CALL',

  // --------------------------------------------------------------- operations
  /**
   * `=`, `+=`, `??=`, `||=` — **every** assignment form.
   *
   * One kind. The target is parented under `ASSIGNMENT_TARGET` and the value
   * under `ASSIGNMENT_VALUE`, and `operatorString` says which operator. This is
   * also the kind that carries `isDeclarationBearing`, because
   * `Foo.prototype.bar = function () {}` is an assignment that declares a method.
   */
  ASSIGNMENT = 'ASSIGNMENT',

  /** A binary operator: `+`, `===`, `instanceof`, `in`, `&&`, `??`. */
  BINARY = 'BINARY',

  /** A prefix or postfix unary: `!`, `-`, `typeof`, `void`, `delete`, `++`, `--`. */
  UNARY = 'UNARY',

  /** `c ? a : b`. */
  CONDITIONAL = 'CONDITIONAL',

  /** `(a, b, c)` — the comma operator. Rare, and it evaluates all of them. */
  SEQUENCE = 'SEQUENCE',

  // ----------------------------------------------------------------- literals
  /**
   * `{ a: 1, m() {} }`.
   *
   * A **value**, never a `js_type`. Treating every object literal as a type is
   * how a JavaScript fact base acquires 50,000 meaningless types — and the
   * pre-ES6 module pattern makes it tempting, because the literal really is
   * playing the role a class would.
   */
  OBJECT_LITERAL = 'OBJECT_LITERAL',

  /** `[1, 2, …rest]`. */
  ARRAY_LITERAL = 'ARRAY_LITERAL',

  /** A property key inside an object literal, emitted as its own row. */
  PROPERTY_KEY = 'PROPERTY_KEY',

  /** `...x` in a call, an array, or an object literal. */
  SPREAD = 'SPREAD',

  /** `` `a${b}c` `` — the substitutions are parented under it. */
  TEMPLATE = 'TEMPLATE',

  // --------------------------------------------------------------- functions
  /**
   * A function expression, arrow, or class expression **in expression
   * position**.
   *
   * The row exists so the expression tree is not broken by a callable sitting in
   * it, and `declarationLinkHash` points at the `js_method`/`js_type` row it
   * introduces. The body's contents belong to that method's own rows — which is
   * the boundary §6 says the worklist stops at and must be descended
   * **explicitly**, because `return function () { … }` once emitted the function
   * and nothing inside it.
   */
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',

  /** `await x`. */
  AWAIT = 'AWAIT',

  /** `yield x` / `yield* xs`. 248 measured. */
  YIELD = 'YIELD',

  // --------------------------------------------------------------------- JSX
  /**
   * A JSX element or fragment.
   *
   * Emitted because JSX in a plain `.js` file parses — `ScriptKind.JS` already
   * carries `languageVariant = JSX`. The **brace** inside one is the trap:
   * `{t(msg)}` produces no row of its own, so a subtree rooted at it dies before
   * its children are enqueued, and that cost TypeScript **4,488 of admin-ui's
   * 14,335 call sites**. Unwrapped at the root, in one place.
   */
  JSX_ELEMENT = 'JSX_ELEMENT',

  /**
   * A JSX element whose tag REFERENCES NOTHING — `<div>`, `<foo-bar>`,
   * `<svg:circle>`, and a fragment `<>…</>`.
   *
   * Schema §2.5a. Two kinds rather than a flag because the two differ in
   * whether they reference anything at all, which is structural: a component
   * element carries a `JSX_TAG_NAME` child that reads a binding; an intrinsic
   * one carries none, because the factory receives the STRING `"div"` and
   * minting a reference row for it would put a name into the binding graph
   * that no binding can satisfy. A fragment has no tag and so no reference
   * either — the property that defines this kind — and is recorded here.
   *
   * Intrinsic iff a simple identifier that is either not a valid ECMAScript
   * identifier (`Foo-Bar`: a name no `const` can bind) or begins with a
   * lowercase letter — a character that CHANGES under `toUpperCase`, so `_`
   * and `$` are not lowercase and `<_Private>` is a reference.
   */
  JSX_INTRINSIC_ELEMENT = 'JSX_INTRINSIC_ELEMENT',

  /** A JSX attribute's value. */
  JSX_ATTRIBUTE_VALUE = 'JSX_ATTRIBUTE_VALUE',
}
