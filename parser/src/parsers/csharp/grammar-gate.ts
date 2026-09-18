import Parser from 'tree-sitter';

import {
  blankInactiveRegions,
  resolveFileSymbols,
} from '@/parsers/csharp/extractors/cs-preproc-blank';

/**
 * A fixture that only the PATCHED grammar parses, and the reason it exists.
 *
 * `async` is a contextual keyword in C#. Upstream `tree-sitter-c-sharp` lists it
 * in `modifier` and nowhere else, so every use of it as an ordinary identifier
 * is a parse error. That is not exotic — it is `if (async)`, `var x = async`,
 * `F(q, async: true)` — and cs-oracle measured what it costs over 7,705 files of
 * library C#:
 *
 * | grammar | files erroring | declarations lost vs Roslyn |
 * |---|---|---|
 * | fork, unpatched | 8.62% | **6.44%** |
 * | fork + async patch | 3.01% | **0.37%** |
 *
 * Those two rows were measured with the ASYNC PATCH ALONE. The fork now has
 * six more rules, and cs-oracle's ruling (schema v1.6 §4.0.4) makes the
 * numbers a FLOOR, not a current reading: they are to be re-measured under
 * `fork6` before either is quoted again, and this file quotes them only as
 * the cost of the unpatched grammar the gate exists to refuse.
 *
 * ## Why this is a gate and not a comment
 *
 * The failure mode of installing the wrong grammar is that **nothing throws**.
 * A file with `if (async)` in it parses to an `ERROR` node, the extractor walks
 * around the error, and the run finishes with slightly fewer rows than it
 * should have. There is no exception, no skipped file, no warning — the fact
 * base is simply 6% short, which is a number no gate that counts its own output
 * can see.
 *
 * `npm install` resolving `tree-sitter-c-sharp` from the registry instead of
 * `vendor/tree-sitter-c-sharp` is one lockfile edit away, so this is checked at
 * parser construction, once, and it throws.
 *
 * ## Why the second fixture is here too
 *
 * `async Task M()` must still parse as a MODIFIER. A "fix" that made `async` an
 * identifier everywhere would pass the first probe and break every async method
 * in the corpus, so the gate asserts both directions.
 */
export const ASYNC_IDENTIFIER_PROBE = `
class GrammarGate {
    void M(bool async) {
        if (async) { }
        var x = async;
        F(q: async);
    }
    async System.Threading.Tasks.Task N() { await M2(); }
}
`;

