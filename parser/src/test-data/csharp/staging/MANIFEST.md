# C# fixture staging

**Source only. No expected facts.** Nothing in this tree states what the parser
should emit. Node kinds are named below to describe *what the source contains*,
so coverage can be reasoned about; they are not expectations, and the oracle
remains the sole author of what any fixture's facts are.

Two things every fixture declares, because C# needs them and the other three
languages did not:

1. **Its governing project configuration** — `TargetFramework`, `LangVersion`,
   `Nullable`, `ImplicitUsings`, `DefineConstants`. The same bytes produce
   different facts under different values, so a fixture without this cannot be
   adjudicated. Every `.csproj` is shipped, and §0 is the table.
2. **Whether it compiles.** A fixture that does not compile is legitimate — the
   parser must still emit for it — but Roslyn returns `CandidateReason` failures
   for it and `cs-corpus` needs to know those are expected rather than parser
   defects. §0 gives the status and §7 the expected error inventory.

Both are **machine-readable, on every project**, so a gate reads a value and
never an empty string:

| property | values | meaning |
|---|---|---|
| `CsFixtureVerifiable` | `true` \| `false` | can the toolchain in this checkout evaluate this project at all |
| `CsFixtureCompiles` | `true` \| `false` \| `unknown` | is a successful build the expected outcome |
| `CsFixtureParsedByGrammar` | `false` when set | the vendored grammar has no rule for the project's construct; every row from it measures error **recovery**, not parsing. Set on one project (`proj-langversion-14/`); absent everywhere else |

Both are readable with `dotnet msbuild -getProperty:` **without invoking csc**,
which matters because the one `CsFixtureVerifiable=false` project cannot be
compiled at all. The two axes are independent: `proj-extension-hidden` and
`proj-noncompiling` are **verifiable and do not compile**, and that is checkable;
`proj-langversion-13` is **not verifiable**, and nothing about it is.

Bound by `src/schema/csharp/CSHARP-FACT-SCHEMA.md` (v1) and
`SCHEMA-CONSTRAINTS.md`: the parser emits IR, the engine resolves.

---

## The finding worth transferring

> **A corpus grown construct-by-construct varies the construct, not the modifier.**

This corpus was built by walking a list of language constructs and writing a
fixture for each. That produces excellent coverage of *constructs* and a
characteristic blind spot, and running `cs-impl`'s enum audit against it named
the blind spot exactly. Twenty declared enum values were unreached. Not one of
them was an exotic construct:

| unreached | what the corpus actually had |
|---|---|
| `CsFieldModifier.PROTECTED`, `.INTERNAL`, `.REQUIRED`, `.NEW` | **746 fields**, every one of them `private` or `public` |
| `CsTypeModifier.NEW` | `new` on methods, on fields, on events — never on a nested type |
| `CsCommentKind.XML_DOC_BLOCK` | **4,232 comments**, every doc comment `///` and none `/** */` |
| `CsNamespaceStyle.NONE` | a global-namespace type — in a file that also declared block namespaces, so its module read `BLOCK` |
| `CsAttributeTarget.TYPE`, `.EVENT`, `.TYPEVAR` | the three targets whose *default* is already correct, and never the explicit spelling |
| `CsScopedModifier.SCOPED` | `scoped` on a local, where the column is on the parameter |

Every one is **invisible to a coverage count that asks "is this construct
present?"** — because the construct *was* present, in quantity. What was absent
was a second axis nobody was varying: the modifier, the accessibility, the
lexical form, the explicit-versus-default spelling, the declaration site.

Three consequences for anyone building the next one:

1. **Enumerate the enum, not the construct.** The list to work from is the set
   of declared values the parser can emit, not the list of language features.
   Those are different lists and the second one feels complete.
2. **A count of rows is not coverage.** 746 field rows and four unreachable
   field modifiers coexist comfortably.
3. **Measure with the consumer's instrument.** The gap was found by running
   `cs-impl`'s audit — their analyzer, their barrel, their `ENUM_COLUMNS` map
   lifted out of their source rather than re-derived — against this tree. A
   second copy of that map would have drifted toward checking less, which this
   repo has already paid for twice.

### And a second one, smaller and sharper

> **A fixture that lands near a threshold is a fixture whose verdict can flip
> without anyone noticing they flipped it.**

`GapPartial.cs` has to land between 5% and 50% of its file inside an ERROR node.
The arrangements that look natural land at **49.8%** and **50.5%** — on either
side of a threshold, from a one-class edit. The margins of every
threshold-sensitive fixture here are therefore stated in §4b, in characters, so
that "how much editing would silently change what this proves" has an answer.

## When two things that should agree don't, the disagreement is the finding, not an inconvenience

That sentence is the method. Every instrument correction in this tree was one of
two moves: a **contradiction refused** — two readings of one thing disagreed and
the disagreement was chased rather than explained away — or a **re-measurement**
where a re-reading would have done. A reader who takes only the heading has the
method; the table is what it caught.

| # | what was believed | what was measured | move |
|---|---|---|---|
| 1 | C# 13 fixtures could be compile-verified here | SDK 8.0.401 rejects `LangVersion 13` outright (CS1617); the NuGet-pinned oracle accepts it — the adjudicator runs ahead of the toolchain | re-measure |
| 2 | a non-compiling project's error list is its error list | csc's emit path suppresses **every** method-body diagnostic while any declaration diagnostic exists: 3 errors hiding 12 | re-measure |
| 3 | "33 fixture holes — constructs your corpus doesn't reach" | the audit had never parsed this corpus; run against it, **20**, of which 19 closed and 2 listed gaps were not gaps | re-measure |
| 4 | `SyntaxErrors.cs` exercises `ERROR_LOCAL` (this manifest said so) | a missing `)` is recovered by an inserted token: `INSERTED_NODE` | re-measure |
| 5 | implicit usings land in `<AssemblyName>.GlobalUsings.g.cs` (this manifest said so) | the file is named after the **project**, `<MSBuildProjectName>.GlobalUsings.g.cs` | re-measure |
| 6 | `cs-corpus` counted 96 files / 99 scrub hits; the key's names over staging gave 97 / 100 | one file, one hit — **pattern breadth**, traced by listing and reading every non-generated hit. Not reconciled into a false agreement; the invariant both derivations shared was reported instead | contradiction |
| 7 | `CORPUS-MANIFEST.json` was reported scrubbed to 0 | a second pattern set found **one term** surviving, the bare form of a holdout name | contradiction |
| 8 | `git cat-file -e $r:tools/…` reported the committed census script **absent on every ref** | `git show` succeeded on the same path. zsh reads `$r:t` as a history modifier; re-checked with `${r}` before anything was reported | contradiction |
| **9** | this manifest's own edit was **merged to `c-sharp`** — logged as done | it was not. `git checkout c-sharp` had failed (the branch was checked out in another worktree), so `git merge cs-fixtures` ran *on `cs-fixtures`*, merged the branch into itself, and printed `Already up to date` — **a true statement about the wrong branch.** `fatal: … already checked out` sat one line above it and `Already on 'cs-fixtures'` one line below | **claimed before checking** |

The first eight are *checked before believing*. The ninth is the method **not
applied**: the contradiction was in the output, both lines visible, and the row
was written before either was read. One command later the state was checked and
the claim retracted with a `supersedes:` row. The distinction is the order —
check, then claim — and the section is stronger for holding the case where the
order was wrong. It also gives "true of the commit, false of the branch" a
second instance in a second tool, which makes it a class rather than a quirk of
one command.

Two more that were the same family but different lessons, and have their own
sections: **`SELF_REPORTING_NODE`** (thirty-six probes varied everything but the
file's terminator — the construct-versus-modifier blind spot, applied to its
author) and **the 88-character margin** (a note about someone else's fixture,
looked for in my own, and found).

**Two more rules, both from the span-containment discriminator in §4b.**

*A control is one of two kinds, and they are different facts.* A
**non-vacuity control** mutates a correct emission and shows the gate can fire.
An **originating-defect control** is the emission the defect actually produced,
and shows the gate fires *on that*. Check 36's controls are the first kind; on
the second kind — this tree's own `a66c352` emission — it reads zero, because a
wrong parse builds a *different, internally consistent tree* and a coherent tree
satisfies containment whether or not it is the right one. A **third kind**,
named by `cs-corpus`, passes both of those tests and is still broken:
**fired-but-misclassified** — the check saw the rows and named them wrong
(`gate-ifdef` on CS-CORPUS-25). It is the `DECORATOR_CALL` lesson from
`BUILDING-A-PARSER.md` §4 wearing a gate's clothes: a correctly-positioned row
with the wrong kind is invisible to every count-based check, and a gate that
counts firings cannot see that it fired for the wrong reason. Every control
should say which kind it is. For weeks the first kind was read as evidence of
the second, and the third was not a kind at all.

*A discriminator you cannot test against the defect is a discriminator you are
guessing about.* The trigger's precondition — an identifier type argument **and**
a cast-shaped argument list — is not derivable by reasoning about what the wrong
parse "must have done"; two drafts reasoned about it and discriminated nothing.
It was found by running at a pre-fix commit that was still reachable. Keep them
reachable.

*The same axis, seen from the fixture end.* A fixture that is not there is the
mirror of a check that cannot fail: both read as clean because they cannot
return anything else. `cs-corpus` kept **13 operator forms from the BCL stratum
as controls labelled `NOT REPRODUCED`** after three transcriptions of each failed
to reproduce the corpus finding. A label saying "this fixture does not yet
exercise what it was written for" is worth more than a fixture that looks like
it does — the first is a known gap, the second is a check that cannot fail
wearing a fixture's clothes. This tree has the same shape in
`proj-langversion-13/` (`NOT-VERIFIABLE-HERE`), and the earlier "not
synthesizable" claim on `SELF_REPORTING_NODE` was the *wrong* version of it:
a label that closed a gap by asserting it could not be filled.

**And one rule that came out of losing three coordination rows to a whole-file
copy from a worktree that had never seen them:** *cite a digest, not only a
path.* Of four rows destroyed, the one whose claim survived was the one that
carried its payload's sha256 — the receiver had hashed the on-disk copy
independently and the two numbers met without the row. A path says where a
thing was; a digest says what it was.

---

## 0. Governing configuration, and compile status

Sixteen projects. Each is **self-contained** — no `Directory.Build.props`
ancestor — except `proj-props-inheritance/`, which exists precisely to break
that assumption.

| project | TFM | Lang | Nullable | ImplicitUsings | DefineConstants (authored) | compiles |
|---|---|---|---|---|---|---|
| `ported/Ported.csproj` | net8.0 | 12 | disable | disable | — | **yes**, 1 warning |
| `csharp-only/CSharpOnly.csproj` | net8.0 | 12 | enable | disable | — | **yes**, 3 warnings |
| `proj-comments/` | net8.0 | 12 | disable | disable | — | **yes**, 14 warnings *(the fixture)* |
| `proj-define-constants/` | net8.0 | 12 | disable | disable | `HAVE_ASYNC;HAVE_SPANS;FEATURE_DIAGNOSTICS` | **yes** |
| `proj-extension-visible/` | net8.0 | 12 | enable | disable | — | **yes**, 1 warning |
| `proj-extension-hidden/` | net8.0 | 12 | enable | disable | — | **NO — by design** |
| `proj-global-usings/` | net8.0 | 12 | enable | disable | — | **yes**, 1 warning |
| `proj-grammar-gate/` | net8.0 | 12 | disable | disable | — | **yes**, 2 warnings |
| `proj-implicit-usings/` | net8.0 | 12 | enable | **enable** | — | **yes** |
| `proj-langversion-13/` | net8.0 | **13** | enable | disable | — | **NOT VERIFIABLE HERE** |
| `proj-langversion-14/` | **net10.0** | **14** | enable | disable | — | **NOT VERIFIABLE HERE · NOT PARSED** |
| `proj-large-file/` | net8.0 | 12 | enable | disable | — | **yes** |
| `proj-multi-target/` | **net8.0;netstandard2.0** | 12 | disable | disable | `MODERN` \| `LEGACY`, per TFM | **yes**, both TFMs |
| `proj-noncompiling/` | net8.0 | 12 | enable | disable | — | **NO — by design** |
| `proj-nullable-project-disable/` | net8.0 | 12 | **disable** | disable | — | **yes**, 10 warnings *(the fixture)* |
| `proj-nullable-project-enable/` | net8.0 | 12 | **enable** | disable | — | **yes**, 6 warnings *(the fixture)* |
| `proj-partial-88/` | net8.0 | 12 | disable | disable | — | **yes** |
| `proj-partial-generated/` | net8.0 | 12 | enable | disable | — | **yes** |
| `proj-spine-invariants/` | net8.0 | 12 | enable | disable | — | **yes** |
| `proj-props-inheritance/app/` | net8.0 † | 12 † | enable † | **disable** ‡ | `FROM_PROPS;FROM_CSPROJ` ‡ | **yes** |
| `proj-top-level/` | net8.0 | 12 | enable | disable | — | **yes**, `OutputType=Exe` |
| `proj-unsafe/` | net8.0 | 12 | disable | disable | — | **yes**, `AllowUnsafeBlocks=true` |

