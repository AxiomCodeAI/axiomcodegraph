# `tree-sitter-c-sharp-fork` — vendored, pinned, and one patch from upstream

Upstream `tree-sitter-c-sharp@0.23.5`, regenerated at **ABI 14** so it loads on the
`tree-sitter ^0.21.1` this repo already pins, plus **`fork.patch`**: the three-line
`async` change and thirty-nine grammar rules, each for a shape upstream cannot parse and
each a measured loss, plus **`scanner.patch`** against `src/scanner.c` (fork17). The patch is real — `patch -p1 < fork.patch` on upstream's
`grammar.js` reproduces this one byte for byte — and every rule in it is marked
`// FORK:` in `grammar.js` so a release bump can find them.

## Why it is vendored rather than depended on

The published `tree-sitter-c-sharp@0.23.5` ships an ABI-15 `parser.c` and an ESM
binding with top-level `await`, neither of which loads under `tree-sitter ^0.21.1`.
Bumping `tree-sitter` is not local: Java, Python and Groovy all load through it.

Generating the parser at install time would need `tree-sitter-cli` on the machine.
The parser is a Node library that runs on arbitrary customer checkouts, and
§0 of `BUILDING-A-PARSER.md` rules hermeticity a product constraint — *"no network,
no install step and no lockfile resolution … cacheable and diffable"*. So the
generated `src/parser.c` is checked in. It is 65 MB, and that is the price.

## The patch

`async` is a **contextual keyword**. Upstream lists it only in `modifier`, so
every use of it as an identifier is a parse error:

```csharp
if (async) { }          // ERROR upstream, parses here
var x = async;          // ERROR upstream, parses here
F(q, async: true);      // ERROR upstream, parses here
async Task M() { }      // parses in both — the modifier still works
```

`'async'` is added to `_reserved_identifier`, with the two conflict declarations
`tree-sitter generate` then asks for. The conflict loop converges on round 3.

## The thirty-nine rules

Each was found by cs-corpus comparing the parser's rows against Roslyn's on a
stratified corpus, reduced to a fixture, and diagnosed as the GRAMMAR rather than
the extractor — a recovery an extractor cannot read correctly, because the tree
is wrong before the extractor sees it.