/**
 * The FORTY-EIGHT other shapes only the fork parses, each a measured loss upstream.
 *
 * Every one is a clean parse here and an ERROR upstream, and the gate asserts
 * both the absence of an error AND the node the fork's rule produces — a
 * grammar that merely recovered differently would pass the first test and not
 * the second.
 *
 * 1. A `#if` around a whole base list: upstream displaced the class NAME into
 *    an ERROR and took the directive's symbol as the name, for any symbol of
 *    two characters or more.
 * 2. A `#if` around a function body: upstream recovered a property with an
 *    ERROR child and a method named by the next keyword.
 * 3. `x is null && P(x)`: a constant pattern took every binary operator, so
 *    the right operand of the logical expression was swallowed by the pattern.
 * 4. A ref-returning call on the left of `=`: upstream had no lvalue for it
 *    and read `Local(x) = v` as a declaration of type `Local`.
 * 5. `[.., var tail]`: a slice pattern with a sub-pattern was a parse error.
 * 6. A `#if` around a property body: the same recovery as 2, on a property.
 * 7. `m is < -1 ? a : b`: a relational pattern took ANY expression as its
 *    operand, so the conditional and both its arms were swallowed into the
 *    pattern. Upstream produces a `conditional_expression` too — inside the
 *    pattern — so this probe asserts the node's CHILD: the conditional whose
 *    condition is the is-pattern exists only when the pattern stopped at `-1`.
 * 8. `new Foo<T>(x) { P = 1 }`: with the initializer present the tokens also
 *    read as `new Foo < T > (x){ … }` — two comparisons and a cast — and the
 *    cast's dynamic point made that reading win. The creation with an
 *    `initializer_expression` child exists only when the generic type won.
 * 9. `o is Point(var x, var y)`: upstream read the call's function as the
 *    is-expression — `(o is Point)(var x, var y)` — because any expression
 *    could be a receiver. The receiver of `.`, of a call and of `[…]` is a
 *    primary expression now; the is-pattern with a `recursive_pattern` child
 *    exists only under that rule. (The same rule closes the fork8 regression
 *    on `case nameof(X.Y):`, which the per-segment scoring it replaces caused.)
 * 10. `new Outer<T>.Nested(1)`: rule 8's simple-generic score made the
 *    creation of `Outer<T>` win and `.Nested(1)` a call on it. The qualified
 *    rule now scores above the simple one and recurses; a creation whose type
 *    is a `qualified_name` beginning with a generic exists only under it.
 * 11. `(T)Convert<T>(x)`: both readings hold one cast, so the generic call
 *    and the two comparisons tied and the comparisons won. The generic-call
 *    reading earns a point (C# §6.2.5); a cast whose value is an invocation
 *    exists only when it did.
 * 12. `x = *(T*)p`: pointer indirection took only an lvalue, so a cast
 *    operand was an ERROR — and its recovery could swallow a file.
 * 13. `async (x) => …` and `async Task<R> (x) => …`: `async` is a reserved
 *    identifier (the async patch), and the lambda's modifier carried a static
 *    prec(-1) that made the reserved-identifier reading win before GLR could
 *    fork — so every async lambda read `async` as its RETURN TYPE, and an
 *    explicit return type after it was an error that rule 11 then read as a
 *    generic call and swallowed to end of file (CS-CORPUS-29, the ASP.NET
 *    minimal-API shape). The modifier reading is a declared conflict with a
 *    dynamic point; a lambda with a `modifier` child named async exists only
 *    under it, and so does a parse of the generic form.
 * 14. `x\n#if A\n .M()\n#else\n .N()\n#endif\n .P()` and `a\n#if A\n || b\n#endif`:
 *    a `#if` between a primary and its continuation. Upstream recovers the
 *    chain as a coherent misparse — the receiver an ERROR sibling, the branch
 *    a receiver-less call — and the operator form as an ERROR. A branch holds
 *    a receiver-less segment chain (`preproc_chain_expression`) or an operator
 *    tail (`preproc_operator_expression`), content REQUIRED: with it optional,
 *    recovery closed the `#if` with a MISSING `#endif` and read both arms of
 *    the operator form as operands of one expression (CS-CORPUS-30). The
 *    mirror, `a ||\n#if A\n b ||\n#endif\n c`, holds `expression operator`
 *    and stands as a binary expression's right operand, as the right of
 *    another head (consecutive `#if`s, JsonPropertyInfo.cs), and at four
 *    expression-START positions — a declarator's initializer, a return value,
 *    an if condition and an assignment's right (`return\n#if X\n a &&\n#endif
 *    \n b;`, fifteen corpus sites) — never as a free-standing expression,
 *    which gave recovery a way to swallow the next method.
 * 15. `a || b?.M()`: `?.` binds to a PRIMARY, as `.` does under rule 9.
 *    Upstream took any expression at conditional precedence — `(a || b)?.M()`,
 *    `(!b)?.M()`, `((T)x)?.M()` — 836 null-conditional nodes in 227 corpus
 *    files with a binary or a cast for a receiver. And rule 8's residual: a
 *    NAMED tuple element scores the point its declaration-expression reading
 *    does, so `new HashSet<(string Name, string? Schema)>(src)` is a creation
 *    and not two comparisons of a tuple of two phantom locals.
 * 16. `if (a) {…}\n#if X\n else if (b) {…}\n#endif\n else {…}`: an `else` the
 *    preceding `if` could not take is an `else_fragment` STATEMENT — legal
 *    inside a statement-level `#if` and after its `#endif`, and nowhere a
 *    well-formed if/else changes, because `if_statement`'s prec.right still
 *    takes a directly following `else`. Forty-nine sites in three strata;
 *    upstream's recovery ran from the tail of the method to the whole
 *    namespace flattened, as the LR table's shape decided.
 * 17. `M(\n#if NET\n ReadOnlySpan<char> s,\n#else\n string s,\n#endif\n out T r)`:
 *    a `#if` in a parameter list whose branch holds `T a,` runs. Upstream read
 *    the `#if` as the first parameter's attribute list with a MISSING #endif
 *    and emitted BOTH branches' parameters — arity 3 for a method of arity 2.
 * 18. the same in an argument list: `F(a,\n#if X\n b,\n#else\n c,\n#endif\n d)`.
 *    Upstream lost `d`, the argument after the #endif, into an ERROR.
 * 19. `M() =>\n#if X\n a;\n#else\n b;\n#endif`: the arrow outside, `expression ;`
 *    inside each branch — 43 sites; and a bare `;` body under a function-body
 *    #if (`void W()\n#if X\n { }\n#else\n ;\n#endif`, ILogger.cs). Upstream: `;`
 *    debris, rows right, file counted as failing to parse.
 * 20. `T x =\n#if X\n a;\n#else\n b;\n#endif` on a field or a local — 29 sites.
 * 21. `case A: …\n#if X\n case B: …\n#endif\n default: …`: a `#if` holding switch
 *    SECTIONS — 51 sites. Upstream read `case B:` inside a statement-level `#if`
 *    as a local of type `case` and a labeled statement: NO error, a phantom
 *    local, a phantom label, no case label. `switch_section` lost its
 *    prec.left and `[switch_section]` is a declared conflict so GLR can see
 *    the token after the `#if` line.
 * 22. `if (v is string) { x = $@"""{x}"""; }` - a verbatim interpolated string
 *    whose content begins and ends with an escaped quote, after a GLR fork. Two
 *    SCANNER defects (scanner.patch): the END_QUOTE branch consumed every quote
 *    it saw and fell through to OPEN_BRACE, which took `""{` as one token; and
 *    at the close it took all three quotes and the content then ran to end of
 *    file - ExpressionPrinter.cs, 1,144 lines, lost whole. A verbatim string
 *    ends at ONE quote and `""` is an escape.
 * 22. `class C : A, B\n#if X\n , C\n#endif`: a base-list continuation with a
 *    leading comma — 18 sites. Upstream: `, C` and the directives as ERRORs.
 * 23. `#if X\n if (c) {…}\n else\n#endif\n { body }`: an if whose `else` is the
 *    branch's last token, the else body after the `#endif` — 17 sites. The
 *    dangling if is an `if_statement` with no alternative; a declared conflict
 *    with if_statement and dynamic precedence -1 keep `if (c) s1 else s2`
 *    inside a branch one statement.
 * 24. `where T : allows ref struct`, C# 13's anti-constraint — 26 files.
 * 25. `#pragma warning restore 618` as the LAST LINE of a file with no trailing
 *    newline — 36 files; the terminator is an external token that is a newline
 *    or end of file (scanner.patch). And `#error` / `#warning` with no message.
 * 25. `*(bytes++) = …`: `*` takes a parenthesized operand — five BCL files were
 *    whole-file ERRORs for it.
 * 26. `readonly ref partial struct`: modifiers may follow `ref` — Span2D{T}.cs.
 * 27. `x switch { A => a,\n#if X\n B => b,\n#endif\n _ => z }`: rule 18's shape on
 *    switch-expression arms — 20 sites, 16 in Enum.cs.
 * 28. `M<T>(T v)\n#if X\n where T : allows ref struct\n#endif\n {`: a where clause
 *    under a #if — every `allows` site is guarded.
 * 29. `: A,\n#if X\n B,\n#endif\n C`: the trailing-comma base-list run, rule 22's
 *    other half.
 * 30. `AddKey([property])`: `property`, `type`, `typevar`, `method` and `param`
 *    are attribute targets only before a colon; elsewhere they are names —
 *    24 files, 19 in linq-heavy-A's metadata layer.
 * 31. `#if NET\n public\n#else\n internal\n#endif\n sealed class X`: modifiers under a
 *    #if — 57 sites, 53 in the BCL; and a #if branch holding two attribute
 *    lists (StreamExtensions.cs); and a return type under a #if after the
 *    modifiers (JsonDocument.Parse.cs), which rule 31's #if would otherwise
 *    claim and recovery then took the whole method.
 * 32. `#if NET\n public sealed partial class X<T> : A, B\n#else\n …\n#endif\n {`: a
 *    declaration header under a #if, the body after — seven whole-file errors.
 * 33. `public safe byte AsByte;` — the BCL's `safe` modifier, eight files.
 * 34. `item?.Parent = null;` — C# 14's null-conditional assignment, 12 files.
 * 35. `where T : notnull\n#if NET\n , allows ref struct\n#endif` — a constraint
 *    continuation under a #if, five files.
 */