† from `proj-props-inheritance/Directory.Build.props`, not from the `.csproj`.
‡ the `.csproj` **overrides** `ImplicitUsings` and **appends** to
`DefineConstants`. The effective tuple appears in **neither file alone**.

**Toolchain.** SDK **8.0.401**, `dotnet build` on darwin-arm64. Every "yes" above
is a `Build succeeded` from a clean out-of-tree build, and the sweep **compares
the declared `CsFixtureCompiles` against the measured result and reports a
mismatch**: 19 verifiable projects, 19 agreements, 0 mismatches, 1 skipped by
marker. A sweep that did not compare would pass whatever it was told.

### The `DefineConstants` actually passed to csc

Read from `dotnet build -v:diag`, **not** from
`dotnet msbuild -getProperty:DefineConstants` — which the oracle already flagged
and which this tree re-confirms: the property evaluates to
`FROM_PROPS;TRACE;FROM_CSPROJ;DEBUG;NET;NET8_0;NETCOREAPP` for
`proj-props-inheritance`, with **every `_OR_GREATER` symbol missing**, because
they are added during build.

```
proj-multi-target, net8.0:
  TRACE;MODERN;DEBUG;NET;NET8_0;NETCOREAPP;NET5_0_OR_GREATER;NET6_0_OR_GREATER;
  NET7_0_OR_GREATER;NET8_0_OR_GREATER;NETCOREAPP1_0_OR_GREATER;
  NETCOREAPP1_1_OR_GREATER;NETCOREAPP2_0_OR_GREATER;NETCOREAPP2_1_OR_GREATER;
  NETCOREAPP2_2_OR_GREATER;NETCOREAPP3_0_OR_GREATER;NETCOREAPP3_1_OR_GREATER

proj-multi-target, netstandard2.0:
  TRACE;LEGACY;DEBUG;NETSTANDARD;NETSTANDARD2_0;NETSTANDARD1_0_OR_GREATER;
  NETSTANDARD1_1_OR_GREATER;NETSTANDARD1_2_OR_GREATER;NETSTANDARD1_3_OR_GREATER;
  NETSTANDARD1_4_OR_GREATER;NETSTANDARD1_5_OR_GREATER;NETSTANDARD1_6_OR_GREATER;
  NETSTANDARD2_0_OR_GREATER
```

### Suppressed warnings, and where they are NOT suppressed

`ported/` and `csharp-only/` set `NoWarn` for diagnostics that fire on
deliberately-unused fixture members (`CS0168 CS0169 CS0219 CS0414 CS0649 CS0067
CS0108 CS0693 CS1998 CS0282`) and, in `csharp-only/` only, for the nullable
family (`CS8600 CS8601 CS8602 CS8603 CS8604 CS8618 CS8622 CS8625`).

**The two nullable projects suppress nothing.** Their warnings *are* the
fixture: they are how the oracle can prove which nullable context was in force
at each line.

### LangVersion — ruled: C# 12 is the floor

Everything that must compile is **C# 12 or below**, and the reason is a hazard
worth naming rather than a preference:

> **SDK 8.0.401 rejects `<LangVersion>13</LangVersion>` outright** —
> `CSC : error CS1617: Invalid option '13' for /langversion`. The oracle's pinned
> **NuGet** `Microsoft.CodeAnalysis.CSharp 4.12.0` **accepts it**, and the package
> version is decoupled from the installed SDK.
>
> So the adjudicator can run **ahead of the toolchain**: it can bless facts for a
> program this environment cannot build, and a golden frozen that way becomes
> the spec for code nobody can compile. That is the same failure mode as a
> hand-written expectation, reached from the other direction — and it is harder
> to spot, because everything on the oracle side looks green.

**`proj-langversion-13/` exists under three rules**, all enforced by artefacts
rather than by convention:

1. **Excluded from every compile-status gate**, by reading
   `CsFixtureVerifiable=false` or the `NOT-VERIFIABLE-HERE` marker file in the
   directory — never by name-matching, never by swallowing the failure.
2. **`cs-oracle` may not bless a golden from it.** It may *parse* these files to
   check the grammar handles C# 13 syntax. It may not author facts from them.
3. **Skipping it silently is worse than not having it.** Whatever excludes it
   must say so in its output; the sweep above prints
   `projects skipped by marker: 1`.

Verifying it at all needs a .NET 9 SDK, or any SDK shipping Roslyn 4.12+. That
is an **environmental** fact about the checkout in the sense of
`BUILDING-A-PARSER.md` §7, and must be classified as one.

| held construct | version | fixture |
|---|---|---|
| `ref readonly` **parameters** | 13 | `RefReadonlyParameters.cs` — the whole `parameterMode` vocabulary in one signature; `ref readonly` *locals* and *returns* are C# 7.2 and compile elsewhere |
| **`params` collections** | 13 | `ParamsCollections.cs` — `params ReadOnlySpan<T>`, `Span<T>`, four collection interfaces, a `[CollectionBuilder]` type, and the overload-resolution preference between them |
| **`allows ref struct`** | 13 | `AllowsRefStruct.cs` — the **anti-constraint**: it widens what `T` may be and narrows what the body may do, the opposite direction from every other constraint; plus a `ref struct` implementing an interface |
| **partial properties** and indexers | 13 | `PartialProperties.cs` — the one of the four that changes the fact base's *shape*: a property with a defining and an implementing part, and accessors split with it |

A fifth, `nameof(List<>)` on an unbound generic, is **C# 14** and is recorded as
absent at the point where it would have gone.

---

## HALF ONE — the twelve Java categories

`ported/`, 29 files. Where C# has the construct it is ported; where it does not,
the file says so and **no substitute is invented**. The consolidated
no-analogue record is §5.

### 1 — `attributes` (Java `annotations`)

| fixture | node kinds exercised |
|---|---|
| `AttributeDeclarations.cs` | `ClassDeclaration : Attribute`, `AttributeUsage` with `AttributeTargets`/`AllowMultiple`/`Inherited`, positional members as constructor parameters, named members as properties, every constant-expressible member type (`byte sbyte short ushort int uint long ulong float double char bool string`, enum, `Type`, `object`, arrays), an attribute **derived from another attribute** (impossible in Java), attributes targeting `GenericParameter` / `ReturnValue` / `Parameter` |
| `AttributeUsages.cs` | attribute on type / field / property / method / parameter / event / constructor / type parameter / generic-method type parameter; **explicit target specifiers** `[field:]` `[return:]` `[method:]` (no Java form); array arguments in both spellings; `typeof`, `nameof`, `const` and constant-expression arguments; `AllowMultiple` stacking; inherited attributes; real BCL attributes (`NotNullIfNotNull`, `MaybeNullWhen`, `DoesNotReturn`, `Obsolete`) |

**Correspondence.** The closest port in the whole set: a C# attribute is inert
metadata read by reflection, exactly like a Java annotation. **The declaration
form differs** — Java declares members as abstract methods on an `@interface`;
C# declares them as constructor parameters and properties on an ordinary class
deriving from `Attribute`. So there is **no `TypeCategory` for an attribute**,
and none was invented.

*Found while writing:* `[param:]` is not a valid target on a constructor
declaration (CS0657 — the only valid location there is `method`). Kept as
`[method:]` with the reason in the source.

### 2 — `blocks`

| fixture | node kinds exercised |
|---|---|
| `ControlFlow.cs` | `if`/`else` braced and unbraced, `for` (multi-initialiser, multi-incrementor, empty header), `foreach` incl. **deconstructing**, `while`, `do`, switch **statement** with `goto case`/`goto default`/multi-label sections, pattern switch with `when`, labels and unrestricted `goto`, `break`/`continue`, four-deep nesting, **bare blocks**, and the four C#-only block forms: `lock`, `checked`, `unchecked`, `using` statement / multi-resource `using` / **`using` declaration** |
| `ExceptionHandling.cs` | `try`/`catch`/`finally`, ordered catch clauses, **catch with no type**, **exception filters (`when`)**, `throw;` vs `throw e;` vs wrap-and-rethrow, **`throw` in expression position**, nested try / try-in-catch / try-in-finally, try/finally with no catch, exception class hierarchy with `init` members, `AggregateException` |

**No analogue — checked exceptions.** C# has **no `throws` clause and no checked
exceptions of any kind**. Java's `ThrowsPatterns.java` and the `THROWS_CLAUSE`
type-reference context have **no port and none is invented**. The three real C#
replacements are covered instead: an exception hierarchy, `catch … when` (which
does **not** unwind when the filter is false, so it is not multi-catch), and
advisory `<exception cref="..."/>` XML documentation.

**No analogue — multi-catch `catch (A | B e)`.** The real replacement, one clause
plus a type test in the filter, is shown.

### 3 — `enums`

| fixture | node kinds exercised |
|---|---|
| `EnumForms.cs` | `EnumDeclaration` implicit and explicit values, out-of-order and **duplicate** values, **explicit underlying type** (`byte`, `long`, `sbyte`), members computed from earlier members and from `const`s, **`[Flags]`** with `<<`/`\|`/`&`/`^`/`~`/`HasFlag`, nested enum, attributes on members, switch statement and switch **expression** over an enum, `Enum.IsDefined`/`GetNames`/`Parse`/`TryParse`/`GetValues`, `where T : struct, Enum`, nullable enum |

**No analogue, in both directions.** A Java enum is a class and may declare
constructors, fields, methods, per-constant bodies and `implements`. A C# enum
is a named set of integral constants and can declare **none** of those. The
real C# replacements — a `[Flags]` bit set, a static lookup `Dictionary`, and
extension methods on the enum type — are covered instead, the last in
`csharp-only/extensions/`. In the other direction C# has three enum features
Java lacks, all above.

### 4 — `expressions`

| fixture | node kinds exercised |
|---|---|
| `Literals.cs` | decimal/hex/binary/separated integers; `L U UL f d m` suffixes; **`decimal`** (no Java form); exponents; every char escape incl. `\x` `\u` `\U`; regular, verbatim and multiline-verbatim strings; `true`/`false`/`null`; `default` and `default(T)`; **nullable value types**; array creation in four spellings, rectangular and jagged; `typeof` (open, closed, array, primitive), `nameof`, `sizeof` |
| `Operators.cs` | arithmetic, comparison, logical (eager and short-circuiting), bitwise, `<<` `>>` **`>>>`**, prefix/postfix `++`/`--`, ternary and nested ternary, **`?.` `?[]` `??` `??=`**, `is`/`is not`/`is … and`/`is … or`, `as`, **`^index` and `range..`**, every compound assignment, `checked`/`unchecked` expressions, **two compound assignments on one line** |
| `Assignments.cs` | the §3 defect-class fixture: simple assignment to local/field/property/parameter/array/dictionary/indexer/`this.x`; **two assignments on one line, four times**; chained `a = b = c = 0`; assignment **in expression position** (`if`, `while`, argument, ternary, initialiser); compound assignment on every target kind; `??=` incl. on a dictionary element; **`ref` locals and `ref` reassignment**; deconstructing assignment, swap, nested and discarded; `out` assignment; field/static/readonly initialisers |
| `CallsAndMemberAccess.cs` | unqualified / `this.` / field / property / chain / local / static / namespace-qualified / `global::`-qualified calls; overload selection by arity and type; explicit and inferred type arguments; named and optional arguments in and out of order; `params` in four calling forms; call on a parenthesised expression, a cast, a `new`, and a call's result; **`?.` / `?.[]`**; element access on array / indexer / two-arg indexer / dictionary; nested arguments; calls inside argument / ternary / interpolation / initialiser / double parentheses; `new` with and without arguments, **target-typed `new`**, object / nested-object / collection / dictionary / index initialisers; generic and nested-generic construction; **anonymous types**; `StringBuilder` chain |
| `Casts.cs` | numeric narrowing and widening, `checked`/`unchecked` casts, reference up/down casts, `as`, `is`, boxing and unboxing, nullable lifting, generic and array casts, cast through a type parameter, and casts in every syntactic position |
| `Lambdas.cs` | expression- and block-bodied lambdas at every arity, parenthesised vs bare vs typed parameters, `Action`/`Func`/`Predicate`/`Comparison`/`Converter` targets, **discard parameters**, **explicit return type**, **`static` lambda**, **default parameter value** and **`params`** on a lambda (which need the *natural* delegate type), **attributes on a lambda and its parameter**, `async` lambdas, curried and returned lambdas, capture of local / parameter / `this` / loop variable, lambdas in argument position, `var`-typed lambdas, and **expression trees** (`Expression<Func<…>>`) — the same syntax producing data rather than code |

**No analogue.** Java method references (`String::length`) have no C# spelling;
the real equivalent is a **method group**, which is a C#-only construct and
lives in `csharp-only/delegates/MethodGroups.cs`. Java char/numeric literal
suffixes port; `1.5f` and `999L` are identical. **Java's anonymous class does
not port** — a C# anonymous type declares data only, has no base type and no
interfaces; the real replacements (lambda, local function) are used and labelled.

### 5 — `usings` (Java `imports`)