| rule | shape | upstream | measured |
|---|---|---|---|
| `_base_list` / `preproc_if_in_base_list`, `preproc_if_in_record_base` | `class C`⏎`#if X`⏎` : I`⏎`#endif` | the class NAME displaced into an ERROR and the directive's symbol taken as the name, for any symbol of two characters or more | a phantom type per occurrence; a two-part partial counted as one (CS-CORPUS-17) |
| `preproc_if_in_function_body` | `M()`⏎`#if X`⏎` => a;`⏎`#else`⏎` => b;`⏎`#endif` | a property with an ERROR child and a method named by the next keyword | a lost declaration per occurrence (CS-CORPUS-15) |
| `preproc_if_in_property_body` | `int X`⏎`#if X`⏎` { get; }`⏎`#else`⏎` => 1;`⏎`#endif` | a property with an ERROR child and the `#else` body as a stray ERROR | the same recovery debris, on a property |
| `_constant_pattern_binary_expression` | `x is null && P(x)` | `x is (null && P(x))` — the pattern swallowed the right operand | 264 calls lost in one stratum; 4 of 4 fixture cases (CS-CORPUS-13) |
| `lvalue_expression` += `invocation_expression`; tuple declarators only after `var` | `Local(x) = v;` | a declaration of type `Local` with a one-element tuple pattern | ~3,400 calls lost in the corpus (CS-CORPUS-7) |
| `slice_pattern` | `[var head, .. var tail]` | a parse error whose recovery could swallow the switch expression | found while measuring the other four: the regenerated grammar made one fixture's recovery worse until the slice rule was added |
| `object_creation_expression` type = `_object_creation_generic_type` / `_object_creation_qualified_generic_type` (fork10: the qualified rule scores three, admits a generic on any segment and recurses, so `new Outer<T>.Nested(1)` beats `(new Outer<T>).Nested(1)` at any depth — CS-CORPUS-27, nine creations emitted as calls) | `new Foo<T>(x) { P = 1 }`, `new A.B<T>(x) { 1 }`, `new Outer<T>.Nested(1)` | read as `new Foo < T > (x){ … }` — two comparisons and a CAST of the initializer, with no error node; `cast_expression`'s dynamic point won the tie | 4 creations in one stratum came out as arithmetic; 3 span mismatches in the fixture (CS-CORPUS-22) |
| `relational_pattern` operand = `_constant_pattern_operand` | `m is < -1 ? a : b` | the relational operand was ANY expression, so the conditional and both arms were swallowed into the pattern | 4 calls in two fixture methods, every conditional guarded this way in the corpus (CS-CORPUS-23) |
| `invocation_expression` function may be `_generic_call_name` / `_generic_call_member` (scored) | `(T)Convert<T>(x)`, `F(Unsafe.BitCast<A, B>(v) & m)` | C# §6.2.5: a `<…>` followed by `(` is a type-argument list. Both readings of `(T)Convert<T>(x)` held one cast, tied, and the comparison won; inside an argument list the comma of `<A, B>` split the arguments | 47 generic calls lost on two strata, every cast-prefixed one and every two-argument one inside an argument list (CS-CORPUS-26) |
| `_pointer_indirection_expression` operand may be a cast | `_reference = ref *(T*)pointer;` | an lvalue only; the statement was an ERROR, and under the primary-receiver rule its recovery swallowed the whole file | 155 → 131 files with a parse error in one stratum (≤30k chars), 226 → 194 over all its files, whole-file errors 50 → 25; the fixture tree's unsafe pointer file parses |
| `_member_access_receiver` — the receiver of `.`, of a call and of `[…]` is a PRIMARY expression | `x is Limit.Max && Q(x)`, `o is Point(var x, var y)`, `case nameof(X.Y):` | `.` bound to an unparenthesised is-expression: `(x is Limit).Max`; a call's function was one: `(o is Point)(var x, var y)`. fork7/8 had out-scored the first with a per-segment dynamic point, which tipped the recursive-pattern / invocation tie and turned `case nameof(X.Y):` into a positional pattern — the fork8 REGRESSION (CS-CORPUS-28, 557 NAMEOF rows) | the hoist found while measuring rule 7; the regression found by regime-diff's fact multiset, invisible to every call count because nameof is not a call |
| `_anonymous_function_modifier` — a lambda's or anonymous method's `static`/`async` prefix, with `async` a declared conflict against `_reserved_identifier` and a dynamic point (fork12) | `async (x) => …`, `async x => …`, `async Task (x) => …`, `async Task<Results<Ok<T>, NotFound>> (x, db) => …` | the async patch made `async` a reserved identifier, and the lambda modifier's static `prec(-1)` then lost to it BEFORE GLR forked: every async lambda read `async` as its return TYPE (2 of 2,668 async lambdas across nine strata carried a modifier), a plain explicit return type after it was an ERROR, and a generic one was read by rule 11 as a generic call whose recovery ran to end of file | eShop `WebHooksApi.cs`: 9 errors → 0, 3,247 error bytes → 0 (CS-CORPUS-29, the ASP.NET minimal-API shape); 2 → 2,666 async lambdas with a `modifier` on 12,054 files, 0 broken; in the extractor, `isAsync` on lambdas 0 → 21 of 1,231 fixture lambdas and 23 `await`s inside them reclassified from NAME_REFERENCE to AWAIT |
| `preproc_chain_expression` / `preproc_operator_expression` — a `#if` between a primary expression and its continuation, the branch holding a receiver-less segment chain (`member_binding_expression`, as `?.` does) or an `operator_tail`; content REQUIRED (fork13) | `builder`⏎`#if X`⏎` .A(o => …)`⏎`#else`⏎` .B().C<T>()`⏎`#endif`⏎` .Build()`, and `cond1`⏎`#if X`⏎` \|\| cond2`⏎`#endif` | the chain was a COHERENT misparse: the receiver an ERROR sibling, the `#if` legal as a receiver through `preproc_if_in_expression`, and its branch `(ERROR) (invocation A(…))` — a call with no receiver, which an extractor taking the branch would file as a bare FUNCTION_CALL. The operator form was an ERROR whose recovery under rule 9 could swallow the next two methods. With a chain branch allowed to be EMPTY, recovery closed the `#if` with a MISSING `#endif` and read both arms of the operator form as operands of one expression — the untaken branch in the tree | 24 chain sites in 14 files and 13 operator sites in 3 strata (CS-CORPUS-30); on 13,216 files 8 fixed, 0 broken, no row lost in any file whose error bytes grew; MauiProgram.cs 569 → 0 bytes, RawSqlQueryTests.cs 560 → 0; the extractor grafts the chain's receiver onto the innermost binding, starts each inner segment's span at the receiver so the containment invariant holds without an exemption, and reads an operator tail as a BINARY carrying its operator |
| `preproc_head_expression` / `operator_head` — rule 14's MIRROR: the branch ENDS with the operator (fork14). Stands as a binary's right operand, as the right of another head, and at four expression-START positions — a declarator's initializer, a return value, an if condition, an assignment's right — never as a free-standing expression | `a \|\|`⏎`#if X`⏎` b \|\|`⏎`#endif`⏎` c`; `return`⏎`#if X`⏎` a &&`⏎` b &&`⏎`#elif Y`⏎` c &&`⏎`#endif`⏎` d;`; consecutive `#if … \|\| #endif` `#if … \|\| #endif` heads | an ERROR at every regime, and one whose recovery the LR table's shape decides — rule 15 moved it from method-local to whole-file in one file. Admitted everywhere it gave recovery a way to start an expression at a statement-level `#if` and swallow the next method; admitted only where the corpus has it, it does not | 13 sites after an operator (all BCL) and 15 at a start position (9 BCL, 6 CommunityToolkit), one of them a 4-branch `#elif` chain and one a run of three consecutive heads; the extractor reads the taken head's `left` and `operator` and the node's `right` as one BINARY |
| `conditional_access_expression` condition = `_member_access_receiver` — `?.` binds to a PRIMARY, as `.` does under rule 9 (fork14) | `a \|\| b?.M()`, `!b?.M()`, `((T)x)?.M()` | upstream took any expression at conditional precedence: `(a \|\| b)?.M()`, `(!b)?.M()`, `((T)x)?.M()` — a receiver that is a binary or a cast | 836 null-conditional nodes in 227 corpus files whose receiver was a binary or a cast |
| `tuple_element` name scores a dynamic point — rule 8's residual (fork14) | `new HashSet<(string Name, string? Schema)>(src)` | `(new HashSet) < (string Name, string? Schema) > (src)`: each NAMED element read as a declaration expression scoring the point, and the tuple's two tied the creation's two | the CS-CORPUS-22 residual, 3 sites; two comparisons and two phantom locals per site |
| `else_fragment` — an ORPHANED else clause is a statement (fork14, rule 16): `else` + one statement, admitted where a statement is, so it stands inside a statement-level `#if` and after its `#endif`; `if_statement`'s prec.right still takes a directly following `else` itself | `if (a) {…}`⏎`#if X`⏎` else if (b) {…}`⏎`#endif`⏎` else {…}`; `if (a) {…}`⏎`#if X`⏎` else {…}`⏎`#endif` | an ERROR whose extent the LR table decided — the tail of the method at fork13, the whole namespace FLATTENED (no `class_declaration` node at all) once the head form moved the table | 49 sites in three strata, 27 in newtonsoft's `DictionaryWrapper.cs` (53 → 0 errors); `IEnumerableConverterFactory.cs` 26 → 0; the extractor reads the fragment's block as an ELSE block and its statements as the walk's total descent already did |
| `parameter_fragment` — a `#if` in a PARAMETER LIST whose branch holds `T a,` runs (fork15, rule 17) | `M(`⏎`#if NET`⏎` ReadOnlySpan<char> s,`⏎`#else`⏎` string s,`⏎`#endif`⏎` out T r)` | the `#if` read as the first parameter's ATTRIBUTE LIST with a MISSING `#endif`, `#else`/`#endif` as ERRORs, and BOTH branches' parameters emitted as siblings — arity 3 for a method declared with 2, and arity is identity | 40 sites in five strata (26 BCL, 7 serilog, 5 newtonsoft); `readParameters` takes the taken branch's fragment |
| `argument_fragment` / `argument_close_fragment` — the same in an ARGUMENT LIST (fork15, rule 18); the close form holds `args )` so that the two sites whose branch closes the call recover LOCALLY rather than taking the file | `F(a,`⏎`#if X`⏎` b,`⏎`#else`⏎` c,`⏎`#endif`⏎` d)` | the `#if` was the second argument through `preproc_if_in_expression`, each branch's comma an ERROR, and `d` — the argument after the `#endif` — an ERROR of its own: the call lost its last argument | `QueryBugsInMemoryTest.cs` 28 → 5 errors, +12 calls, +18 methods; `EnumConverter.cs`, `PipeReadBufferState.cs`, `LevelOverrideMap.cs`, `EventDeferral.cs`, `KeyAnalyzer.cs`, `JsonDocument.PropertyNameSet.cs` to zero; `argumentsOf` takes the taken branch's fragment for the count and the children |
| `preproc_arrow_expression_clause` (aliased `arrow_expression_clause`) — the arrow OUTSIDE the `#if`, `expression ;` inside each branch (fork16, rule 19); on methods, accessors, properties and indexers | `bool IsWindows() =>`⏎`#if TARGET_WINDOWS`⏎` true;`⏎`#else`⏎` false;`⏎`#endif` | the branch's expression through `preproc_if_in_expression` and each `;` an ERROR — rows right, file counted as failing to parse | 43 sites in four strata; and `preproc_if_in_function_body` gains a bare `;` body — `void Write(…)`⏎`#if X`⏎` { … }`⏎`#else`⏎` ;`⏎`#endif` (ILogger.cs, eight sites), bodyKind BLOCK under the one arm and NONE under the other |
| `_variable_declaration_with_tail` / `preproc_variable_declarator` (aliased `variable_declaration` / `variable_declarator`) — the `=` outside, `expression ;` inside (fork16, rule 20); fields and locals, last declarator only; a declared GLR conflict with `variable_declaration` because `T a, b;` and `T a, b =`⏎`#if` share every token to the last declarator | `const int Cap =`⏎`#if DEBUG`⏎` 32;`⏎`#else`⏎` 1024;`⏎`#endif` | the same `;` debris | 29 sites in four strata |
| `preproc_if_in_switch_section` / `preproc_if_in_switch_label` — a `#if` holding switch SECTIONS, or a stacked LABEL whose statements follow the `#endif` (fork16, rule 21); `switch_section` loses its `prec.left` and `[switch_section]` is a declared conflict, so GLR carries "the section ends here" and "the section continues into a statement-level `#if`" until the branch's first token; a branch holding a label alone fits both forms and the label form, at precedence 1, is the reading | `case A: …`⏎`#if X`⏎` case B: …`⏎`#endif`⏎` default: …`; `case A:`⏎`#if X`⏎` case B:`⏎`#endif`⏎` stmts` | NO error: `case B:` inside a statement-level `#if` read as a local declaration of type `case` plus a LABELED statement — a phantom local, a phantom label, no case label — a coherent misparse that every count passed | 51 sites in four strata (newtonsoft 31); JArray.cs was the file that showed it, by going from 0 errors to 4 when rule 20's conflict moved the table; the label form was found when the section form alone took the rest of JsonSerializerInternalReader.cs (447 calls) |
| `base_continuation` — a base-list CONTINUATION under a `#if`, leading comma (fork18, rule 22) | `class C : A, B`⏎`#if X`⏎` , C`⏎`#endif`⏎`{` | `, C` and the directives as ERRORs before the body | 18 sites (serilog 8, eShop's protobuf-generated 6, newtonsoft 4); the heritage extractor reads the taken branch's fragment as further rows |
| `dangling_if` (aliased `if_statement`) — an if whose `else` keyword is the last token of a statement-level `#if` branch, the else body after the `#endif` (fork18, rule 23); a declared conflict with `if_statement` and dynamic precedence -1 | `#if X`⏎` if (c) { … }`⏎` else`⏎`#endif`⏎` { body }` | an ERROR at the `else`, recovery from there | 17 sites, all newtonsoft; the if has no alternative and the block after the `#endif` is a statement of its own — rows right, one block ANONYMOUS rather than ELSE |
| `allows ref struct` constraint, `allows` a reserved identifier (fork18, rule 24) | `where T : allows ref struct` | stopped at `allows`; the rest of the clause an ERROR | 26 files in one stratum; the extractor already read the flag through the ERROR (`hasAllowRefStructConstraint`), now from a constraint node |
| `*` takes a PARENTHESIZED operand (fork20, rule 25) | `*(bytes++) = (byte)x;`, `*(pVal + 1)`, `*(*(void***)pUnk + 0)` | an lvalue or a cast only; the statement an ERROR and, in unsafe files, the whole file with it | five BCL files whole-file ERRORs: UnicodeEncoding 119,274 → 14 bytes, UTF32Encoding, InvariantModeCasing, OrdinalCasing.Icu, Marshal to 0 |
| modifiers may FOLLOW `ref` in a struct header (fork20, rule 26) | `readonly ref partial struct Span2D<T>`, `ref readonly partial struct` | `ref` had to be the last word before `struct`; Span2D{T}.cs (46 KB) one ERROR from its first attribute | Span2D{T}.cs 68,143 → 0, 93 → 172 invocations; ReadOnlySpan2D{T}.cs to 0 |
| `switch_arm_fragment` — rule 18's shape on switch-EXPRESSION arms (fork20, rule 27) | `x switch { A => a,`⏎`#if X`⏎` B => b,`⏎`#endif`⏎` _ => z }` | the `#if` in expression position, each comma an ERROR, the arm after the `#endif` lost | 20 sites, 16 in Enum.cs (190,067 → 6 bytes, 514 → 729 invocations); the expression walk reads the taken branch's arms |
| `preproc_if_in_constraints_clause` — a `where` clause under a `#if` between a signature and its body (fork20, rule 28) | `M<T>(T v)`⏎`#if NET9_0_OR_GREATER`⏎` where T : allows ref struct`⏎`#endif`⏎`{` | an ERROR at the clause; `allows ref struct` is C# 13 and guarded at all 11 BCL sites | the type-parameter extractor reads the taken branch's clauses; every declaration that repeats clauses admits the `#if` |
| `base_fragment` — the TRAILING-comma base-list run (fork20, rule 29), rule 22's other half | `: ISet<T>,`⏎`#if NET`⏎` IReadOnlySet<T>,`⏎`#endif`⏎` IReadOnlyCollection<T>` | `,` and the directives as ERRORs | FrozenSet.cs and the like; the heritage extractor reads both fragment kinds |
| `method`, `param`, `property`, `type`, `typevar` are reserved identifiers (fork21, rule 30), with a declared conflict against `attribute_target_specifier` | `AddKey([property])`, `F([type])`, `arr[type: 1]` | the word read as an attribute list's target; the collection expression an ERROR | 24 files, 19 of them efcore's metadata layer |
| `_modifier` — MODIFIERS under a `#if` wherever a declaration repeats them (fork22, rule 31), a declared conflict with the member-level `#if`; and a `#if` branch of SEVERAL attribute lists | `#if NET`⏎` public`⏎`#else`⏎` internal`⏎`#endif`⏎` sealed class X`; `#if X`⏎` [Obsolete(…)]`⏎` [EditorBrowsable(…)]`⏎`#endif` | the declaration lost, often the file with it (HttpEncoder.cs, NullabilityInfo.cs, PropertyBinder.cs whole-file) | 57 sites, 53 in the BCL; 8 multi-attribute sites; `modifiersOf` reads the taken branch's modifiers for types, methods, fields, properties and accessors |
| `class_header` / `method_header` / `constructor_header` — a declaration HEADER under a `#if`, the body after the `#endif` (fork23, rule 32); attributes may precede the `#if`, a constructor's `: this()` may follow it; `[_method_header]` is a declared conflict | `#if NET`⏎` public sealed partial class X<T> : A, B`⏎`#else`⏎` public sealed partial class X<T> : A`⏎`#endif`⏎`{` | the declaration and usually the file lost | ImmutableHashSet_1.cs, ImmutableSortedSet_1.cs, MessageTemplateProcessor.cs, StatusBarBehavior.shared.cs, PropertyBinder.cs, TestFixtureBase.cs, Lock.cs; `headerOf` reads the taken arm's header, the declaration keeps the body, the span and the identity; no taken arm, no row |
| `safe` modifier (fork23, rule 33) | `public safe byte AsByte;`, `public extern safe String(char[] value);` | the declaration an ERROR | eight BCL files; no corpus file uses `safe` as a name |
| `conditional_access_expression` is an lvalue (fork23, rule 34, C# 14) with a declared conflict against the primary receiver | `item?.Parent = null;`, `arr?[i] = v;`, `timer?.Tick -= h;` | an ERROR, and under the header rule a whole-file one | 12 files, four whole-file (ExpressionTreeFuncletizer.cs 140 KB among them); a parse gap on the Roslyn side too under a C# 13 adjudicator |
| `preproc_if_in_arrow_body` — the WHOLE arrow clause inside the `#if`, the `;` after the `#endif` (fork24, rule 36); rule 19's mirror | `ILogger ForContext<T>()`⏎`#if FEATURE_DEFAULT_INTERFACE`⏎` => ForContext(typeof(T))`⏎`#endif`⏎` ;` | the branch's arrow clause through `preproc_if_in_expression` and the trailing `;` an ERROR | the default-interface-method idiom: a body under the symbol, an ABSTRACT declaration without it, and the `;` outside because both readings share it. 134 of multitarget-A's 153 parse gaps, one file (`ILogger.cs`, 402 error bytes → 0), under BOTH target frameworks — the gap was in the tree whether the branch was taken or not. 12,054 files fork23 → fork24: fixed=1 broken=0, no file worse. The extractor needed NO change: `collectActiveNamedChildren` already resolves a `preproc_if` child transparently, so `bodyKind` is EXPRESSION under the taken branch and NONE under the untaken one |
| `extension_declaration` / `extension_parameter_list` — the C# 14 EXTENSION BLOCK (fork25, rule 37); `extension` a reserved identifier, its conflict against the declaration declared, and the receiver's TYPE alternative scoring a dynamic point because `extension(Vec)` also fits a parameter named `Vec` | `extension<T>(Vector128<T>)`⏎` where T : IFloatingPointConstants<T>`⏎`{ public static Vector128<T> E { [Intrinsic] get => Create(T.E); } }` | upstream read `extension(string source)` as a CONSTRUCTOR of the static class taking one argument — not legal C# — and the members inside it as LOCAL_FUNCTIONs: phantom rows with the wrong kind and the wrong owner, under a parse gap that understated the damage enormously | 7 corpus files, 5 of them whole-file ERRORs of 195-259 KB each. 12,054 files fork24 → fork25: fixed=6 broken=0, no file worse; error bytes 1,223,177 → 15,170. The extractor FLATTENS the block into its enclosing static class — which is what the compiler emits — and the receiver becomes the `this` parameter it lowers to, so a C# 13 and a C# 14 extension are the same shape in the IR and need no schema column |
| `preproc_if_in_initializer` / `initializer_fragment` — a `#if` inside a COLLECTION or OBJECT INITIALIZER, the branch holding `element ,` runs (fork26, rule 38) | `new List<Func<Type,bool>>()`⏎`{`⏎` a,`⏎`#if X`⏎` b,`⏎`#endif`⏎` c,`⏎`}` | the branch's closing token an ERROR, and the elements after the `#endif` with it | rule 18's shape one container over. `initializer_expression` is reshaped like `argument_list` — `repeat(element ',' | #if)` then an optional last element — because the branch carries its OWN trailing comma and a `commaSep` wants one after the `#if` that the source does not have |
| `preproc_if_in_catch_clause` — a `#if` holding CATCH CLAUSES (fork26, rule 39), with `[try_statement]` a declared conflict | `catch (A) { }`⏎`#if X`⏎`catch (B e) { }`⏎`#endif` | the clause was recovery debris | a `catch` is neither a statement nor an expression, so no existing `#if` rule could hold one. After `try { }` a `#if` is either a catch-holding one or a statement-level one after the try has ended; GLR carries both until the branch's first token decides |
| `constraint_continuation` — a where clause's continuation with a leading comma under a `#if` (fork23, rule 35) | `where T : notnull`⏎`#if NET`⏎` , allows ref struct`⏎`#endif` | an ERROR | five BCL files |

Measured on two local strata plus the fixture tree, files under the parse ceiling:

| | files | files with a parse error | ERROR nodes | fixed | broken |
|---|---|---|---|---|---|
| fixture tree + a multi-target library | 782 | 40 → 37 | 280 → 244 | 3 | 0 |
| a large ORM | 5,253 | 36 → 25 | 127 → 106 | 11 | 0 |

"Fixed" is a file that had a parse error and has none; "broken" is the reverse,
and there are none. One file in the ORM still errors and recovers with one more
ERROR node than before — a list pattern followed by `when`, which is a further
upstream gap and not one of these rules.

Measured by `cs-oracle` over 7,705 files of library C#:

| | files with a parse error | truncating | declarations lost vs Roslyn |
|---|---|---|---|
| upstream 0.23.1 | 18.88% | — | — |
| fork, unpatched | 8.62% | 1.27% | 6.44% |
| **fork + async patch** | **3.01%** | **0.32%** | **0.37%** |

**99.63% of declarations recovered — on library code.** The residual 3.01% is
1.60% `#if` splitting a construct (irreducible for any both-branches parser) and
1.41% named grammar residue.

## The scanner patch

`scanner.patch` (fork17) fixes two defects in upstream's external scanner, both in how an
interpolated **verbatim** string ends. A verbatim string ends at ONE quote and `""` inside
it is an escaped quote; the scanner counted quotes as if every interpolated string were
raw:

- the `INTERPOLATION_END_QUOTE` branch consumed every quote it saw, matched none, and fell
  through to `INTERPOLATION_OPEN_BRACE`, which then returned `""{` as one brace token — the
  escaped quote was swallowed and the string's content began inside the interpolation;
- at the close of `$@"""{x}"""` it took all three quotes, matched none, and the content
  branch ran from there to end of file.

`$@"""{x}"""` parses in isolation only because the parse state after `=` does not have
`END_QUOTE` valid; after a GLR fork — `if (v is string)` followed by `{`, which is also a
property pattern's brace — it does, and `ExpressionPrinter.cs` (1,144 lines) was one ERROR
from its class keyword down. The END_QUOTE branch now consumes one quote for a verbatim or
regular string, treats a verbatim `""` as content, and counts only for raw strings; the
OPEN_BRACE branch does not run after quotes were consumed. `@$"""…"""`, the other
prefix order, parses with it.

The patch also adds one external token, `_pragma_end` (fork19): a `#pragma` line's terminator
is a newline **or end of file**, because 36 files ended `#pragma warning restore 618` with no
trailing newline and the grammar's newline token can never match at EOF — the root reported
an error with no ERROR node, no MISSING node and no zero-width node (`SELF_REPORTING_NODE`,
now reserved at zero rows). Only the scanner can see EOF. And `#error` / `#warning` accept
no message.

`patch -p1 < scanner.patch` on upstream's `src/scanner.c` reproduces this one byte for byte.

## An unpatched grammar must fail LOUDLY

A fresh `npm install` that resolved the upstream package instead of this one would
silently drop **6.44%** of declarations rather than 0.37% — the kind of regression
that shows up as slightly smaller row counts and nothing else. So
`CSharpParser`'s constructor parses a fixture containing `if (async) { }` and
throws if it does not parse clean. See `src/parsers/csharp/grammar-gate.ts`.

## Rebuilding

```
tree-sitter generate --abi 14      # tree-sitter-cli@0.25.10
node-gyp rebuild                   # ~8.5 s
```

Review `fork.patch` and `scanner.patch` against upstream on every release bump; the
`// FORK:` markers in `grammar.js` and `src/scanner.c` are the same set. `src/parsers/csharp/grammar-gate.ts`
parses one probe per rule at parser construction and throws if any does not
produce the node the rule exists to produce, so an unpatched or partially
patched grammar fails loudly rather than by a quietly smaller fact base.