/**
 * Shapes the PUBLISHED grammar cannot parse — each verified to produce an ERROR
 * node against tree-sitter-c-sharp 0.23.1, not merely suspected.
 *
 * `node` / `withChild` are retained from when this list described a fork's
 * expected OUTPUT; the gate no longer reads them, because the assertion is now
 * that the shape still FAILS. They stay as documentation of what a correct
 * parse would have produced, which is what a repair or an upstream fix has to
 * be checked against.
 */
/**
 * How the published grammar fails a shape. The distinction is the whole reason
 * this list is checkable rather than a comment.
 *
 * ERROR    an ERROR node. Rows are lost and `cs_parse_gap` emits a row saying
 *          so, which a consumer can see and refuse to trust.
 * MISPARSE no error, and the WRONG tree. A well-formed fact base that is wrong,
 *          with nothing to flag it. These are the ones worth extractor repair,
 *          and each carries the node a CORRECT parse would have produced.
 */
export type GrammarLimitationKind = 'ERROR' | 'MISPARSE';

/**
 * Shapes the published grammar reads CORRECTLY, and which a workaround in this
 * repo exists for — asserted still correct.
 *
 * The mirror of {@link KNOWN_GRAMMAR_LIMITATIONS}, and the reason it is needed:
 * when the grammar improves, the workaround becomes unreachable, and so do the
 * negative controls that prove the workaround works. Thirty-one controls in one
 * tally could not fail for exactly this reason. Deleting a control because its
 * defect class is gone is right; deleting it and asserting NOTHING about why it
 * is gone leaves the workaround in the code with no statement of whether it is
 * still needed, and the next grammar bump answers that question silently.
 *
 * So each entry here says: this shape is handled, we know it, and the
 * workaround behind it is dormant. A regression fires this gate and names the
 * file whose control has to come back.
 *
 * VERIFIED BY SHAPE, not by `hasError`. Testing for the absence of an error is
 * what made a previous round report seven live misparses as healthy — an
 * `await_expression` where the source wrote an identifier raises no error and
 * is still wrong. So each entry names the node that MUST be absent (or
 * present), and the test is structural.
 */