| fixture | node kinds exercised |
|---|---|
| `UsingStyles.cs` | plain namespace `using`; **`using` inside a namespace body** (scoped to that namespace, no Java form); fully-qualified and partially-qualified names; **`global::`**; a nested namespace; **two namespaces in one file with different using sets** |
| `UsingConsumer.cs` | the cross-file resolution edge: types from `UsingStyles.cs` reached through a `using`, through a nested-namespace `using`, and by qualified name with no using at all; an unused using |

**The port stops here on purpose.** A C# `using` is **not** a Java import: Java
imports a *type* (or a static member, or a package wildcard) and resolves it
against a classpath by fully-qualified name; C# imports a **namespace**, brings
every type in it into scope at once, and **has no single-type import at all**.
The nearest thing is an *alias*, and alias / `using static` / `global using` /
implicit usings are all C#-only and live in half two.

*Found while writing:* `using System;` imports the **types** of `System` and
**not** its nested namespaces, so `IO.TextReader` does not resolve and
`System.IO.TextReader` is required — the same rule as Java's `import java.util.*`
not reaching `java.util.concurrent`. Recorded in the source.

### 6 — `local-variables`

| fixture | node kinds exercised |
|---|---|
| `LocalVariableForms.cs` | declaration with and without initialiser, multiple declarators, **`var`**, **`const` locals**, every initialiser shape, **`ref` and `ref readonly` locals**, **ref reassignment**, **`scoped ref`**, pattern-declared locals (incl. the `is not T x` definite-assignment rule), **`out var`** and `out _`, deconstruction in six spellings, `using` locals, **`stackalloc` into a `Span`** (safe, no `unsafe`), scoping in every loop form / `catch` / switch section / bare block / local function / lambda, shadowing, and locals in a constructor, static constructor, getter, setter, indexer and **operator** |
| `HelperTypes.cs` | the support types, in their own file |
| `CrossFileLocalVariables.cs` | locals typed by declarations in another file reached through a `using` — the IR-completeness case — and by another **assembly** (the BCL) |

**Correspondence.** Java's `final` local is closest to `const` and Java's `var`
to C#'s, but both are false friends: C# `const` is a *compile-time* constant, and
**C# has no `readonly` local at all**, so Java's `final` local has no exact port.
Recorded, not invented.

### 7 — `method-type-parameters`

| fixture | node kinds exercised |
|---|---|
| `GenericMethods.cs` | one/two/three method type parameters; a method type parameter **shadowing** a class one (CS0693, and the case a name-keyed parser gets wrong); a constraint on a **sibling** parameter and on the **class** parameter; every constraint form (`class struct notnull unmanaged new() IComparable<T> Exception struct,Enum Delegate` and combinations); generics on static / virtual / expression-bodied / void / array-returning / collection-returning methods; a **generic local function**; overriding a generic method; **inherited constraints on an interface implementation**; call sites inferred, explicit, and inferred through a lambda's return type |

**No analogue.** A C# **constructor cannot declare type parameters**, so Java's
generic constructors have no port; the static generic factory replacement is in
`methods/ConstructorPatterns.cs`. Java's **use-site wildcards** in a signature
have no C# form either; the stand-ins (a constrained type parameter, a variant
interface) are shown and labelled as *not* wildcards.

### 8 — `methods`

