import Parser from 'tree-sitter';

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
export const FORK_RULE_PROBES: readonly {
  readonly source: string;
  readonly node: string;
  /** When set, some `node` must have a named child of this type. */
  readonly withChild?: string;
  readonly what: string;
}[] = [
  {
    what: 'a #if around a base list',
    node: 'preproc_if',
    source: 'namespace N { public abstract partial class Reader\n#if HAVE_ASYNC_DISPOSABLE\n : System.IAsyncDisposable\n#endif\n { } }\n',
  },
  {
    what: 'a #if around a function body',
    node: 'preproc_if',
    source: 'class C {\n string M()\n#if CORECLR\n => Native();\n#else\n => "fallback";\n#endif\n}\n',
  },
  {
    what: 'an is-pattern as the left operand of &&',
    node: 'binary_expression',
    source: 'class C { bool M(string s) => s is not null && P(s); }\n',
  },
  {
    what: 'a ref-returning call on the left of an assignment',
    node: 'assignment_expression',
    source: 'class C { void M() { Local(instance) = value; A.ById(o) = Plain(); } }\n',
  },
  {
    what: 'a slice pattern with a sub-pattern',
    node: 'slice_pattern',
    source: 'class C { string M(int[] v) => v switch { [var head, .. var tail] => "h", _ => "x" }; }\n',
  },
  {
    what: 'a #if around a property body',
    node: 'preproc_if',
    source: 'class C {\n int X\n#if A\n { get; set; }\n#else\n => 1;\n#endif\n}\n',
  },
  {
    what: 'a relational pattern as the condition of a conditional expression',
    node: 'conditional_expression',
    withChild: 'is_pattern_expression',
    source: 'class C { int M(int m) => m is < -1 ? T(m) : S(m); }\n',
  },
  {
    what: 'a generic object creation with arguments and an initializer',
    node: 'object_creation_expression',
    withChild: 'initializer_expression',
    source: 'class C { object M() => new Foo<T>(x) { P = 1 }; }\n',
  },
  {
    what: 'a positional pattern with designations after is',
    node: 'is_pattern_expression',
    withChild: 'recursive_pattern',
    source: 'class C { bool M(object o) => o is Point(var x, var y) && x > 0; }\n',
  },
  {
    what: 'a creation of a nested type of a generic type',
    node: 'object_creation_expression',
    withChild: 'qualified_name',
    source: 'class C { object M() => new Outer<T>.Nested(1); }\n',
  },
  {
    what: 'a cast-prefixed generic method call',
    node: 'cast_expression',
    withChild: 'invocation_expression',
    source: 'class C { object M() => (T)Convert<T>(x); }\n',
  },
  {
    what: 'a pointer indirection of a cast',
    node: 'prefix_unary_expression',
    withChild: 'cast_expression',
    source: 'class C { unsafe void M(void* p) { x = *(T*)p; } }\n',
  },
  {
    what: 'an async lambda whose async is a modifier',
    node: 'lambda_expression',
    withChild: 'modifier',
    source: 'class C { void M() { F(async (int id) => await G(id)); } }\n',
  },
  {
    what: 'an async lambda with an explicit generic return type',
    node: 'lambda_expression',
    withChild: 'generic_name',
    source: 'class C { void M() { F(async Task<Results<Ok<int>, NotFound<string>>> (int id, Db db) => new Results<Ok<int>, NotFound<string>>()); } }\n',
  },
  {
    what: 'a #if splitting a fluent chain',
    node: 'preproc_chain_expression',
    withChild: 'preproc_if',
    source: 'class C { object M(B b) => b.Create()\n#if A\n .UseX(o => o.Set(1))\n#else\n .UseY(1).Z<T>()\n#endif\n .Build(); }\n',
  },
  {
    what: 'a #if holding a binary operator and its right operand',
    node: 'preproc_operator_expression',
    withChild: 'preproc_if',
    source: 'class C { bool M(int c) => c == 1 || c > 2\n#if A\n || c == 3\n#endif\n ; }\n',
  },
  {
    what: 'a #if holding a left operand and its trailing operator',
    node: 'preproc_head_expression',
    withChild: 'preproc_if',
    source: 'class C { bool M(int c) => c == 1 ||\n#if A\n c == 2 || c == 3 ||\n#endif\n c == 4; }\n',
  },
  {
    what: 'a #if holding a left operand and its operator at the START of a return value',
    node: 'return_statement',
    withChild: 'preproc_head_expression',
    source: 'class C { bool M(int c) { return\n#if A\n c == 1 &&\n#endif\n c == 4; } }\n',
  },
  {
    what: 'two consecutive #if heads, the second the right of the first',
    node: 'preproc_head_expression',
    withChild: 'preproc_head_expression',
    source: 'class C { bool M(int c) => c == 1 ||\n#if A\n c == 2 ||\n#endif\n#if B\n c == 3 ||\n#endif\n c == 4; }\n',
  },
  {
    what: 'an else clause under a #if, its if before the #if',
    node: 'preproc_if',
    withChild: 'else_fragment',
    source: 'class C { void M(bool a) { if (a) { } \n#if A\n else if (!a) { }\n#endif\n else { } } }\n',
  },
  {
    what: 'an else clause after a #endif, continuing the chain the branch began',
    node: 'block',
    withChild: 'else_fragment',
    source: 'class C { void M(bool a) { if (a) { } \n#if A\n else if (!a) { }\n#endif\n else { } } }\n',
  },
  {
    what: 'a #if in a parameter list whose branch holds a parameter and its comma',
    node: 'parameter_list',
    withChild: 'preproc_if',
    source: 'class C { bool M(\n#if A\n int s,\n#else\n string s,\n#endif\n out int r) { r = 1; return true; } }\n',
  },
  {
    what: 'a #if in an argument list whose branch holds an argument and its comma',
    node: 'argument_list',
    withChild: 'preproc_if',
    source: 'class C { int F(int a, int b, int c) => a; int M() => F(1,\n#if A\n 2,\n#else\n 3,\n#endif\n 4); }\n',
  },
  {
    what: 'an arrow body whose branch holds the expression AND its semicolon',
    node: 'arrow_expression_clause',
    withChild: 'preproc_if',
    source: 'class C { bool M() =>\n#if A\n true;\n#else\n false;\n#endif\n}\n',
  },
  {
    // Rule 38. The #if branch carries its OWN trailing comma, which is why the
    // initializer is shaped like an argument list rather than a commaSep.
    what: 'a #if inside a collection initializer whose branch holds an element and its comma',
    node: 'initializer_expression',
    withChild: 'preproc_if',
    source: 'class C { int[] M() { return new int[] { 1,\n#if A\n 2,\n#endif\n 3 }; } }\n',
  },
  {
    // Rule 39. A `catch` is neither a statement nor an expression, so no other
    // #if rule can hold one.
    what: 'a #if holding a catch clause between two others',
    node: 'try_statement',
    withChild: 'preproc_if',
    source: 'class C { void M() { try { } catch (System.Exception) { }\n#if A\n catch { }\n#endif\n } }\n',
  },
  {
    // Rule 36. The discriminator is `hasError`, not the node pair: a
    // `method_declaration` holding a `preproc_if` is what the bare-`;` probe
    // below asserts too, and both were true before this rule existed. This
    // source was three ERRORs on the fork23 grammar, so a grammar without
    // rule 36 fails on the error check above rather than passing vacuously.
    what: 'an arrow body wholly inside a #if, with the semicolon after the #endif',
    node: 'method_declaration',
    withChild: 'preproc_if',
    source: 'interface I { I F<T>()\n#if A\n => F<T>()\n#endif\n ; }\n',
  },
  {
    what: 'a bare ; body under a function-body #if',
    node: 'method_declaration',
    withChild: 'preproc_if',
    source: 'interface I { void W()\n#if A\n { }\n#else\n ;\n#endif\n}\n',
  },
  {
    what: 'a field initializer whose branch holds the expression AND its semicolon',
    node: 'variable_declarator',
    withChild: 'preproc_if',
    source: 'class C { int a, b =\n#if A\n 1;\n#else\n 2;\n#endif\n}\n',
  },
  {
    what: 'a #if holding a switch section between two others',
    node: 'switch_body',
    withChild: 'preproc_if',
    source: 'class C { int M(int k) { switch (k) { case 1: return 1;\n#if A\n case 2: return 2;\n#endif\n default: return 0; } } }\n',
  },
  {
    what: 'a verbatim interpolated string beginning and ending with an escaped quote, after an is-pattern fork',
    node: 'interpolated_string_expression',
    withChild: 'interpolation',
    source: 'class C { void M(object v, string x) {\nif (v is string)\n{\n    x = $@"""{x}""";\n}\n} }\n',
  },
  {
    what: 'a base-list continuation with a leading comma under a #if',
    node: 'base_list',
    withChild: 'preproc_if',
    source: 'class C : System.IDisposable\n#if A\n , System.IAsyncDisposable\n#endif\n{ }\n',
  },
  {
    what: 'an if whose else keyword ends the #if branch, the else body after the #endif',
    node: 'preproc_if',
    withChild: 'if_statement',
    source: 'class C { void M(bool a) {\n#if A\n if (a) { M(a); }\n else\n#endif\n { M(!a); }\n} }\n',
  },
  {
    what: 'a where clause with the allows ref struct anti-constraint',
    node: 'type_parameter_constraints_clause',
    withChild: 'type_parameter_constraint',
    source: 'class C { static void M<T>(T v) where T : allows ref struct { } }\n',
  },
  {
    what: 'a #pragma as the last line of a file with no trailing newline',
    node: 'preproc_pragma',
    source: 'class C { }\n#pragma warning restore 618',
  },
  {
    what: 'a #error with no message',
    node: 'preproc_error',
    source: 'class C {\n#if A\n int x;\n#else\n #error\n#endif\n}\n',
  },
  {
    what: 'a pointer indirection of a parenthesized operand, assigned to',
    node: 'assignment_expression',
    withChild: 'prefix_unary_expression',
    source: 'class C { unsafe void M(byte* p, int x) { *(p++) = (byte)x; } }\n',
  },
  {
    what: 'a struct header with modifiers after ref',
    node: 'struct_declaration',
    withChild: 'declaration_list',
    source: 'public readonly ref partial struct S<T> { }\n',
  },
  {
    what: 'a #if holding switch-expression arms and their commas',
    node: 'switch_expression',
    withChild: 'preproc_if',
    source: 'class C { int M(int x) => x switch { 1 => 10,\n#if A\n 2 => 20,\n#endif\n _ => 0 }; }\n',
  },
  {
    what: 'a where clause under a #if between the signature and the body',
    node: 'method_declaration',
    withChild: 'preproc_if',
    source: 'class C { bool M<T>(T v)\n#if A\n where T : allows ref struct\n#endif\n { return true; } }\n',
  },
  {
    what: 'a base-list run ending in a comma under a #if',
    node: 'base_list',
    withChild: 'preproc_if',
    source: 'class C : System.IDisposable,\n#if A\n System.IAsyncDisposable,\n#endif\n System.ICloneable { }\n',
  },
  {
    what: 'a collection expression whose element is a local named property',
    node: 'collection_expression',
    withChild: 'collection_element',
    source: 'class C { object M(object property) => F([property]); object F(object x) => x; }\n',
  },
  {
    what: 'modifiers under a #if before a class',
    node: 'class_declaration',
    withChild: 'preproc_if',
    source: '#if A\npublic\n#else\ninternal\n#endif\nsealed class C { }\n',
  },
  {
    what: 'a #if branch holding two attribute lists',
    node: 'preproc_if_in_attribute_list',
    withChild: 'attribute_list',
    source: 'class C {\n#if A\n [System.Obsolete]\n [System.Serializable]\n#endif\n public void M() { } }\n',
  },
  {
    what: 'a return type under a #if after the modifiers',
    node: 'method_declaration',
    withChild: 'preproc_if',
    source: 'class C { private static\n#if A\n int\n#else\n long\n#endif\n M() { return 1; } }\n',
  },
  {
    what: 'a class header under a #if, the body after the #endif',
    node: 'class_declaration',
    withChild: 'declaration_list',
    source: '#if A\npublic class C : System.IDisposable\n#else\npublic class C\n#endif\n{ public void Dispose() { } }\n',
  },
  {
    what: 'a method header under a #if, the body after the #endif',
    node: 'method_declaration',
    withChild: 'block',
    source: 'class C {\n#if A\n public void M(int a)\n#else\n public void M(long a)\n#endif\n { } }\n',
  },
  {
    what: 'the safe modifier on a field',
    node: 'field_declaration',
    withChild: 'modifier',
    source: 'class C { public safe int F; }\n',
  },
  {
    what: 'a null-conditional element assignment',
    node: 'assignment_expression',
    withChild: 'conditional_access_expression',
    source: 'class C { void M(int[] a) { a?[0] = 1; } }\n',
  },
  {
    what: 'a constraint continuation with a leading comma under a #if',
    node: 'type_parameter_constraints_clause',
    withChild: 'preproc_if',
    source: 'class C { void M<T>(T v) where T : notnull\n#if A\n , allows ref struct\n#endif\n { } }\n',
  },
  {
    what: 'a null-conditional call after a binary operator, its receiver a name',
    node: 'conditional_access_expression',
    withChild: 'identifier',
    source: 'class C { bool M(bool a, string b) => a || b?.Contains("z") == true; }\n',
  },
  {
    what: 'a creation whose generic argument is a named tuple type',
    node: 'object_creation_expression',
    withChild: 'argument_list',
    source: 'class C { object M(object src) => new HashSet<(string Name, string? Schema)>(src); }\n',
  },
];