export const SHAPES_THE_GRAMMAR_NOW_HANDLES: readonly {
  readonly what: string;
  readonly source: string;
  /** A node type that must NOT appear — the misparse's own signature. */
  readonly absent?: string;
  /** A node type that MUST appear — the correct parse's signature. */
  readonly present?: string;
  /** The workaround left dormant, so a regression report names it. */
  readonly dormantWorkaround: string;
}[] = [
  {
    // The fork produced an `await_expression` here, and CS-ORACLE-1 built a
    // re-read for it: `await` is a contextual keyword, so in a non-async method
    // it is an ordinary identifier. 0.23.1 gets this right.
    what: '`await` as an identifier in a non-async method',
    source: 'class C { void M() { var await = 1; Use(await); } }\n',
    absent: 'await_expression',
    dormantWorkaround: 'the awaitIsKeyword re-read in cs-expression-extractor.ts and cs-member-extractor.ts',
  },
  {
    what: 'an async lambda with a parameter list',
    source: 'class C { void M() { F(async (a, b) => Work(a, b)); } }\n',
    present: 'lambda_expression',
    dormantWorkaround: 'the async-lambda handling in cs-member-extractor.ts',
  },
  {
    what: 'an async lambda with one implicit parameter',
    source: 'class C { void M() { F(async x => Work(x)); } }\n',
    present: 'lambda_expression',
    dormantWorkaround: 'the async-lambda handling in cs-member-extractor.ts',
  },
];