| fixture | node kinds exercised |
|---|---|
| `MethodKinds.cs` | **all six accessibility levels** (Java has four), the no-modifier default (`private` in a class — Java's is package-private, so one absence means two different things), static/instance, `abstract`/`virtual`/`override`/`sealed override`/**`new` (explicit hiding)**, expression-bodied members, every return-type form incl. **tuple**, **`ref`** and **`ref readonly`**, `extern` + `DllImport` (the analogue of Java `native`), a **finaliser**, local functions, and interface members: plain, **default implementation** (ports Java 8 `default`), **`static`** (ports Java 8 static), **`private`** (ports Java 9), and **`static abstract`** (no Java form at any level) |
| `ConstructorPatterns.cs` | parameterless, parameterised, overloaded, **`this()` chaining**, **`base()` chaining**, optional parameters as an overload family, copy constructor, expression-bodied constructor, **static constructor**, private constructor + singleton, factory-only type, a derived type with **no** constructor (C# does not inherit constructors), and an object-initialiser target |
| `Overloads.cs` | by arity; by type at equal arity; **by parameter mode**; generic vs non-generic; differing type-parameter arity; `params` vs exact; optional vs shorter; nullable vs non-nullable; base vs derived; static and instance of the same name; **the base/derived resolution rule that stops at the most derived declaring type**; call sites for every group |
| `ParameterAndReturnForms.cs` | zero/one/many parameters; every parameter type shape; **optional parameters with every kind of default** (no Java form — Java's answer is an overload family); `params` (Java's varargs, different keyword); attributes on parameters and return; **named arguments at the call site** |

**No analogue.** `synchronized`, `native`, `strictfp`, `transient` and `volatile`
**methods** have no C# member form; the nearest real things (`lock` in the body,
`extern` + `DllImport`, `volatile` as a *field* modifier) are covered.

*Found while writing:* `ref` and `out` differ **only** in the modifier, so they
cannot overload each other (CS0663) — a distinct name is the only legal
spelling, and that constraint has no Java analogue at all.

### 9 — `type-parameters`

| fixture | node kinds exercised |
|---|---|
| `GenericTypes.cs` | one/two/three parameters, BCL-style names, every constraint form on a **type**, a constraint on a sibling parameter, **F-bounded / CRTP** builder, **reification** made visible (`typeof(T)`, `new T[]`, `new T()`, `default(T)`, `T?` on a struct), **declaration-site variance** `in`/`out` on interfaces **and delegates**, variance-dependent assignments, generic struct / interface / delegate / nested / nested-in-generic types, **the same name at three arities**, attributes on type parameters, and constructed references in every shape incl. unbound `typeof(Box<>)` |

**The spine difference, stated.** C# generics are **reified**: `List<int>` and
`List<string>` are distinct runtime types. Nothing in the *syntax* shows it,
which is why the fixture makes it visible with constructs Java cannot compile.

**No analogue — use-site wildcards.** `? extends`, `? super` and bare `?` have no
C# form. Variance is declaration-site only. No wildcard is simulated.

### 10 — `type-references`

| fixture | node kinds exercised |
|---|---|
| `HeritageClauses.cs` | **the heritage-ruling fixture** — see below |
| `ArrayAndTupleTypes.cs` | single-dimension, **jagged** and **rectangular** arrays (distinct types, no Java form), mixed `int[][,]` / `int[,][]`, arrays of and in generics, `Span`/`ReadOnlySpan`/`Memory`, every array-creation form; **value tuples**: unnamed, named, partially named, nested, arrays of, generics of, as dictionary value, nullable, **nine elements** (the hidden `TRest`), legacy `Tuple<>`, tuple expressions, deconstruction, equality; nested generics two to four deep |
| `ReferenceContexts.cs` | a type referenced from field / readonly field / static field / const / **volatile field** / property / two indexers / event / eleven parameter positions incl. `out`/`ref`/`in` / six return positions incl. `ref` and an iterator / type-parameter constraint / local declaration / explicit type arguments / cast / `is` / `as` / `typeof` (incl. unbound) / `default` / `sizeof` / `nameof` / `catch` / pattern / attribute argument |

**The heritage ruling, tested from both sides.** Schema §3.3 collapses Java's
`extends`/`implements` split to `BASE_OR_INTERFACE` because C# syntax cannot
distinguish them. `HeritageClauses.cs` provides:

* **Genuinely ambiguous** — `ClassBaseOnly : EntityBase`,
  `ClassInterfaceOnly : IMarker` and `ClassBaseAndInterfaces : EntityBase, IMarker, INamed`
  are byte-indistinguishable at position 0.
* **Decided by the language** — a `struct`, a `record struct`, an `interface`
  and an `enum` can have **no base class**, so every entry in their base list is
  an interface **by rule**, with no resolution at all. Six such declarations.
* **The enum trap** — `enum E : byte` shares the `:` syntax and is an
  **underlying type**, not a heritage entry at all.
* **The implicit base** — every class derives from `object` and every struct
  from `ValueType`, an edge that exists in the semantics and in **no syntax**.

> **Finding for `cs-oracle`, not acted on here.** C# **requires the base class
> first** if one is present. So in a `class` base list, **position 0 is the only
> ambiguous slot and positions 1..n are interfaces by the grammar** —
> `class C : IB, A` does not compile. `heritageKind` could be `INTERFACE_ONLY`
> for every position > 0 in a class or record base list without any resolution.
> The fixture is written so this is measurable either way; the schema decision
> is not mine.

**No analogue.** Java's `sealed … permits` list has no C# form — `sealed`
forbids derivation outright and there is no permits clause. The nearest real
shape, an abstract base whose only constructor is `private protected`, is shown
and labelled. `THROWS_CLAUSE` as a reference context has **no C# position at
all**.

### 11 — `type-registry`

| fixture | node kinds exercised |
|---|---|
| `TypeCategories.cs` | every `typeCategory` value: `CLASS` (plain, abstract, sealed, static, partial), `INTERFACE` (plain, generic, variant), `STRUCT` (plain, `readonly`, **`ref`**, `readonly ref`), `RECORD` (positional, with body, explicit `record class`), `RECORD_STRUCT` (plain, `readonly`), `ENUM`, `DELEGATE` (plain, generic, variant); the same name at three arities; **`file`-local types** (C# 11, and the CS9051 restriction that keeps them out of non-file-local signatures) |
| `TypeModifiersAndPlacement.cs` | top-level accessibility (only `public`/`internal`/`file` are legal) vs nested (all six); every category nested, incl. in a **struct**, an **interface** and a **record**; three-deep nesting; generic-in-generic and non-generic-in-generic; same short name at two nesting levels; the modifier matrix; **anonymous types**; local functions and lambdas as the replacements for what C# cannot declare |

**No analogue — three, all recorded.** C# has **no inner (non-static) classes**:
every nested type is what Java calls a static nested class. C# has **no local
classes**: a class cannot be declared inside a method body at all. And a C#
top-level type with no modifier is `internal` while a nested one is `private` —
**two different defaults from one absence**, where Java has one
(package-private).

### 12 — `integration`

| fixture | node kinds exercised |
|---|---|
| `Contracts.cs` | the interfaces, DTOs, records and exception hierarchy the service layer is written against, in their own file so every reference crosses a module boundary |
| `ServiceLayer.cs` | every ported category combined in the shape real ASP.NET takes: constructor injection with null-check `throw` expressions, generic interfaces with constraints, `async`/`await` with `ConfigureAwait`, LINQ, an **iterator** used as a validator, exception filters, attributes, enums, records, and a composition root |

### 13 — `comments` and XML documentation

`proj-comments/`. **A gap I found auditing my own coverage against the schema's
relation list**: `cs_comment` (15 columns) and the `comment-extractor.ts` row in
`BUILDING-CSHARP.md`'s port table had no fixture anywhere in the first pass.

Its own project because **`GenerateDocumentationFile` is `true` here and false
everywhere else.** With it on the compiler parses the XML inside `///` and
reports when it is wrong — so the malformed doc comments produce diagnostics
instead of passing silently, and **the diagnostics are the fixture**, the same
design as the two nullable projects. `CS1591` is suppressed, because requiring a
doc comment on every member would make the *undocumented* case impossible to
write, and telling documented from undocumented apart is the whole job.

| fixture | node kinds exercised |
|---|---|
| `CommentForms.cs` | the three lexical forms; **delimited comments do not nest**; doc comments on every member kind — type, field, const, property, event, indexer, constructor, method, generic method, enum member, struct, record, delegate, interface — with every standard tag (`summary remarks para list item code example value param typeparam returns exception see seealso paramref c inheritdoc`); a `<param>` tag on a **synthesised** positional-record member, which documents a property with no declaration; an **undocumented** type beside the documented ones; comment placement before / after / **between modifier and type** / between type and name / between name and semicolon; a doc comment **detached by an intervening ordinary comment**; `////` (ordinary) versus `///` (doc) versus `/////`; comments inside a parameter list, between binary operands, inside a collection initialiser, between calls in a chain, in both ternary arms; **four strings that look like comments and are not** (line, block, verbatim, interpolated, raw); a comment containing a URL whose `//` is not nested; comments in a **live** and a **dead** `#if` branch; and comments inside a `#region` |
| `MalformedDocumentation.cs` | **deliberately broken XML**: unclosed element, mismatched tags, unescaped `&` and `<`, a `<param>` for a parameter that does not exist, a parameter with no `<param>` tag when others have one, and two `cref`s that do not resolve beside one that does |

**Correspondence, and where it stops.** Javadoc is HTML with `@tags`; a C# doc
comment is **well-formed XML**, and a `cref` inside it is **resolved by the
compiler** — `<see cref="Foo.Bar"/>` is a real symbol reference that produces
CS1574 when it does not bind. So a C# doc comment is **not inert text**: it can
carry a reference the engine may want, which javadoc's `@link` does too but
which javadoc's prose does not.

---

## HALF TWO — what Java has no equivalent for

`csharp-only/` (37 files) plus the ten configuration projects.

### Properties and indexers

| fixture | node kinds exercised |
|---|---|
| `properties/PropertyForms.cs` | **auto-property** (with the backing field that exists in IL and no syntax), auto with initialiser, get-only auto, **expression-bodied property** vs **expression-bodied accessors** (different shapes), **full accessor bodies** with validation and `throw`, **split accessibility** in four flavours plus a **private getter**, set-only, **`init`** and `init` with a body, **`required`** on both a `set` and an `init` member, static auto / expression-bodied / get-only, attributes on the property **and on each accessor**, accessor bodies containing calls and lambdas, delegate / nullable / tuple / generic property types, **`ref` and `ref readonly` returning properties**; `abstract`/`virtual`/`override`/`sealed override`/`new`; interface properties incl. **default implementation** and **`static abstract`**; and a consumer covering read, write, compound assignment (**getter then setter**), `++`, object-initialiser writes to `init` and `required`, static access, `ref` aliasing and null-conditional reads |
| `properties/Indexers.cs` | the canonical indexer; **overloaded by type and by arity** (four indexers on one type); expression-bodied; with `init`; with `params`; with split accessibility; with a constructed-generic parameter; `[IndexerName]`; indexers on an interface, a struct, a `readonly` struct, a record and an abstract class; an **explicit-interface indexer**; a consumer distinguishing **five different meanings of `[]`** — user indexer, array element, BCL indexer, `^index`, `range` — plus `?[]`; and the `Add`-initialiser vs index-initialiser split |

**Why both rows.** Schema §2.4: a property is not a field (it has up to two call
targets) and not a method (it is a data location). Each accessor is emitted
*also* as a `cs_method` owned by the property, so the engine gets both.

### Events, and the `+=` that is not an assignment

| fixture | node kinds exercised |
|---|---|
| `events/EventForms.cs` | **field-like events** (backing delegate + `add` + `remove`, none of which appear in syntax), generic and custom-delegate events, `Action`-typed, **three events in one declaration**, initialised with `delegate { }` and with a lambda, static, all five accessibilities, attributed, **explicit `add`/`remove` accessors** with a dictionary backing store, expression-bodied accessors, raising via `?.Invoke` and via a snapshot local, `abstract`/`virtual`/`override`/`new`, **explicit-interface event**, **`static abstract` event**, the `INotifyPropertyChanged` shape, and subscription by method group / lambda / anonymous method / explicit `new EventHandler(...)` / through a chain |
| `events/PlusEqualsAmbiguity.cs` | **the falsifier** — see below |

> **`PlusEqualsAmbiguity.cs` exists so that the `+=` decision cannot be got right
> by accident.** Four traps, in order of how easily a pattern-matching parser
> falls into them:
>
> 1. an **`event`** and a **delegate-typed field of the identical type** on one
>    class, plus a delegate-typed **property**, all written `x += Handler`;
> 2. the **same member name** (`Notify`), one an event and one a field, on two
>    different types, subscribed in adjacent statements;
> 3. **both on one line**, four times, in both orders — so a parser keyed on
>    `(scope, line)` must still produce one subscription and one compound
>    assignment, in the right order;
> 4. the **ordinary meaning** of `+=` in the same file on an `int`, a `string`,
>    a property, an array element, a dictionary value and a delegate **local**.
>
> Nothing here can be decided from the operator. It has to come from what the
> left-hand side declares.

### Delegates and method groups

| fixture | node kinds exercised |
|---|---|
| `delegates/DelegateForms.cs` | delegate declarations: void, returning, generic, **variant (`in`/`out`)**, with `out`, with `ref`, with a default, with `params`, `ref`-returning, `Task`-returning, nested in a class; `Func`/`Action`/`Predicate`/`Comparison`/`Converter`/`EventHandler` fields at five arities; construction from an instance group, a static group, a lambda and an anonymous method; **`Invoke` vs bare call**; `?.Invoke`; **multicast** `+`/`-`/`+=`/`-=`, `Delegate.Combine`/`Remove`, `GetInvocationList`; **anonymous methods** in all three sub-forms including the **parameterless form that matches any signature** (which has no lambda equivalent); `ref`/`out` delegates; variance assignments; a dispatch dictionary of delegates |
| `delegates/MethodGroups.cs` | **method group conversion — a reference to a method with no call syntax at all** — in every position: field initialiser, static field, property initialiser, expression-bodied property, local assignment, argument (`Select`/`Where`/`Sort`/`ForEach`/`ConvertAll`), return, collection element, dictionary value, **conditional arm**, explicit `new D(M)` and **event subscription**; a **static** group unqualified and type-qualified; a group reached through a chain; an **overloaded** group where the *target type* picks the overload (three targets, one spelling); a **generic** group inferred and explicit; a group with `out` in its signature; an async group; and the C# 11 **caching** of static group conversions, which nothing in the syntax says |

**No constructor method group.** C# has no `Foo::new`; Java's does not port. The
replacements (a lambda, a `new()` constraint) are shown.

### Extension methods — the pair that proves the edge is reconstructable

| fixture | compiles | node kinds exercised |
|---|---|---|
| `proj-extension-visible/Extensions.cs` | yes | `this`-parameter marker on `string`, on a **generic** parameter, on an **interface**, on a **value type**, on a **nullable value type**; a generic extension with its own type parameter |
| `proj-extension-visible/Consumer.cs` | yes | the same calls in **extension syntax**, chained, as an argument, in an interpolation, in a lambda, on a null-conditional receiver, on a literal and on a `new`; **the same targets in static syntax**; and **fully qualified** |
| `proj-extension-hidden/Extensions.cs` | — | **byte-identical** to the file above |
| `proj-extension-hidden/Consumer.cs` | **NO** | **identical except one line**: `using Acme.Text;` is absent |
| `csharp-only/extensions/SameNamespaceExtensions.cs` | yes | the **third** visibility route: same namespace, **no `using` anywhere**, and the call still binds — extensions on an interface, a sealed record, `object`, a nullable reference, a type parameter, an array, a tuple, an enum, plus **`ref this`** and **`in this`** on structs, and an extension whose name **collides with an instance member** (the instance member always wins) |

> **The measured difference.** The visible twin builds clean. The hidden twin
> fails with **14 × CS1061** (extension not visible) and **3 × CS0103** (the type
> name is out of scope too) — and the *fully-qualified* call still succeeds.
> Two different error codes for two different failures is exactly what lets the
> oracle tell "not visible as an extension" from "name not in scope".
>
> **What the pair asserts of the parser:** the two fact bases must differ in
> **one `cs_using` row and nothing else**. Same receivers, same member names,
> same argument lists. If they differ anywhere else, the parser is resolving
> when it should be recording.

### LINQ — query syntax and its method chain, side by side

| fixture | node kinds exercised |
|---|---|
| `linq/LinqModel.cs` | the shared data model, so neither half also declares its types |
| `linq/QuerySyntax.cs` | `from` · `from`-`from` · `let` · `where` · `join` · `join … into` · `orderby` (ascending, descending, two keys) · `select` · `group … by` · `group … by … into` · `select … into`; a query as an expression; a query over a query; a query inside a lambda inside a query; a query over `IQueryable` (same syntax, expression trees, different execution); an **explicitly-typed range variable**; a range variable **shadowing** an outer local |
| `linq/MethodChain.cs` | the same twenty-two method names as `Where`/`Select`/`SelectMany`/`OrderBy`/`ThenByDescending`/`Join`/`GroupJoin`/`GroupBy`/`Cast` chains, plus fifteen operators with **no query-syntax spelling at all** and twenty-two terminal operators |

> **Verified, not asserted.** A scratch harness invoked every same-named pair by
> reflection and compared rendered results: **22 compared, 0 mismatched.** The
> two argument-taking twins were driven with fixed inputs. The claim "computing
> the same thing" is a measurement.

**What the pair is for.** Schema §2.5 ruled that query clauses get a **wrapper
node** with the clause kind in a column and that `Where()`/`Select()` calls are
**never synthesised**. `QuerySyntax.cs` contains code whose semantics are two to
five call edges and which has **no call syntax anywhere**; `MethodChain.cs`
contains those calls written out. Reconciling them is the corpus agent's job.
What the pair proves is that both halves are emittable and that the schema's
choice is testable.

Note the second-order point recorded in `MethodChain.cs`: **every call in it is
an extension method**, visible only because of `using System.Linq;`. Delete that
line and neither half resolves.

### The four `using` forms

| fixture | node kinds exercised |
|---|---|
| `misc/UsingFourForms.cs` | **alias** for a namespace, for a type, for a **constructed generic** (which cannot be written any other way), for a nested constructed generic, and one **shadowing** a same-named type; **`using static`** on `System.Math`, `System.Console` and two user types, putting **methods, fields, properties, nested types and enum members** in scope unqualified; the same calls written qualified for comparison; aliases in every reference position; `global::` |
| `proj-global-usings/` | `global using` **namespace**, **static** and **alias** in one file; a second file with more; **two consumer files with no `using` directive at all** that resolve `List<T>`, `Console`, LINQ extensions and two global aliases; and a non-global `using` in the same file as the global block, to pin the scoping difference |
| `proj-implicit-usings/` | **the import edge with no syntax anywhere.** Two files, **zero** `using` directives, resolving `List<T>`, `DateTime`, `Guid`, `Task`, `CancellationToken`, `StreamReader`, `File`, `Path`, `HttpClient`, `SemaphoreSlim` and every LINQ extension |

> **Verified.** The SDK injects exactly seven directives for a net8.0 library,
> into `obj/ImplicitUsings.GlobalUsings.g.cs` — named after the **project file**,
> not the assembly. Contents recorded in the `.csproj` comment. The list is a
> function of the SDK *and* the TFM: net8.0 Web adds six more, netstandard2.0
> gets none. So the row set is a property of the governing configuration, not of
> the source.

*Found while writing:* a `using` alias named `Collections` **does not work**
inside `namespace Fixtures.CSharpOnly.Misc` when a sibling namespace
`Fixtures.CSharpOnly.Collections` exists — enclosing-namespace members are
searched **before** alias directives, so it is CS0234 and `global::` is the only
escape. Kept in the source. Likewise a private `Abs(int)` member **hides** an
imported `Math.Abs` entirely, so the unqualified `double` call fails rather than
falling back.

`extern alias` is **recorded as absent**: it needs `<Aliases>` metadata on an
assembly reference, and there is no such reference here. Not simulated.

### Partial types and partial methods

| fixture | parts | node kinds exercised |
|---|---|---|
| `partial/TwoParts.{Core,Audit}.cs` | **2**, two files | one part names the **base class** and one interface, the other **adds a second interface** — the merged type implements three things and **no single file says so**; attributes on both parts; members in each part calling the other's |
| `partial/ThreeParts.{A,B,C}.cs` | **3**, three files | a **generic** partial: identical type-parameter lists, constraints stated in part 1, omitted in part 2, **restated verbatim** in part 3; part 2 adds an interface; part 3 declares a **nested partial type** with two parts of its own |
| `partial/PartialMethods.cs` | 2 | **both dialects**: C# 2 partial methods (implicitly private, void, and **erased together with their call sites** if unimplemented — including one where the *argument expression* is erased too) and C# 9 extended partial methods (accessibility, non-void return, `out`, implementation mandatory) |
| `partial/PartialAcrossKinds.cs` | many | partial `struct`, `record`, `record struct`, `interface`; **the same name at three arities** (six declarations, three groups); the same name in **two namespaces** (no merge); a partial nested in a **non-partial** host; **two parts in one file**; and a **block namespace**, because CS8955 forbids mixing it with the file-scoped form |
| `proj-partial-generated/GeneratedHalves.cs` | **1 in source** | **the 76.5% case, with real generators** |
| `proj-partial-88/parts/` | **89** | one identity, `CompiledModel`, across 89 files |
| `proj-partial-88/parts72/` | **72** | a second identity in the same compilation |
| `proj-partial-88/SmallGroups.cs` | 1, 2, 3, 5, 8, 12 | the rest of the measured distribution |

> **`proj-partial-generated` uses three generators that ship in the SDK** — no
> `PackageReference`, so the project stays hermetic — and the other halves really
> are produced at build time. Measured with `EmitCompilerGeneratedFiles=true`:
>
> | type | parts in source | parts generated | `DeclaringSyntaxReferences` |
> |---|---|---|---|
> | `SerializerContext` (`[JsonSerializable]`) | 1 | **7** | 8 |
> | `Patterns` (`[GeneratedRegex]`) | 1 | **3** | 4 |
> | `NativeMethods` (`[LibraryImport]`) | 1 | **2** | 3 |
>
> This is the case where Roslyn's `DeclaringSyntaxReferences` **exceeds anything
> the parser can ever see**, so the oracle's set-equality check must exclude
> generated parts or it reports a defect that is not one. `LonePartial` in the
> same file is a single-part partial with **no** generator and is
> **indistinguishable in syntax** from the three above.
>
> `proj-partial-88` is sized at **89** rather than 88 on purpose: one more than
> the corpus maximum, so an off-by-one in the grouping shows up as a wrong number
> rather than as a coincidence. Two large groups in one compilation, because
> getting one right by accident is easy and getting both right is not.

**Absent by rule, recorded:** partial `enum` and partial `delegate` do not exist;
a partial class never merges with a partial struct or interface; **partial
properties are C# 13** and this project is LangVersion 12.

### Nullable reference types

| fixture | node kinds exercised |
|---|---|
| `proj-nullable-project-enable/Inherits.cs` | inherits `enable`: non-nullable and `string?` members, `int?`, `string?[]`, `string[]?`, `List<string?>?`, and `?.` `??` `??=` **`!`** in one method; `where T : class?`, `where T : notnull`, `T?` on a struct constraint |
| `proj-nullable-project-disable/Inherits.cs` | **byte-identical apart from the namespace and three comment lines**, inheriting `disable`. Same bytes, different facts |
| `proj-nullable-project-enable/Overrides.cs` | a whole file turned **off** with `#nullable disable`, where `string?` is now a CS8632 warning |
| `proj-nullable-project-enable/Mixed.cs` | **the context changes seven times mid-file**: `disable` → `enable` → `restore` → `disable annotations` → `enable annotations` → `disable warnings` → `restore`, each with a class whose diagnostics prove which regime was in force |
| `proj-nullable-project-disable/EnablesItself.cs` | the mirror: a file that turns it **on** where the project turned it off, then `restore`s back to disabled — **both regimes in one file** |

> **The diagnostics are the fixture and are not suppressed.** The enable project
> emits 6 warnings, the disable project 10, and their positions are what prove
> the region boundaries. In particular `#nullable disable warnings` produced
> **no** CS8602 on a deliberately unsafe dereference, and `#nullable disable
> annotations` produced CS8632 on a `string?` — so "is nullable on here?" is a
> **two-bit** answer, not a boolean.

### Structs and records

| fixture | node kinds exercised |
|---|---|
| `structs-records/StructForms.cs` | plain struct, **explicit parameterless constructor** (which `default` does **not** call), `readonly struct`, **per-member `readonly`**, **`ref struct`** and `readonly ref struct`, generic struct with operators, `[StructLayout(Explicit)]` union, strongly-typed id; and **value semantics demonstrated**: copy on assignment, copy on argument vs `ref`, **mutation through a property silently lost**, mutation through a `readonly` field lost, mutation through a field kept, boxing, `default` vs `new`, `List<T>` indexer returning a copy vs `Span<T>` aliasing |
| `structs-records/RecordForms.cs` | **positional** record (nine synthesised members from one line), positional with a body, a declared member **suppressing** a synthesised one, the **`PrintMembers`** hook, an extra constructor chaining to the primary, a redeclared positional property, **nominal** record with `required`/`init`, `record struct`, `readonly record struct`, explicit `record class`, **record inheritance** with the `EqualityContract` that appears in no source, generic record with a constraint, **`[property:]` / `[param:]` / `[field:]` attribute targets on positional parameters** (two of the three land on members that do not exist in source), nested records; and **`with`** — basic, several members, empty, on a record struct, on a readonly record struct, **polymorphic through `<Clone>$`**, chained, nested, and **on an anonymous type**; plus Deconstruct, positional patterns and synthesised value equality across an inheritance chain |

### Parameter modes

| fixture | node kinds exercised |
|---|---|
| `parameters/ParameterModes.cs` | `VALUE` (and the reference-copied-vs-object-mutated distinction), `REF`, `OUT`, `IN`, `PARAMS`, `THIS` (plus **`ref this`** and **`in this`**); all of them in **one signature** in the legal order; modes on a **delegate**, a **lambda**, a **local function** and a **constructor**; call sites with the modifier required (`ref`, `out`), optional (`in`) and forbidden (`params`); `out` declared inline, as `out var`, as `out _`, pre-declared, **in an argument of another call** and **in a condition**; and **`ref` / `ref readonly` returns and locals**, including the copy that silently loses the alias |
| `parameters/TryParseShape.cs` | **the `out` parameter as the actual result**: `int.TryParse`, `double.TryParse` with culture, `DateTime`, `Guid`, `Enum.TryParse<T>`, `IDictionary.TryGetValue`; a **user-defined** `TryParseConfig` with **`[NotNullWhen(true)]` / `[NotNullWhen(false)]`** — the only thing linking the two channels, and it is metadata, not syntax; a `Try*` with both an `out` and a nullable return; the **nullable-return alternative** for contrast; and eleven call-site shapes including guard clause, `&&`-chaining where definite assignment depends on the first call, `while` condition, ternary, argument and lambda |

**`ref readonly` parameters are C# 13 and absent.** Recorded at the point of
absence, not simulated.

### Explicit interface implementation

| fixture | node kinds exercised |
|---|---|
| `explicit-interface/ExplicitImplementation.cs` | **two interfaces declaring the same member name** and a type implementing both — two `Read()` methods, two `Position` properties, two `Advanced` events and two `this[int]` indexers, **none of them reachable through the type**, beside a *third* public `Read()`; explicit **method, property, event and indexer**; the BCL mixed shape (generic `GetEnumerator` public, non-generic explicit — an overload pair C# forbids for ordinary members); **the same generic interface at two type arguments** (legal in C#, illegal in Java); explicit implementation in a **struct** (calling it **boxes**), in a **record**, and in an **abstract class** forwarding to an abstract member; and call sites through an interface-typed local, an inline cast, and a **generic constraint** (which does *not* box) |

### Operators and conversions

| fixture | node kinds exercised |
|---|---|
| `operators/OperatorOverloads.cs` | unary `+ - ~ ++ --`, the mandatory **`true`/`false` pair** that makes a user type usable in `if`/`&&`/`\|\|`, binary `+ - * / %` with **three overloads of `+` differing by operand side**, the `==`/`!=` pair, the `<`/`>` and `<=`/`>=` pairs, `& \| ^ << >> >>>`; **`checked` operators** (C# 11) for `+`, unary `-`, `++` and an explicit conversion — a second body chosen by a context the expression does not carry; **`static abstract` operators in an interface** (generic math) and a `static virtual` default; a generic method whose `+` resolves **through a constraint**; and call sites for every one, including `if (a)`, `a && b`, prefix/postfix from one declaration, and the checked/unchecked selection demonstrated four ways |
| `operators/ConversionOperators.cs` | **the cast that invokes user code**: `implicit` from and to a primitive, `explicit` to a primitive, `explicit` between two user types **declared on the source type** and **declared on the target type** (identical syntax, and the call site cannot tell), `explicit checked`, conversions on a reference type, on a strongly-typed id, and on a **generic** type; and the positions where an implicit conversion runs with **no cast syntax at all** — assignment, argument, return, collection/dictionary/array initialiser, `params`, binary operand, comparison, ternary unification, interpolation, **`foreach` element type**, and a LINQ projection |

> This is the C# instance of the `DECORATOR_CALL` lesson in
> `BUILDING-A-PARSER.md` §4: a conversion emitted as a *type reference* is
> complete, correctly positioned and **wrong**, and invisible to every
> count-based check.

### async, iterators, local functions, patterns, tuples

| fixture | node kinds exercised |
|---|---|
| `async-iterators/AsyncForms.cs` | every legal async return type incl. `async void` and an `async` method with **no** await; `await` in fourteen expression positions; `await` in try / catch / finally / `foreach` / `for` / `while` / `do` / `using` / **`await using`** (statement and declaration) / switch arm; **`await` is illegal in an exception filter (CS7094)** — recorded, with the blocking workaround real code uses; `Task.WhenAll`/`WhenAny`/`Run`; a task **started and not awaited**; **`IAsyncEnumerable`** with `[EnumeratorCancellation]`, with try/finally, and yielding tuples; **`await foreach`** plain, with `ConfigureAwait`, with `WithCancellation`, and with a deconstructing element; a **custom awaitable** (GetAwaiter/IsCompleted/OnCompleted/GetResult, none named at the await site) and an awaitable made so by an **extension method** |
| `async-iterators/Iterators.cs` | all four iterator return types; `yield break`; yields on many paths and in every loop form and a switch; **`yield` inside try/finally** (and a catch that contains none, because that is illegal); **the two-method split** that makes eager validation possible; generic iterators; an iterator **local function**; an iterator **property** and an iterator **indexer**; nested iterators; a **duck-typed** foreach target (GetEnumerator pattern, no interface); and a foreach enabled by an **extension GetEnumerator** |
| `functions/LocalFunctions.cs` | declared **after** its call site; expression- and block-bodied; void, generic, constrained; optional / `params` / `ref` / `out` / `in` parameters; **attributed**; **`static`** (no capture, no display class) vs capturing a parameter, a local and `this`; nested local functions; **recursion and mutual recursion**; an **iterator** local function and an **async** one, both in the two-method-split shape; local functions in a property accessor, a constructor, an **operator** and a lambda body; and a **local function beside a lambda with the same body**, for contrast |
| `patterns/PatternForms.cs` | **every pattern form**: constant (literal, `const`, qualified member — the shape Python flattened), null and `not null`, type (bound and unbound), declaration, `var`, discard, relational on five types, logical `and`/`or`/`not` with precedence, **property** (nested, extended `A.B.C:` form, with type, with designation), **positional** (on records, on a class with a hand-written `Deconstruct`, on tuples, nested two deep), **list and slice** (on arrays, on `string`, on `ReadOnlySpan<char>`, with nested patterns and designations), parenthesised; all of them in `is` position, in a switch **expression** and in a switch **statement**; exhaustiveness over a closed hierarchy; and switch expressions nested in arms, arguments, receivers and interpolation holes |
| `tuples/TuplesAndDeconstruction.cs` | the **three different constructs** that share `(a, b)` syntax; tuple types in nine reference positions incl. **nine elements** (the hidden `TRest`, where `Item9` does not exist and `Rest.Item2` does); literals with explicit, **inferred** and mixed names; **tuple equality** (elementwise, name-blind, with conversions); element access by name and by `ItemN` on the same value; deconstruction in eleven spellings incl. discards, nesting, existing variables, an **overloaded `Deconstruct`** selected by arity, and an **extension `Deconstruct`** on a BCL type; tuples as return values, from `async`, from an iterator; and the tuple-returning alternative to `TryParse` beside it |

### The rest

| fixture | node kinds exercised |
|---|---|
| `misc/PrimaryConstructors.cs` | **class** primary constructors, whose parameters are **captured variables and not members** — captured in a field initialiser, a method, a property, an expression-bodied member and a lambda; the mandatory `this(...)` chain from a secondary constructor; the DI shape; a **base call in the heritage clause**; base call plus an interface in one list; a parameter **shadowed** by a same-named field; attributes, defaults and `params` on primary parameters; generic with a constraint; **struct** and **readonly struct** primary constructors; a **zero-parameter** primary constructor; and a **record** primary constructor in the same file for contrast, where the parameters *do* become members and `with` and `Deconstruct` work |
| `misc/DynamicAndNameOf.cs` | **`dynamic`** in every declaration position; **calls, property reads and writes, indexers, operators, chains, casts and `foreach` that resolve to nothing at compile time** — the fixture the schema's reserved zero-row `DYNAMIC_CALL` is asserted against; a call with a **known receiver and a dynamic argument**, where the overload set is known and the choice is not; `ExpandoObject` and a `DynamicObject` subclass; and **`nameof`** over fifteen kinds of referent, in `const`, `case` and attribute-argument positions, plus `CallerArgumentExpression` — an argument supplied by the compiler from another argument's source text |
| `strings/StringLiterals.cs` | ordinary, verbatim and multiline-verbatim literals; **interpolated** strings with seventeen kinds of hole (call, chain, element, ternary, cast, `new`, lambda, LINQ, **query**, switch expression, `nameof`, `typeof`, …), **nested three deep**, alignment and format specifiers, the **colon trap**, escaped braces, `$@` and `@$`; `FormattableString` — the same syntax producing a different **type**, chosen by the target; **raw string literals** single-line, with four quotes, multiline with indentation stripping, JSON; **raw interpolated** with `$`, `$$` and `$$$`, where the number of dollars changes what a brace means; **UTF-8 literals** (`"x"u8`), whose type is not `string`; compile-time folding vs not; and an **interpolated string handler** target |
| `collections/CollectionExpressions.cs` | `[…]` converted to **eleven different target types**, empty / single / trailing comma / jagged / nested; **spread** `..` including of a query and of nested rows; **range** `..` and `^` in the same file, because they share the token; **the four shapes the grammar conflates, adjacently** — collection expression, `a?[0]`, a two-argument indexer call, and an ordinary element access; a collection expression **as a bare argument** (the case the parse-layer measurement flagged as still broken on the unpatched fork); in a ternary, initialiser, return, lambda and switch arm; a `[CollectionBuilder]` type whose factory is named nowhere at the expression site; and **every old spelling** of the same collections beside it |
| `namespaces/NamespaceForms.cs` | **file-scoped** namespace (the 81% case), with nested *types* since namespaces cannot nest under it |
| `namespaces/BlockNamespaces.cs` | **block** namespaces, **nested** namespaces three deep, a **dotted** namespace declared inside another, a **namespace-scoped `using`** proven not to reach a sibling namespace, two top-level namespaces in one file, and a type in the **global** namespace |
| `namespaces/MultipleNamespaces.cs` | **four namespaces in one file**, the same short type name in three of them, a namespace **re-opened** later in the same file, and a namespace member named `System` that **shadows the BCL**, escapable only with `global::` |
| `proj-top-level/Program.cs` | **top-level statements**: a file with no type and no method, whose statements belong to a synthesised `Main`; **`args`, a parameter declared nowhere**; file-scope locals, a **local function**, a lambda, control flow, try/catch, **`await`** (which changes the synthesised signature), and `return` as the exit code; then **type declarations after the last statement**, including a namespace — one file, two owners |
| `proj-unsafe/Pointers.cs` | `unsafe` type / method / block; **fixed-size buffers**; pointer fields, `void*`, `int**`; `fixed`; pointer arithmetic, `*`, `&`, `->`, pointer casts, `sizeof` of a user struct; **`stackalloc` into a pointer** (beside the safe `Span` form elsewhere); **function pointers** `delegate*<…>` managed and `unmanaged`, in a field, as an argument, and with `[UnmanagedCallersOnly]`; `DllImport` with pointers; `nint`/`nuint`; and pointer types in every reference position |
| `proj-define-constants/Guarded.cs` | **`#if` guarding declarations**, classified in comments with the schema's own `regionShape` vocabulary so the classifier can be checked against a known answer: `TYPE_LEVEL` (defined and undefined), `DECLARATION` (with and without `#else`), **`FRAGMENT`** (an attribute, a parameter and half an expression — regions that are not independently parseable), `STATEMENT`, `EMPTY`, `ENUM_MEMBERS` (where a member's numeric value shifts between configurations); a **conditional `using`**; and a **conditional partial part**, so the size of a partial group is a function of the governing configuration |
| `proj-multi-target/Api.cs` | **one file, two public APIs.** `#if` guarding a whole **type**, a **base list** (FRAGMENT), **method overloads**, a **field + property pair of different types**, a **return type** (FRAGMENT), statements, **enum members**, an **interface member incl. a default implementation legal on one TFM only**; nested `#if`, `#elif`, `#else`, negation; a condition defined in **neither** configuration (a declaration that exists in no compilation and that tree-sitter still parses); a condition true in **both**; `#region`, `#pragma`, and an `#error` inside a dead branch |

---

## 4b. Parser-level fixtures — the ones that exist so a GATE can fail

These are not language coverage. Each exists to make a check in `cs-impl`
capable of returning a non-null result, per `BUILDING-A-PARSER.md` §11: *before
trusting a null result, make the check produce a non-null one on purpose.*

### The 32,767-character limit — `proj-large-file/`

tree-sitter's default parse path **throws** above the limit. It does not
truncate and it does not warn, so a parser without the callback-based read
ported from `src/parsers/java/java-parser.ts` emits **nothing at all** for such
a file. `cs-oracle` measured 656 of 7,705 corpus files (**8.51%**) over it.

**The limit is exactly 32,767, and that is now measured rather than inferred.**
`cs-oracle` bracketed it — largest direct parse 32,712, first failure 32,783 —
which is consistent with 32,767 and does not establish it. A binary search
against the patched grammar closes the bracket: **32,767 parses, 32,768
throws.**

**It counts CHARACTERS, not bytes, and that is measured too.** A 32,767-character
source containing 1,000 non-ASCII characters is **33,767 bytes** and still
parses; one more *character* throws whatever the byte count. A limit check
written against byte length is wrong in the **unsafe** direction for any file
with a non-ASCII comment, and every real codebase has those. (This manifest
asserted it before it was checked.)

| fixture | size (**characters**, pure ASCII) | direct parse | margin | role |
|---|---|---|---|---|
| `JustUnderTheLine.cs` | 32,587 | parses | **180** | **the control** — must parse identically with and without the callback; if it does not, the workaround is itself corrupting output and the other four prove nothing |
| `AtTheLimit.cs` | **32,767** | parses | **0** | off-by-one probe, safe side. **Load-bearing to the character** |
| `OneOverTheLimit.cs` | **32,768** | **throws** | **0** | off-by-one probe, failing side. **Load-bearing to the character** |
| `JustOverTheLine.cs` | 33,400 | throws | **633** | the everyday throw case, with slack so ordinary editing cannot silently turn it into one that parses |
| `Diagnostics.cs` | 61,510 | throws | 28,743 | the realistic case: a diagnostic and resource catalogue, the shape of the generated string tables a runtime, a compiler and an ORM all carry, and among the largest files in each. Three declarations sit **27,254 characters past the boundary** |

All five verified against the real parser: each behaves as its header claims,
and the callback path handles all five cleanly and recovers every declaration.

> **The unit is load-bearing, and `cs-oracle`'s warning is exactly right: a
> must-fail file generated by BYTE count cannot fail.** 32,768 bytes containing
> one non-ASCII character is fewer than 32,768 characters, so it parses, the
> assertion never fires, and the gate passes silently. The generator counted
> `len(str)` — code points — and **asserted every file is pure ASCII** so the
> byte count coincides. Both facts are now in every file's header beside the
> counts, so that anyone regenerating them counts the right thing or re-verifies
> against the parser. The gate request to `cs-impl` says *characters* for the
> same reason.

> **The margin column is the point, and it is there because this fixture had the
> defect it now documents.** `JustOverTheLine.cs` used to sit **88 characters**
> over the limit — a line and a half of comment. Editing a comment would have
> turned the file that must throw into a file that parses, at which point a gate
> needing a throwing input has nothing that throws and goes quietly green.
>
> The two zero-margin files are fragile **on purpose**, because being exact is
> what distinguishes "the limit is 32,767" from "the limit is somewhere around
> 32,700". The other three have slack on purpose. Which is which is stated in
> every file's header and here, and a gate asserting the four lengths is
> requested of `cs-impl` — until it exists the sizes are asserted in prose and
> nowhere that runs.

**What to check on `Diagnostics.cs`,** in increasing strictness: that a
`cs_module` row exists; that `DiagnosticCatalogue` and its members are present;
and that **`LateDeclaration`, `ILateInterface` and `LateRecord`** — at
characters 60,021 / 60,890 / 61,203 — are present. Their absence beside a
recovered head is the characteristic signature of a missing callback read: a
plausible, non-empty, **wrong** answer.

### `async` as an ordinary identifier — `proj-grammar-gate/`

`async` is a **contextual** keyword: a modifier in front of a method, lambda or
anonymous method, and an ordinary identifier everywhere else. The vendored
grammar had it only in `modifier` and not in `_reserved_identifier`, so an
occurrence in expression position was an ERROR node that **truncated the rest of
the file** — 25.1% of parse errors on 0.23.1, 65.1% on 0.23.5, and one bad
occurrence mid-file took a real file from corpus stratum linq-heavy-A from 9
methods to 0.

`cs-fixtures` does not own the patch, and the earlier position — that a fixture
for it tests `cs-impl`'s grammar work rather than a language construct — was
right about ownership and wrong about the consequence: **a gate asserting the
patch is present cannot be shown to fail without a file it fails on.** So the
file is here and the gate is `cs-impl`'s. Handed over in
`.agent-coordination/csharp/requests-impl.jsonl`.

| fixture | what it exercises |
|---|---|
| `AsyncAsIdentifier.cs` **Part 1** | `async` as a field, static field, property, **parameter** (`F(q, async: true)`), local, and in every expression position the measurement named: `if (async)`, `while`, `do`, `async ? a : b`, both operands of `&&`/`==`, positional and named argument, assignment target, compound assignment, `??=`, `this.async`, an interpolation hole, a collection initialiser, **a lambda body**, a switch arm, an `is` pattern, a `foreach` variable, an `out` variable, a deconstruction, a **label** and `goto` target, a **method name**, a **local-function name**; plus `await` as an identifier, `async` as a **type name**, a **type parameter** and an **enum member**, and sixteen other contextual keywords in the same shape — because a patch that special-cases `async` alone leaves the class of defect open |
| `AsyncAsIdentifier.cs` **Part 2** — *the control* | `async` as a **modifier**, everywhere it is legal: eight method forms, six lambda forms, two local functions, and two declarations where the same token appears **both ways four characters apart** (`async Task<int> BothAtOnce(bool async)`). The patch adds `async` to `_reserved_identifier` plus two LR conflicts; a patch that broke the modifier reading would still pass a Part-1-only gate |
| `PragmaAtEndOfFile.cs` | **`SELF_REPORTING_NODE`** — a `#pragma` as the last line with **no trailing newline**. Valid C#, compiles clean, grammar reports the error on the `preproc_pragma` node itself. Found by `cs-corpus`. **Last byte load-bearing** |
| `PragmaAtEndOfFileWithNewline.cs` | the control: byte-identical but for the newline, parses clean. Without it the claim would be about pragmas rather than the newline |
| `AsyncAsNamespace.cs` | `async` as a **namespace segment**, nested (`async.await`, `async.var.dynamic.record`), and reached by alias and by `global::`. Its own file for two compiler reasons — a block namespace may not sit beside a file-scoped one (CS8955) and `namespace async` collides with `class async` (CS0101) — which also means a single-file gate would miss this reading entirely |

The file opens with an ordinary declaration and closes with one, so a truncating
parser shows the signature plainly: `BeforeAnyAsync` recovered, `AfterAllAsync`
gone.

*Found while writing:* from inside `Fixtures.GrammarGate.*`, `using async;` is
**CS0138** — the `class async` in an enclosing namespace is found before the
global namespace of the same name, so `async` binds to the type and a
using-namespace directive cannot be applied to it. Same shape as the
alias-versus-sibling-namespace finding in `csharp-only/misc/UsingFourForms.cs`,
reached from the other side. The root alias is the only escape.

### Constructs the grammar does not parse — measured, not absorbed

A construct the grammar cannot parse produces an error, and under some grammar
states (CS-CORPUS-29 at fork11) that error runs to **end of file**. Anything
below it in the same file is swallowed into one parse gap nobody can attribute.
So such a construct gets **its own file**, with bookend types before and after
it, and its **control in a separate file** — because a control that could be
swallowed by the thing it controls for is not a control.

| fixture | construct | grammar | compiles here |
|---|---|---|---|
| `ported/expressions/ExplicitReturnTypeLambda.cs` | C# 10 explicit-return-type lambdas: `int (int x) => …`, `async Task<int> (int id) => …`, nested generics, `static async`, `ref int (ref int x) => ref x`, in argument position, two on one line | **not parsed** at fork11; error to EOF | yes |
| `ported/expressions/ExplicitReturnTypeLambdaControl.cs` | the same lambdas with the return type inferred | parses | yes |
| `proj-langversion-14/ExtensionBlocks.cs` | C# 14 `extension(T receiver) { … }`: instance property and method extensions, a generic block with a constraint, a receiver-type-only block for statics, an operator block, beside a classic `this` extension | **not parsed** — no rule at fork11 | **no** — needs SDK 10 (`NETSDK1045`, measured); written from the spec and labelled |

**The first of those was already in this tree, at line 63 of a 172-line file.**
`Lambdas.cs` carried one explicit-return-type lambda in the middle of the lambda
category's coverage; under fork11 the error would have swallowed capture,
argument position, natural type and expression trees — a hundred lines of
unrelated coverage absorbed into one gap. Found by grepping for the CS-CORPUS-29
shape after reading the finding, and moved. `cs-corpus`'s repro pair in
`proj-walk-gaps` has the same two-file shape; this is the coverage-side twin.

`proj-langversion-14/` carries `CsFixtureParsedByGrammar=false` so the parse gap
it produces is expected, and `CsFixtureVerifiable=false` so no compile sweep
reads its failure as a defect. Both readable without invoking csc.

### Spine-invariant discriminators — `proj-spine-invariants/`

`cs-oracle` derived one assertion over `cs_expression` from the CS-CORPUS-22
ruling — **every child's span is contained in its parent's** — and asked for a
discriminator: source that fails when the invariant regresses. A discriminator
has to be shown to discriminate, so `SpanContainment.cs` was run at a known-bad
parser commit (`a66c352`, before fork rule 8) and a known-good one (`0b1fe4c`),
with a synthetic out-of-parent row first to prove the checker can fail.

| invariant | pre-fix `a66c352` | post-fix `0b1fe4c` |
|---|---|---|
| child span ⊆ parent span (the ruled gate) | **0** violations | 0 |
| **(a)** no `INITIALIZER` row has a `CAST` parent | **5** sites | 0 |
| **(b)** no `OBJECT_CREATION` row ends on an identifier character | **5** sites | 0 |

**The ruled gate does not discriminate the defect it was derived from.** The
reasoning behind it — a creation span ending at the type name "puts every child
outside its parent" — assumed the initializer's children would be parented to
the short creation. They were not. The wrong parse builds a *different tree*:
`new HashSet<Node>(c) { … }` becomes `BINARY(BINARY(new HashSet < Node) > CAST((c) { … }))`,
the initializer's children hang off the `CAST`, and every child sits inside its
wrong parent. A consistent wrong tree satisfies containment.

Invariants (a) and (b) are each **impossible in valid C#** — a cast's operand is
never a bare `{ }`; a creation ends at `)`, `}`, `]` or is `new()` — and each
fires five times on the broken tree and never on the fixed one. `cs-impl`'s own
measurement of the fix, *"4 casts-of-an-initializer → 0"* on the linq-heavy
stratum, is invariant (a) counted on the corpus.

**The trigger's precondition is two-part, and the second part was found by this
fixture failing to discriminate twice.** The type argument must be an
*identifier* (`Box<Node>`, `Box<T>` — not `Box<int>`, since `int` cannot be an
operand of `<`) **and** the argument list must *look like a cast target*
(`(seed)`, `(A.B)` — not `(Make())`, which cannot be a cast and lets the creation
win even unfixed). The first draft used `Box<int>` and discriminated nothing;
the second used `(Make())` and discriminated nothing. Every non-triggering shape
is kept beside the triggering ones, labelled as the control it is.

The rest of the file is the containment discriminator as first intended — every
wrapper carries a call in the last syntactic segment a short span would omit:
nested creations with initializers, lambdas in arguments, interpolated strings
with calls in holes, `with` initializers, conditional-access chains, index and
range, switch expressions, queries, casts of initializers, and the CS-CORPUS-23
relational-pattern shape. The invariant is still worth having; it is not the one
that catches this.

---

## 4c. Enum coverage — measured, not assumed

`cs-impl`'s enum audit is derived from the enum barrel rather than a
hand-maintained list, and it reports every declared value that is neither
emitted nor explained. It runs against **`cs-impl`'s own 31-file inline gate
corpus**, which is deliberate and correct — a suite needs inputs it can break,
and it says so in `csharp-tests.ts` — but it means the audit had **never parsed
this corpus**.

So this corpus was run through it: `cs-impl`'s analyzer, `cs-impl`'s barrel,
`cs-impl`'s `ENUM_COLUMNS` map, pointed at `src/test-data/csharp/staging/`.

| | before | after |
|---|---|---|
| declared enum values | 460 | 460 |
| **reached by this corpus** | 371 | **390** |
| not reached | 89 | 70 |
| … of which RESERVED (zero by design) | 30 | 30 |
| … of which MEASURED_GAPS (parser defects) | 39 | 39 |
| … of which **genuine fixture holes** | **20** | **1** |

**Nineteen of the twenty closed.** The twentieth is below, and it is not
closable by hand.

### What closed, and what the hole actually was

| value(s) | why the corpus missed it | fixture |
|---|---|---|
| `CsAttributeTarget.ASSEMBLY`, `.MODULE` | nothing here carried an attribute that attaches to the compilation rather than to a declaration | `ported/attributes/AssemblyAndModuleAttributes.cs` |
| `CsAttributeTarget.TYPE`, `.EVENT`, `.TYPEVAR` | the corpus used the three targets whose *default* is already right, and never the explicit spellings | `ported/attributes/AttributeUsages.cs` |
| `CsAttributeArgumentValueKind.NULL`, `.IDENTIFIER` | every attribute argument here was a literal, a `typeof`, a `nameof`, a member access or an expression | same |
| `CsFieldModifier.PROTECTED`, `.INTERNAL`, `.REQUIRED`, `.NEW` | fields appeared everywhere and were always `private` or `public`. The interesting axis was never the one being varied | `ported/type-registry/FieldForms.cs` |
| `CsFieldModifier.UNSAFE` | `proj-unsafe` declared `unsafe struct`, so the modifier was on the TYPE and the fields inherited the context without carrying it | `proj-unsafe/UnsafeFields.cs` |
| `CsTypeModifier.NEW` | `new` appeared on methods, fields and events, never on a nested type | `ported/type-registry/TypeModifiersAndPlacement.cs` |
| `CsNamespaceStyle.NONE` | the file that declared a global-namespace type also declared block namespaces, so its module read `BLOCK`, never `NONE` | `ported/GlobalNamespaceTypes.cs` |
| `CsScopedModifier.SCOPED` | `scoped` appeared on a LOCAL and the column is on the parameter | `csharp-only/parameters/ParameterModes.cs` |
| `CsCommentKind.XML_DOC_BLOCK` | every doc comment used `///` and none used `/** */` — the form C# inherited from Java, and the one a ported Java codebase is full of | `proj-comments/XmlDocBlock.cs` |
| `CsActivationSource.UNEVALUATED` | see below — it is unreachable from compiling C# | `proj-noncompiling/PreprocUnevaluable.cs` |
| `CsParseGapKind.ERROR_PARTIAL`, `.ERROR_TRUNCATING` | one small deliberate defect produced one bucket | `proj-noncompiling/GapPartial.cs`, `GapTruncating.cs` |

### Two findings from closing them

**`CsActivationSource.UNEVALUATED` is unreachable from compiling C#.** Probing
the evaluator with twenty-one condition shapes showed it handles every form the
C# preprocessor grammar admits — identifier, `true`, `false`, `!`, `&&`, `||`,
`==`, `!=`, parentheses — and fails on exactly two, an integer-literal condition
(`#if 1`, which tree-sitter parses **cleanly**, with no ERROR node) and a
condition whose node is absent. Both are CS1517. So the value's only population
is files that do not compile, which is why its fixture is in
`proj-noncompiling/` and which changes what a zero-row assertion on it would
have meant.

**`CsParseGapKind.SELF_REPORTING_NODE` — I said it was not synthesizable, and
I was wrong.** Thirty-six candidate shapes were probed and none produced it, and
this manifest reported it as "an emergent property of large real files."
`cs-corpus` then isolated the trigger from real corpus files to **one
character: a `#pragma` directive as the last line of a file with no trailing
newline.** The same file with the newline parses clean.

Every one of my thirty-six probes ended with `\n`. I varied the directive, the
placement and the file size, and never the file's terminator — which is the
finding at the top of this manifest, *varies the construct, not the modifier*,
applied to its author. The reproducer is now
`proj-grammar-gate/PragmaAtEndOfFile.cs`, credited to `cs-corpus`, with its
control beside it; verified against the real extractor
(`SELF_REPORTING_NODE(preproc_pragma)`, root error, zero ERROR / inserted /
zero-width nodes). Its **last byte is load-bearing** — `8`, not `\n` — and an
editor configured to add a final newline silently turns it into its own
control. A last-byte assertion is in the gate request to `cs-impl`.

It is valid C# that compiles clean, so it lives with `async`-as-identifier:
source the compiler accepts and the vendored grammar does not. A grammar
defect worth filing upstream, not a property of broken source.

**After this, against `cs-impl` `35b481a`: 451 declared, 398 reached, 53
unreached — 20 reserved, 33 measured gaps, 0 fixture holes.** (The totals moved
from the earlier 460 because `cs-impl` re-ruled several values between the two
runs; both figures are attributed to the commit they were measured at.)

### Two MEASURED_GAPS that this corpus already closes

`CsExpressionKind.RANGE` and `CsExpressionKind.SIZEOF` are listed as measured
gaps and are **emitted when the parser runs over this corpus**. They are not
gaps; they were absent from the 31-file gate corpus. Per `cs-impl`'s own ratchet
rule the two entries should be removed and `GAP_BAR` lowered from 41 to 39.
Routed, not edited — that file is not mine. `cs-impl` `35b481a` ("the audit
over both corpora, and the ruled non-gaps") adopted both the correction and the
suggestion.

### `CsExpressionOwnerKind` — all eleven

The expression walk used to start at method bodies and nothing else, so this
enum was 1 of 11 and no fixture could have discriminated the rest. Now:

| owner | rows | |
|---|---|---|
| `METHOD` | 18,652 | |
| `FIELD` | 740 | field initialisers |
| `PROPERTY` | 723 | property initialisers and expression bodies |
| `METHOD_PARAMETER` | 96 | parameter defaults |
| `ENUM_MEMBER` | 55 | enum member values |
| `EVENT` | **25** | event initialisers — was 2, which is too few to discriminate anything; nine more shapes added |
| `TYPE` | **16** | primary-constructor base arguments — was 6, all a bare identifier; ten computed ones added |
| `VARIABLE` | 0 | gap |
| `BLOCK` | 0 | gap |
| `ATTRIBUTE` | 0 | gap |
| `MODULE_INIT` | 0 | gap |

**The four zeroes are confirmed as parser/schema questions rather than fixture
holes, because the constructs are present and the values still do not appear:**
1,236 `cs_variable` rows and 2,502 expressions in `VARIABLE_INITIALIZER`
context; 924 `cs_block` rows; 96 attributes with 168 arguments; and one module
with `hasTopLevelStatements`. A fixture cannot close any of them.

`LOCK_SUBJECT` was the thinnest root context in the corpus at **one** row and is
now **17**, covering a field, `this`, a static field, a property, an array
element, a call result, a local, a null-coalesce and a nested lock.

---

## 5. Consolidated "no analogue" record

Java constructs with **no C# port**, recorded rather than invented:

| Java construct | why it does not port | nearest thing covered instead |
|---|---|---|
| `throws` clause / checked exceptions | C# has neither, at any level | exception hierarchy + `catch … when` filters + advisory `<exception cref>` (`blocks/ExceptionHandling.cs`) |
| multi-catch `catch (A \| B e)` | no such clause | one clause plus a type test in the filter |
| use-site wildcards `? extends` / `? super` / `?` | variance is declaration-site only | `in`/`out` on interfaces and delegates; a constrained type parameter; a non-generic base interface |
| `sealed … permits` | `sealed` forbids derivation outright; no permits list | abstract base with `private protected` constructors |
| inner (non-static) classes | every C# nested type is Java's *static* nested class | nested types, labelled as such |
| local classes | C# cannot declare a class in a method body | **local functions**, lambdas, anonymous types |
| anonymous classes | a C# anonymous type declares data only, no base, no interfaces | lambda, local function, `Comparer<T>.Create` |
| enum constructors, fields, methods, constant bodies, `implements` | a C# enum is integral constants only | `[Flags]`, static lookup table, extension methods on the enum |
| generic constructors `<U> Ctor(…)` | a C# constructor cannot declare type parameters | static generic factory |
| package-private default | C# defaults to `internal` at top level and `private` when nested — **two defaults from one absence** | all six accessibility levels, explicitly |
| `synchronized` / `native` / `strictfp` / `transient` methods | no such member modifiers | `lock` in the body; `extern` + `DllImport`; `volatile` as a *field* modifier |
| `final` local | C# has no `readonly` local | `const` local (a *compile-time* constant — a false friend) |
| method references `String::length` | no `::` | **method groups** (`csharp-only/delegates/MethodGroups.cs`) |
| constructor references `Foo::new` | no such form | lambda; `new()` constraint |
| single-type import `import a.b.C;` | C# imports namespaces, not types | `using` alias — a C#-only form |
| `@interface` declarations | an attribute is an ordinary class deriving from `Attribute` | attribute classes; **no new `TypeCategory`** |
| `finalize()` as an ordinary method | C#'s finaliser is its own member kind, uncallable and unoverridable | `~Type()` |

C# constructs with **no Java analogue at all** are the whole of half two; the ones
worth naming because they change the *shape* of the fact base rather than adding
to it: properties and indexers, events and `+=`, delegates and method groups,
extension methods, LINQ query syntax, `using static` / alias / global / implicit,
partial types, nullable annotations, structs' value semantics, records'
synthesised members, `ref`/`out`/`in`, explicit interface implementation,
conversion operators, `#if`, top-level statements, primary constructors,
`dynamic`, pointers, and collection expressions.

---

## 6. What the parse layer will hit here on purpose

The parse-layer measurement (`schema-oracle.jsonl`, Q1b) named five grammar
defects. Three are exercised deliberately:

| defect | fixture | why it is here |
|---|---|---|
| **collection expressions mangled** as `element_binding_expression`, spread as `range_expression`, on 0.23.1 | `collections/CollectionExpressions.cs` | the injectivity allowlist's live entry. `[1,2,3]`, `a?[0]`, `dict[(1,2)]`, `data[1..3]` and `..spread` are all in one method so the disambiguator can be tested rather than assumed |
| **`collection_element` conflating** `ExpressionElement` and `SpreadElement` | same file | spread and non-spread elements in the same literal |
| **`async` as an ordinary identifier** (25.1% of errors on 0.23.1, 65.1% on 0.23.5) | **`proj-grammar-gate/`** — §4b | it is a *parser* defect, so the GATE is `cs-impl`'s; but a gate asserting the patch is present cannot be shown to fail without a file it fails on, so the file is here and the gate is theirs |
| **32,767-character limit** (8.51% of corpus files) | **`proj-large-file/`** — §4b | four files with stated margins — 32,587 / 32,767 / 32,768 / 33,400 characters — plus a realistic 61,510-character catalogue with three declarations 27,254 characters past the boundary |
| **`#if` splitting a construct** (1.60% of corpus, irreducible) | `proj-multi-target/Api.cs`, `proj-define-constants/Guarded.cs` | four FRAGMENT regions with known shapes: a base list, a parameter list, a return type and half a binary expression |

---

## 7. Expected failures — for `cs-corpus`

Two projects fail on purpose. **These are not parser defects and must not be
reported as any.**

### `proj-extension-hidden/`

| error | count | where |
|---|---|---|
| `CS1061` | 14 | every extension-syntax call in `Consumer.cs` |
| `CS0103` | 3 | the three static-syntax calls, whose *type name* is also out of scope |

The fully-qualified call (`global::Acme.Text.StringExtensions.Slugify`) **succeeds**.

### `proj-noncompiling/`

`SyntaxErrors.cs`, `GapPartial.cs` and `GapTruncating.cs` are the
**syntactically** invalid files, one per parse-gap shape, and each was **sized by
measurement rather than by eye**:

| file | measured | note |
|---|---|---|
| `SyntaxErrors.cs` | `INSERTED_NODE` | **not `ERROR_LOCAL`** — this manifest claimed otherwise until the value was measured. One missing `)` is recovered by an inserted token, which is a different shape from an ERROR node |
| `GapPartial.cs` | `ERROR_PARTIAL` @ ~15% | the ERROR runs from the break to EOF, so the fraction is governed by how much valid code sits AFTER it. Twenty arrangements were measured; the symmetric ones land at 49.8% and 50.5%, on either side of a threshold |
| `GapTruncating.cs` | `ERROR_TRUNCATING` @ 100% | |
| `PreprocUnevaluable.cs` | `PREPROC_FRAGMENT` ×2 | plus the `UNEVALUATED` activation source |

`SyntaxErrors.cs` reports **`CS1026`**; `PreprocUnevaluable.cs` reports
**`CS1517`** and **`CS1025`**.

Everything else in that project is well-formed C# that fails to bind, one file
per `CandidateReason` the oracle classifies on.

### `proj-comments/` — expected WARNINGS, not errors

The project builds. It emits **14 deliberate warnings**, and they are the
fixture: with `GenerateDocumentationFile` on, they are how the oracle can prove
a `///` comment was read as XML rather than as text.

| warning | count | what it is |
|---|---|---|
| `CS1570` | 9 | badly formed XML — unclosed element, mismatched tags, unescaped `&` and `<` |
| `CS1572` | 1 | a `<param>` tag for a parameter that does not exist |
| `CS1573` | 2 | a parameter with no `<param>` tag, when others have one |
| `CS1574` | 2 | a `cref` that does not resolve — beside one that does, for contrast |

`CS1591` is suppressed by the project, deliberately: see §13.

> **A measured finding, and a trap for the corpus agent.** With
> `SyntaxErrors.cs` present, the whole project reports **one** error. With it
> excluded, **three** — and all three are *declaration-level*. Removing those
> three reveals **twelve more**, all in method bodies:
>
> ```
> CS0122 ×3  CS1501 ×2  CS0305 ×2  CS0103 ×2  CS7036  CS1503
> CS1061     CS0266     CS0165     CS0161     CS0121  CS0029
> ```
>
> **csc's emit path suppresses every method-body diagnostic when any
> declaration diagnostic is present.** An oracle that drives `Emit` and an
> oracle that calls `Compilation.GetDiagnostics()` therefore see *different
> sets* on the same source. Whichever `cs-oracle` uses, the expected-failure
> list for this project has to be generated the same way, or the two will
> disagree for a reason that has nothing to do with the parser.

---

## 8. Open items

| item | status |
|---|---|
| **LangVersion 13** | **Ruled.** C# 12 is the floor; `proj-langversion-13/` is labelled, marker-excluded and off-limits to the oracle for blessing |
| **A fixture over 32,767 characters** | **Done** — `proj-large-file/`, §4b, with a control |
| **`async`-as-identifier** | **Done and handed over** — `proj-grammar-gate/`, §4b; the gate is `cs-impl`'s |
| **The 33 "fixture holes"** | **Measured and closed — see §4c.** Against this corpus the number is **20**, not 33, and **19 are closed**. The 33 was measured against `cs-impl`'s 31-file inline gate corpus, which had never parsed this tree |
| **`CsExpressionOwnerKind`, all eleven** | **Done** — §4c. Seven reached; `EVENT` 2→25 and `TYPE` 6→16; the four zeroes are confirmed *not* fixture holes, with the construct counts that prove it |
| **`SELF_REPORTING_NODE`** | **Closed — by `cs-corpus`'s finding, authored into staging.** The ask in `findings-corpus.jsonl` was answered before it was filed; the reproducer is two lines and the one variable my 36 probes never varied |
| **`UNEVALUATED` and the §4.0 admission tests** | **Routed to `cs-oracle`** (`schema-oracle.jsonl`). Whether it is RESERVED or a gap depends on whether §4.0 admits non-compiling files, which is not mine to decide |
| **A length gate on the boundary fixtures** | **Requested of `cs-impl`** (`requests-impl.jsonl`). Four numbers in **characters**, plus the last byte of the pragma reproducer; `src/test/` is theirs |
| **No cross-project references in the canonical tree** | **Ruled and done.** Five `file`-local attributes, one relocated file; 30 of 30 categories build in isolation. `cs-oracle`'s gate should find nothing; `cs-corpus` can drop the five `ProjectReference`s at the next promotion |
| **Heritage position 0** | Routed to `cs-oracle`; `cs-impl` replies it is already implemented |
| **csc suppressing method-body diagnostics** | Routed. `cs-impl` has checked it affects no gate of theirs |
| **`GAP_BAR` 41 → 39** | **New, routed to `cs-impl`.** `CsExpressionKind.RANGE` and `.SIZEOF` are listed as measured gaps and this corpus emits both |
| **`BUILDING-CSHARP.md` §2 still offers the withdrawn LINQ menu** | Open, human's |

### Promotion — what I assume, and what I checked

`cs-corpus` promotes this tree into `src/test-data/csharp/categories/`. These
are the assumptions the staging tree is written under, each checked against
`c-sharp` at `670e316` rather than taken from a report:

| assumption | checked | result |
|---|---|---|
| `staging/` is the authored source and promotion is a **copy** | content hash of every `.cs` in both trees | **275 of 275 byte-identical.** The 10 extra promoted files are `cs-corpus`'s own diagnostics (8 `proj-walk-gaps`, 2 `proj-parse-gaps`) |
| promotion may **re-partition** into per-category projects | mapped every file's origin to its destination | it does: 2 projects → 30. `attributes`→`annotations`, `usings`→`imports`, `GlobalNamespaceTypes.cs`→`type-registry/` |
| the **governing configuration survives** the re-partition | `Nullable`/`ImplicitUsings`/`LangVersion`/`TargetFramework`/`CsFixtureVerifiable` on all 30 vs their origin project | **30 of 30 match** |
| cross-category references need `ProjectReference`s | grep + build | five files reference `annotations/`; **exactly five** csprojs carry a `ProjectReference`; all build. Whole promoted tree: 47 build, 2 fail by design, 1 skipped by marker |

**The re-partition finding — ruled, and acted on.** `categories/` is
canonical for both blessing and running, and **no fixture reference may cross a
project boundary**: a type reached through a `ProjectReference` resolves as a
metadata symbol with zero `DeclaringSyntaxReferences`, which is unadjudicable
and would read as a parser defect that is really an artifact of partitioning.
`cs-oracle` is adding a gate for exactly this.

So the five references were eliminated **on the staging side**, where I own
them, rather than by asking `cs-corpus` to keep five `ProjectReference`s in
step:

| file | what it reached across for | now |
|---|---|---|
| `expressions/Lambdas.cs` | an attribute on a lambda parameter | `file sealed class FlowAttribute` in the same file |
| `methods/ParameterAndReturnForms.cs` | attributes on parameters | `file` `FlowAttribute` + `TagAttribute` |
| `type-parameters/GenericTypes.cs` | an attribute on a type parameter | `file` `TypeParamAttribute` |
| `type-references/ReferenceContexts.cs` | `typeof` in an attribute argument | `file` `TargetedAttribute` with a `Type` member |
| `integration/ServiceLayer.cs` | an attribute on the service class | `file` `ServiceAttribute` |

A `file`-local attribute class cannot collide, cannot be referenced from
another file, and — checked before use, since it was not obvious — is legal on
public members, type parameters, return values, parameters and lambda
parameters. A sixth dependency the grep had not shown: `GlobalNamespaceTypes.cs`
sat at the top of `ported/` and only worked because promotion happened to drop
it into `type-registry/`, whose `PlainClass` it references. It now lives there
in staging too. **Where a file sits is part of what it depends on.**

**Verified the way the gate will:** every staging category compiled as its own
project, inheriting only its origin's `.csproj` and referencing nothing.
Before the fix, **25 of 31 built and 6 failed** — the five predicted plus the
sixth — so the check can fail. After: **30 of 30.** The next promotion needs no
`ProjectReference` at all, and if one reappears it is a new cross-reference,
not a leftover.

The other thing the re-partition changes stands as stated: **in-file
cross-reference comments are staging-relative** and name paths that do not
exist in `categories/`. Prose only; flagged, not churned.

One promoted file *was* coverage with no staging origin —
`proj-parse-gaps/PragmaAtEofNoNewline.cs`, the sole cover for
`SELF_REPORTING_NODE`. It now has one: `proj-grammar-gate/PragmaAtEndOfFile.cs`.
The next promotion can source it from staging and the copy invariant returns to
whole.

### The pre-publication scrub — numbers kept, identities dropped

`cs-corpus` scrubbed everything it owns and reported **99 hits in 96 files it
could not touch**: text inherited verbatim from staging, which re-promotion
would restore. *"They scrub staging, I re-promote."*

Two derivations of that list, compared before either was acted on:

| derivation | files | hits |
|---|---|---|
| `cs-corpus`'s measured count over `categories/` | 96 | 99 |
| the corpus key's names, over staging `.cs` + `.csproj` | 97 | 100 |
| the key's names **plus file-level identities** (the four source-file names and one library name that pin a repository just as well) | 98 | 108 |

The one-file, one-hit difference between the first two is pattern breadth, not
a disagreement about content — every hit outside the 88 generated part headers
was listed and read individually. The superset was scrubbed. **Zero remain in
any promoted file, and zero in this manifest.**

What changed, and what did not:

- The **88 part headers** and `Partial88.csproj` no longer name the ORM or the
  generated type they were sized against; they say "a large ORM's generated
  compiled model" and cite the corpus stratum id. **88 stays.**
- Measurements that named the repository the number came from now cite the
  **neutral stratum id** from the key instead — `linq-heavy-A`,
  `multitarget-A`/`-B`. **9 → 0 methods stays; 54.8% stays; 25 of 50 stays.**
- `Diagnostics.cs` and `LargeFile.csproj` no longer name three real source
  files; they say what those files *are* — the generated string tables of a
  runtime, a compiler and an ORM. Its size moved by 34 characters and the three
  past-the-boundary offsets were **re-measured, not adjusted**.
- Three BCL references that named the repository say "the BCL".

**The one thing flagged rather than scrubbed — ruled, and done.**
`proj-noncompiling/GeneratorShapeWithoutGenerator.cs` declared two local
attribute classes carrying a real MVVM generator library's attribute names, and
the flag argued the names were what made the fixture look like a generator
shape. The ruling: rename them, and keep the documentary value in the header.
The reasoning that the fixture must still *look* like a generator shape was
right; the reasoning that the names are what makes it one was wrong. What the
parser sees is a partial class annotated with an attribute whose declaring
assembly is absent — that works under any name. What a *reader* loses is knowing
why the partial has one part, and a header paragraph recovers that without
identity. Two distinctive compounds appearing together are more identifying than
either alone, and the constraint has no de-minimis clause.

They are now `GeneratedPropertyAttribute` and `GeneratedCommandAttribute`, the
header says what shape they are and why the generator is absent, and the
project's error set is byte-identical before and after. A cross-reference in
`proj-langversion-13/PartialProperties.cs` that named one of them is scrubbed
too. **Zero identities remain anywhere in staging, the manifest included.**

### On measuring the right corpus

The audit that produced the "33 fixture holes" is sound and its corpus choice is
right: `cs-impl` writes its 31 gate files inline *so that the suite has inputs
it can break*, and a fixture nobody may edit cannot serve as a negative control.
Both corpora should exist.

What follows from having two is that **a number measured on one of them is not a
number about the other**, and the routing said "constructs your corpus doesn't
reach" about a corpus the audit had never opened. Re-running it here cost about
an hour and changed 33 to 20, of which 19 closed — and found two entries in the
gap list that are not gaps.

That is `BUILDING-A-PARSER.md` §11 in both directions: *verify before you file*,
and *when a defect is reported to you, reproduce it before fixing it.* Four of
ten Python defects filed from a checked-in export were artifacts of the export.
Writing 33 fixtures from the handed-over list would have produced 13 files for
constructs already covered, and left `SELF_REPORTING_NODE` — the one that is
genuinely uncloseable — looking closed.

### The audit is reproducible

`.scratch/audit-against-fixtures.ts` in the `cs-audit` worktree, ~90 lines: it
lifts `ENUM_COLUMNS` out of `csharp-tests.ts` rather than re-deriving it, runs
`CSharpProjectAnalyzer` over `src/test-data/csharp/staging/`, and reports every
declared value the corpus fails to reach. It is scratch and uncommitted — the
right home for it is `cs-impl`'s suite, as a second corpus alongside the inline
one, and that is theirs to decide.