/** What a correct grammar must produce for {@link ASYNC_IDENTIFIER_PROBE}. */
const REQUIRED_MODIFIER_NODE = 'modifier';

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
export function assertPatchedGrammar(
  parser: Parser,
  probe: string = ASYNC_IDENTIFIER_PROBE
): void {
  const tree = parser.parse(probe);
  const root = tree.rootNode;

  if (root.hasError) {
    throw new Error(
      'C# grammar gate FAILED: `if (async)` does not parse. The installed grammar is ' +
        'not the patched fork in vendor/tree-sitter-c-sharp.\n' +
        '  Effect if ignored: 6.44% of declarations lost instead of 0.37%, with no ' +
        'exception, no skipped file and no warning — only a fact base that is quietly ' +
        'short.\n' +
        '  Fix: `npm install` from the repository root, which resolves ' +
        'tree-sitter-c-sharp-fork from file:vendor/tree-sitter-c-sharp.'
    );
  }

  // The other direction: a grammar that made `async` an identifier EVERYWHERE
  // would pass the probe above and silently reclassify every async method.
  if (!subtreeContainsType(root, REQUIRED_MODIFIER_NODE)) {
    throw new Error(
      'C# grammar gate FAILED: `async Task N()` produced no `modifier` node. The ' +
        'grammar parses `async` as an identifier even in modifier position, which ' +
        'would misclassify every async method in the corpus.'
    );
  }

  // The fork's other rules, each asserted by the node it produces. Skipped
  // when the caller passed its own probe: that call is the suite proving this
  // gate can fail, and it hands in a source the fork cannot parse on purpose.
  if (probe !== ASYNC_IDENTIFIER_PROBE) {
    return;
  }
  for (const rule of FORK_RULE_PROBES) {
    const ruleRoot = parser.parse(rule.source).rootNode;
    if (ruleRoot.hasError || !subtreeContainsType(ruleRoot, rule.node, rule.withChild)) {
      throw new Error(
        `C# grammar gate FAILED: ${rule.what} did not parse to a \`${rule.node}\`. The ` +
          'installed grammar is not the fork, or the fork is missing one of its rules.'
      );
    }
  }
}

function subtreeContainsType(node: Parser.SyntaxNode, type: string, withChild?: string): boolean {
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
