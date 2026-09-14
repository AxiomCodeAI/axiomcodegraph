/**
 * Every way JavaScript invokes something. Schema §3.11 c0 and §2.4.
 *
 * ## Enumerated against the corpus before the relation was declared
 *
 * §5 of `BUILDING-A-PARSER.md`: *every language has more ways to invoke than
 * "call a method", and each one an engine cannot distinguish is a class of edge
 * it will get wrong.* The counts below are measured over 2,738 files, and they
 * are here because the shape of the distribution is itself a finding: method
 * calls and plain function calls are 86 of every 100 sites, and everything
 * interesting is in the remaining 14.
 *
 * ## `require()` is NOT here
 *
 * It is a **module edge**, by ruling. 9,055 of them were measured, and counting
 * them as unresolved call sites is what made the raw resolution figure look
 * worse than it is — they were listed as declines in a table whose denominator
 * they did not belong in. A `require` produces a `js_import` row and a
 * `js_expression` row, and no `js_call_site` row at all.
 *
 * ## Five values are RESERVED with a zero-row assertion
 *
 * Each is a fact about a value's **runtime identity**, not about the syntax in
 * front of you, and `INDEX_CALL` is the precedent: guessing is wrong more often
 * than it is right. The enum-emission audit carries them on an explicit
 * allowlist, each asserted to have zero rows, so the day one is switched on it
 * shows up as a named gate failure rather than as new rows nobody noticed.
 */
export enum JsCallKind {
  /** `obj.m()`. **46,726 measured** — the most common thing in the language. */
  METHOD_CALL = 'METHOD_CALL',

  /** `fn()`. 39,334. A bare identifier callee, so the binder decides the target. */
  FUNCTION_CALL = 'FUNCTION_CALL',

  /** `new F()`. 7,964. */
  CONSTRUCTOR_CALL = 'CONSTRUCTOR_CALL',

  /**
   * `obj[expr]()`. 663.
   *
   * The name is **not fixed by syntax**, so `calleeName` is `""`. That is not a
   * gap: the row is *complete because it says so*, and the IR-completeness gate
   * treats it as an honest terminal rather than a miss.
   */
  COMPUTED_CALL = 'COMPUTED_CALL',

  /**
   * `f.call(receiver, …)`. 541.
   *
   * **The receiver is argument 0.** An engine reading the syntactic receiver
   * gets `Function.prototype.call` as the target and the real receiver not at
   * all, which is why `receiverPosition` exists as a column.
   */
  FUNCTION_CALL_CALL = 'FUNCTION_CALL_CALL',

  /** `f.apply(receiver, args)`. 318. Same receiver displacement, spread arguments. */
  FUNCTION_CALL_APPLY = 'FUNCTION_CALL_APPLY',

  /**
   * `f.bind(receiver, …)`. 189.
   *
   * **Produces a function; does not invoke one.** Emitted as a call site because
   * `.bind` itself is called, and distinguished because an engine that treats it
   * as an invocation of `f` reports an edge that does not happen at this point in
   * the program. `js_method.thisBinding = BOUND` is the other half.
   */
  FUNCTION_CALL_BIND = 'FUNCTION_CALL_BIND',

  /** `super()`. 517. */
  SUPER_CALL = 'SUPER_CALL',

  /**
   * `(function () { … })()`. 113.
   *
   * The pre-ES6 module pattern, and the reason the expression walker must
   * descend through parentheses: the call, the parenthesis and the function all
   * begin at the same offset, and a subtree rooted at the non-emitting
   * parenthesis dies before its children are enqueued — which cost TypeScript
   * 1,808 expressions.
   */
  IIFE_CALL = 'IIFE_CALL',

  /** `obj?.m()`. 28. Differs from `METHOD_CALL` in reachability, not in target. */
  OPTIONAL_CALL = 'OPTIONAL_CALL',

  /** ``tag`…` ``. 20. Invokes `tag` with the template's pieces. */
  TAGGED_TEMPLATE_CALL = 'TAGGED_TEMPLATE_CALL',

  /**
   * `eval(…)` or `new Function(…)`. 2 measured.
   *
   * The target is **unknowable**, and the row says so. Emitted rather than
   * dropped: a fact base that omits it asserts the program has no dynamic code,
   * which is a stronger claim than admitting one call cannot be followed.
   * `isDynamicCode` is the column a consumer filters on.
   */
  DYNAMIC_CODE_CALL = 'DYNAMIC_CODE_CALL',

  /**
   * `import('m')`.
   *
   * **Also a module edge.** It produces a `js_import` row with
   * `importForm = DYNAMIC_IMPORT` *and* a call-site row, because unlike
   * `require` it is a genuine expression returning a promise — the call happens
   * and its result flows somewhere.
   */
  DYNAMIC_IMPORT_CALL = 'DYNAMIC_IMPORT_CALL',

  // ----------------------------------------------------------------- reserved

  /**
   * **RESERVED — zero rows.** A call through an index signature.
   *
   * Inherited from TypeScript, where it is described as "a resolution outcome
   * about the receiver's TYPE, not readable from syntax". `ops[name](a, b)` is a
   * `COMPUTED_CALL`; whether it resolves *through an index signature* is a fact
   * about the receiver's type and nothing the parser can see.
   */
  INDEX_CALL = 'INDEX_CALL',

  /**
   * **RESERVED — zero rows.** A property read that invokes a getter.
   *
   * 1,225 getters are *declared* in the corpus and **0** invocations are
   * emittable, because `obj.x` invokes a function only if `x` is an accessor on
   * whatever `obj` turns out to be — a fact about the object, not the
   * expression. `js_field.accessorPairKind` records the declaration side, which
   * is the half syntax can answer.
   */
  GETTER_INVOCATION = 'GETTER_INVOCATION',

  /** **RESERVED — zero rows.** `obj.x = v` invoking a setter. Same argument. */
  SETTER_INVOCATION = 'SETTER_INVOCATION',

  /**
   * **RESERVED — zero rows.** A property access that hits a `Proxy` trap.
   *
   * *Any* property access on a proxy may invoke a function. Whether a given
   * object is a proxy is a runtime fact, so emitting this would mean guessing on
   * every member access in the program.
   */
  PROXY_TRAP_CALL = 'PROXY_TRAP_CALL',

  /**
   * **RESERVED — zero rows.** `.next()` resuming a suspended generator frame.
   *
   * Syntactically an ordinary `METHOD_CALL`. That it resumes a frame rather than
   * entering one depends on what the receiver is, and the control flow it
   * implies is nothing like a call.
   */
  GENERATOR_RESUME = 'GENERATOR_RESUME',
}

/**
 * The reserved values, as data.
 *
 * Exported so the enum-emission audit's allowlist is read from here rather than
 * re-typed in the gate. A list maintained in two places drifts, and the
 * direction it drifts is always "the gate stops checking something".
 */
export const RESERVED_CALL_KINDS: readonly JsCallKind[] = [
  JsCallKind.INDEX_CALL,
  JsCallKind.GETTER_INVOCATION,
  JsCallKind.SETTER_INVOCATION,
  JsCallKind.PROXY_TRAP_CALL,
  JsCallKind.GENERATOR_RESUME,
];