export const KNOWN_GRAMMAR_LIMITATIONS: readonly {
  readonly source: string;
  /** The node a CORRECT parse produces — absent here, by definition. */
  readonly node: string;
  /** When set, some `node` must have a named child of this type. */
  readonly withChild?: string;
  readonly what: string;
  readonly kind: GrammarLimitationKind;
}[] = [
  {
    what: 'a ref-returning call on the left of an assignment',
    node: 'assignment_expression',
    source: 'class C { void M() { Local(instance) = value; A.ById(o) = Plain(); } }\n',
    kind: 'MISPARSE',
  },
  {
    // REPAIRED ABOVE THE GRAMMAR, by a pre-parse rewrite — the entry stays
    // because the GRAMMAR still cannot read it, and this list is about the
    // grammar. The day upstream grows a rule, this gate fails and says to
    // delete cs-semicolon-body.ts.
    //
    // Its recovery is not a local gap: several such declarations in one file
    // merge into ONE type named after the last of them, taking the next real
    // body as its own. 511 declarations across seven codebases.
    what: 'a type declaration whose body is a semicolon (C# 12)',
    node: 'interface_declaration',
    source: 'namespace N;\npublic interface ILock : IBase;\npublic class Marker;\n',
    kind: 'ERROR',
  },
  {
    what: 'a slice pattern with a sub-pattern',
    node: 'slice_pattern',
    source: 'class C { string M(int[] v) => v switch { [var head, .. var tail] => "h", _ => "x" }; }\n',
    kind: 'ERROR',
  },
  {
    what: 'a relational pattern as the condition of a conditional expression',
    node: 'conditional_expression',
    withChild: 'is_pattern_expression',
    source: 'class C { int M(int m) => m is < -1 ? T(m) : S(m); }\n',
    kind: 'MISPARSE',
  },
  {
    what: 'a generic object creation with arguments and an initializer',
    node: 'object_creation_expression',
    withChild: 'initializer_expression',
    source: 'class C { object M() => new Foo<T>(x) { P = 1 }; }\n',
    kind: 'MISPARSE',
  },
  {
    what: 'a positional pattern with designations after is',
    node: 'is_pattern_expression',
    withChild: 'recursive_pattern',
    source: 'class C { bool M(object o) => o is Point(var x, var y) && x > 0; }\n',
    kind: 'MISPARSE',
  },
  {
    what: 'a cast-prefixed generic method call',
    node: 'cast_expression',
    withChild: 'invocation_expression',
    source: 'class C { object M() => (T)Convert<T>(x); }\n',
    kind: 'MISPARSE',
  },
  {
    what: 'a pointer indirection of a cast',
    node: 'prefix_unary_expression',
    withChild: 'cast_expression',
    source: 'class C { unsafe void M(void* p) { x = *(T*)p; } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a verbatim interpolated string beginning and ending with an escaped quote, after an is-pattern fork',
    node: 'interpolated_string_expression',
    withChild: 'interpolation',
    source: 'class C { void M(object v, string x) {\nif (v is string)\n{\n    x = $@"""{x}""";\n}\n} }\n',
    kind: 'ERROR',
  },
  {
    what: 'a where clause with the allows ref struct anti-constraint',
    node: 'type_parameter_constraints_clause',
    withChild: 'type_parameter_constraint',
    source: 'class C { static void M<T>(T v) where T : allows ref struct { } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a #pragma as the last line of a file with no trailing newline',
    node: 'preproc_pragma',
    source: 'class C { }\n#pragma warning restore 618',
    kind: 'ERROR',
  },
  {
    what: 'a pointer indirection of a parenthesized operand, assigned to',
    node: 'assignment_expression',
    withChild: 'prefix_unary_expression',
    source: 'class C { unsafe void M(byte* p, int x) { *(p++) = (byte)x; } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a struct header with modifiers after ref',
    node: 'struct_declaration',
    withChild: 'declaration_list',
    source: 'public readonly ref partial struct S<T> { }\n',
    kind: 'ERROR',
  },
  {
    what: 'a where clause under a #if between the signature and the body',
    node: 'method_declaration',
    withChild: 'preproc_if',
    source: 'class C { bool M<T>(T v)\n#if A\n where T : allows ref struct\n#endif\n { return true; } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a collection expression whose element is a local named property',
    node: 'collection_expression',
    withChild: 'collection_element',
    source: 'class C { object M(object property) => F([property]); object F(object x) => x; }\n',
    kind: 'ERROR',
  },
  {
    what: 'the safe modifier on a field',
    node: 'field_declaration',
    withChild: 'modifier',
    source: 'class C { public safe int F; }\n',
    kind: 'ERROR',
  },
  {
    what: 'a null-conditional element assignment',
    node: 'assignment_expression',
    withChild: 'conditional_access_expression',
    source: 'class C { void M(int[] a) { a?[0] = 1; } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a constraint continuation with a leading comma under a #if',
    node: 'type_parameter_constraints_clause',
    withChild: 'preproc_if',
    source: 'class C { void M<T>(T v) where T : notnull\n#if A\n , allows ref struct\n#endif\n { } }\n',
    kind: 'ERROR',
  },
  {
    what: 'a null-conditional call after a binary operator, its receiver a name',
    node: 'conditional_access_expression',
    withChild: 'identifier',
    source: 'class C { bool M(bool a, string b) => a || b?.Contains("z") == true; }\n',
    kind: 'MISPARSE',
  },
  {
    what: 'a creation whose generic argument is a named tuple type',
    node: 'object_creation_expression',
    withChild: 'argument_list',
    source: 'class C { object M(object src) => new HashSet<(string Name, string? Schema)>(src); }\n',
    kind: 'MISPARSE',
  },
];


/**
 * Fails loudly when the installed grammar is not the patched fork.
 *
 * Called once from {@link CSharpParser}'s constructor rather than per file: the
 * grammar cannot change under a running process, and a per-file check would pay
 * a parse for every file to learn something already known.
 *
 * `probe` is a parameter for one reason: **a check nobody has seen fail is not
 * known to be capable of failing.** The suite calls this with a source the
 * patched grammar cannot parse and asserts it throws, so the null result here
 * is a measurement rather than an assumption. Production callers pass nothing.
 */
/**
 * THE GATE, INVERTED — and the inversion is the point.
 *
 * This asserted that the installed grammar was a 39-rule FORK of
 * `tree-sitter-c-sharp`. The fork is gone: C# now takes the published grammar
 * from npm like java, python and groovy do, because a vendored 74 MB generated
 * LR table in the repository and a side repo pinned by SHA are both dependency
 * surface nobody wants to carry.
 *
 * That trade is real and it is not free. The published grammar cannot parse a
 * set of shapes, and it fails by producing ERROR nodes rather than mis-shaped
 * trees — there is no structure left for an extractor to repair. Measured over
 * 12,054 corpus files: 9,289,655 error bytes in 1,249 files, against 14,004 in
 * 60 with the fork.
 *
 * So the gate no longer asserts a grammar we control. It asserts TWO things
 * about the one we depend on:
 *
 *   1. It is a C# grammar and it loads. A wrong or missing grammar must fail
 *      HERE, at construction, because its failure mode is that nothing throws.
 *
 *   2. Every shape we know it cannot parse STILL cannot parse. That is the
 *      inversion. Each entry in {@link KNOWN_GRAMMAR_LIMITATIONS} is a
 *      construct whose loss is documented and measured; if upstream fixes one,
 *      this gate FAILS and tells us to delete the entry and claim the rows.
 *      A known limitation that silently becomes supported is a fact base that
 *      grew for reasons nobody recorded, which is the same class of error as
 *      one that silently shrank.
 *
 * A limitation list that is never checked rots into folklore. This one is
 * checked on every construction.
 */
export type HandledShape = (typeof SHAPES_THE_GRAMMAR_NOW_HANDLES)[number];

/**
 * The regression message for one handled shape, or nothing.
 *
 * SEPARATE FROM THE GATE, and exported, because the gate runs in the parser's
 * CONSTRUCTOR: a control that mutates the check itself makes every other check
 * in the suite crash, and the harness can only call that inconclusive. A
 * predicate the suite can call directly is testable in both directions — the
 * real entries return nothing, an inverted one returns a message — and its
 * control fails ONE check instead of the run.
 */
export function handledShapeRegression(
  parser: Parser,
  handled: HandledShape
): string | undefined {
  const root = parser.parse(handled.source).rootNode;
  const broken =
    root.hasError ||
    (handled.absent !== undefined && subtreeContainsType(root, handled.absent)) ||
    (handled.present !== undefined && !subtreeContainsType(root, handled.present));
  if (!broken) {
    return undefined;
  }
  return (
    `C# grammar gate FAILED — A REGRESSION: ${handled.what} is no longer read correctly by ` +
    'the published grammar.\n' +
    `  The workaround for it is still in the tree and is now needed again: ${handled.dormantWorkaround}.\n` +
    '  Its negative control was deleted when the grammar fixed the shape; restore one, ' +
    'because a workaround nothing proves is a workaround nobody can trust.'
  );
}

export function assertPatchedGrammar(
  parser: Parser,
  probe: string = ASYNC_IDENTIFIER_PROBE
): void {
  // 1. A C# grammar is loaded and parses ordinary C#.
  const sane = parser.parse('class C { void M() { M(); } }\n').rootNode;
  if (sane.hasError || !subtreeContainsType(sane, 'method_declaration')) {
    throw new Error(
      'C# grammar gate FAILED: `class C { void M() { M(); } }` did not parse to a ' +
        'method_declaration. The installed grammar is not tree-sitter-c-sharp, or did not ' +
        'load.\n' +
        '  Effect if ignored: nothing throws. The fact base is simply empty or short.\n' +
        '  Fix: `npm install` — tree-sitter-c-sharp is a normal dependency, pinned in ' +
        'package.json.'
    );
  }

  // The suite hands in its own source to prove this gate can fail; that call
  // is not asking about the limitation list.
  if (probe !== ASYNC_IDENTIFIER_PROBE) {
    const given = parser.parse(probe).rootNode;
    if (given.hasError) {
      throw new Error('C# grammar gate FAILED: the probe handed to it does not parse.');
    }
    return;
  }

  // 2. Every known limitation is still a limitation — asserted by its KIND,
  //    AND THROUGH THE SHIPPED PIPELINE. The parser blanks the `#if` arms this
  //    emission does not compile before the grammar sees the text, so a gate
  //    that parsed the raw source would describe a parser nobody runs. That
  //    mattered: 29 shapes stopped being limitations the moment blanking
  //    landed, and a raw-source gate went on asserting they were broken.
  //    because the two kinds fail differently and a single test cannot see
  //    both. Testing `hasError` alone is what made me report seven misparses
  //    as healthy: absence of an error is not correctness.
  for (const limitation of KNOWN_GRAMMAR_LIMITATIONS) {
    const root = parser.parse(
      blankInactiveRegions(
        limitation.source,
        resolveFileSymbols('net8.0', ['A', 'DEBUG', 'TRACE'])
      )
    ).rootNode;
    const stillLimited =
      limitation.kind === 'ERROR'
        ? root.hasError
        : // MISPARSE: no error, and the node a correct parse would produce is
          // absent. If it appears, upstream has fixed the shape.
          !subtreeContainsType(root, limitation.node, limitation.withChild);
    if (!stillLimited) {
      throw new Error(
        `C# grammar gate FAILED — GOOD NEWS, and it needs acting on: ${limitation.what} now ` +
          'parses cleanly in the published grammar. It has been a documented, measured ' +
          'absence.\n' +
          '  Do: delete its entry from KNOWN_GRAMMAR_LIMITATIONS, and check whether the ' +
          'extractor now needs to read the construct — the rows it was losing are ' +
          'claimable.\n' +
          '  This gate fires on an IMPROVEMENT because a fact base that grows for reasons ' +
          'nobody recorded is as untrustworthy as one that shrinks.'
      );
    }
  }
  // 3. Every shape the grammar now handles STILL handles it. The inversion of
  //    the inversion: a workaround whose input no longer occurs is dormant, and
  //    dormant is not the same as unnecessary. This is what says which.
  for (const handled of SHAPES_THE_GRAMMAR_NOW_HANDLES) {
    const regression = handledShapeRegression(parser, handled);
    if (regression !== undefined) {
      throw new Error(regression);
    }
  }

}

export function subtreeContainsType(node: Parser.SyntaxNode, type: string, withChild?: string): boolean {
  const stack: Parser.SyntaxNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === type && (withChild === undefined || hasNamedChildOfType(current, withChild))) {
      return true;
    }
    for (let i = 0; i < current.namedChildCount; i += 1) {
      const child = current.namedChild(i);
      if (child !== null) {
        stack.push(child);
      }
    }
  }
  return false;
}

function hasNamedChildOfType(node: Parser.SyntaxNode, type: string): boolean {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    if (node.namedChild(i)?.type === type) {
      return true;
    }
  }
  return false;
}
