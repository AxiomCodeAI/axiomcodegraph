# TypeScript fixture staging — half one: the Java port

**Source only. No expected facts.** Nothing in this tree states what the parser
should emit. Node kinds are named below to describe *what the source contains*,
so coverage can be reasoned about; they are not expectations, and the oracle
remains the sole author of what any fixture's facts are.

- **Target:** TypeScript **6.0.3**, verified with the compiler installed in this
  repo. 6.x is the ceiling for a compiler-as-library oracle; 7.x ships native
  binaries and a CLI only, with no `ts.createProgram` and no `TypeChecker`.
- **Verification:** `npx tsc --noEmit -p src/test-data/typescript/staging` is
  clean, as is the repo-wide `npx tsc --noEmit`, `npm run build`, and
  `npx tsx src/test/python-tests.ts` (8/8).
- **Scope:** the 12 Java categories only. The type system — unions,
  intersections, conditional and mapped types, `satisfies`, declaration
  merging, structural satisfaction — is **half two** and is deliberately absent.

## Every fixture declares its nature

TypeScript requires a distinction Java and Python never needed: whether a file
has runtime existence at all. A **type-only** fixture that produces call-graph
rows is a parser bug, not a corpus gap. Each file's header states which it is,
and the table below repeats it so the harness need not parse comments.

| nature | meaning |
|---|---|
| `runtime-bearing` | the file emits JavaScript; its declarations and call sites belong in the call graph |
| `type-only` | the file emits nothing (`--noEmit` aside, its emit is empty or an empty module); **no call-graph row may originate here** |

---

## Category 1 — `annotations` (decorators)

| fixture | nature | node kinds exercised |
|---|---|---|
| `standard-decorators.ts` | runtime-bearing | `Decorator`, `ClassDeclaration`, `ClassExpression`, `MethodDeclaration`, `GetAccessor`, `SetAccessor`, `PropertyDeclaration`, `AccessorKeyword` (auto-accessor), `PrivateIdentifier`, `CallExpression`, `ArrowFunction`, `FunctionDeclaration`, `TypeReference` (`ClassMethodDecoratorContext`, `ClassFieldDecoratorContext`, `ClassGetterDecoratorContext`, `ClassSetterDecoratorContext`, `ClassAccessorDecoratorContext`), `ExportAssignment` (default) |
| `decorator-arguments.ts` | runtime-bearing | `Decorator` with `CallExpression`, `PropertyAccessExpression` and `ParenthesizedExpression` callees; `ObjectLiteralExpression`, `ArrayLiteralExpression`, `SpreadElement`, `SpreadAssignment`, `TemplateExpression`, `BigIntLiteral`, `NumericLiteral` with separators, `EnumMember` reference, `Identifier` class reference, `FunctionExpression`, `ClassExpression`, `ArrowFunction` as decorator arguments |
| `legacy/legacy-decorators.ts` | runtime-bearing | as above plus **`Parameter` decorators** and constructor-parameter decorators, `PropertyDescriptor`-shaped method decorators, `ParameterPropertyDeclaration` |

**Java correspondence.** Java annotations are inert metadata; decorators are
functions **called at class-definition time**, so each decoration is a call site
and every decorator fixture is runtime-bearing. Java's `@interface` declaration
ports to the decorator function declaration itself, typed by its context
parameter.

**Legacy dialect is in scope and stays.** `legacy/` compiles under its own
`tsconfig.json` with `experimentalDecorators: true`; the two decorator dialects
cannot share one project, which is why `staging/tsconfig.json` excludes that
directory. It does not need to typecheck under the root program and no longer
can, since the root `tsconfig.json` excludes `src/test-data/typescript`.

Legacy decorators are where **taint sources are declared** in real TypeScript
backends: NestJS `@Body()` / `@Query()` / `@Param()`, Angular `@Injectable`,
TypeORM `@Column` are the analogue of Spring's `@RequestParam` /
`@RequestMapping`, which Java CWE detection already keys on. Parameter
decorators exist in no other dialect.

## Category 2 — `blocks`

| fixture | nature | node kinds exercised |
|---|---|---|
| `control-flow.ts` | runtime-bearing | `Block`, `IfStatement`, `ForStatement`, `ForOfStatement`, `ForInStatement`, `ForAwaitOf`, `WhileStatement`, `DoStatement`, `SwitchStatement`/`CaseClause`/`DefaultClause`, `LabeledStatement`, `BreakStatement`/`ContinueStatement` with and without labels, `EmptyStatement`-style headers, `FunctionExpression` IIFE, four-deep nesting |
| `exception-handling.ts` | runtime-bearing | `TryStatement`, `CatchClause` with binding, **without** binding, and with an `unknown` annotation; `FinallyBlock`, `ThrowStatement`, `never` return type, `AwaitExpression` in `try`/`finally`, promise `.catch`/`.finally`, `try` inside a `Generator`, class hierarchy of `Error` subclasses |

**No analogue — Java's `THROWS_CLAUSE`.** TypeScript has **no checked
exceptions and no throws clause**. Java's entire `ThrowsPatterns.java` and the
`THROWS_CLAUSE` type-reference context have no port and none is invented. Also
absent: multi-catch (`catch (A | B e)`) and any typed catch parameter — a catch
binding is `any` or `unknown` and its type must be recovered by narrowing.
The replacements TypeScript actually uses (an `Error` subclass hierarchy plus
`instanceof` narrowing) are covered instead.

**Blocked, not omitted.** `using` / `await using` (TS 5.2) require
`"ESNext.Disposable"` in `lib`, which the root project does not set; adding a
fixture would break the repo-wide typecheck. Owner: whoever owns the root
`tsconfig.json`. Once staging is excluded from the root project this becomes
free to add.

## Category 3 — `enums`

| fixture | nature | node kinds exercised |
|---|---|---|
| `enum-forms.ts` | runtime-bearing | `EnumDeclaration`, `EnumMember` with and without initialisers, string / numeric / heterogeneous / computed members, constant-expression members over earlier members, reverse mapping, `ComputedPropertyName` from an enum member, `SwitchStatement` over an enum |
| `const-enum.ts` | runtime-bearing | `EnumDeclaration` with `ConstKeyword`, inlined member reads, bit-flag members, string-valued members, module-local const enum |

**Nature note on `const enum`.** This is the one genuinely ambiguous case and
the fixture header spells it out: the **declaration is erased** (no runtime
object, no reverse mapping), while a **member access is inlined** to its literal
value at the call site. The file is runtime-bearing because its functions emit.

**No analogue.** Java enum constructors, fields, methods, per-constant class
bodies, per-constant abstract-method implementations and `implements` on an enum
have no TypeScript form. The idiomatic replacements — a lookup record keyed by
enum member, and a plain function — are shown instead, because that is what real
code does.

## Category 4 — `expressions`

| fixture | nature | node kinds exercised |
|---|---|---|
| `literals.ts` | runtime-bearing | `NumericLiteral` (decimal, hex, octal, binary, exponent, separators), `BigIntLiteral`, `StringLiteral` (both quotes, every escape, unicode code point, surrogate pair), `NoSubstitutionTemplateLiteral`, `TemplateExpression` (nested, multiline), `TaggedTemplateExpression`, `RegularExpressionLiteral` (flags, named groups, lookahead), `TrueKeyword`/`FalseKeyword`/`NullKeyword`/`undefined`, `ObjectLiteralExpression` (shorthand, computed, quoted, numeric keys, accessors, spread), `ArrayLiteralExpression` (holes, spread, trailing comma), `Symbol` keys |
| `operators.ts` | runtime-bearing | `BinaryExpression` across arithmetic, comparison, strict and loose equality, logical, bitwise, all three shifts; `**`; every compound assignment including `??=`/`&&=`/`||=`; `PrefixUnaryExpression`/`PostfixUnaryExpression`; `ConditionalExpression` (nested); `TypeOfExpression`, `VoidExpression`, `DeleteExpression`, `InExpression`, `InstanceOfExpression`, comma operator, `SpreadElement`, `NonNullExpression`, `AsExpression`, `TypeAssertionExpression` (angle-bracket), `AwaitExpression`, `YieldExpression` including `yield*` |
| `calls-and-member-access.ts` | runtime-bearing | `CallExpression` (plain, method, static, qualified chain, parenthesised callee, through a variable or property, spread arguments, explicit type arguments), `NewExpression` (with/without arguments, generic, qualified, of a class expression, of a ctor in a variable), `SuperCall` and `super.method()`, `.call`/`.apply`/`.bind`, IIFE both spellings, `PropertyAccessExpression`, `ElementAccessExpression`, `OptionalChain` in all three forms (`?.`, `?.[]`, `?.()`), long short-circuiting chains, `PrivateIdentifier` access and the `#x in obj` brand check, `MetaProperty` (`new.target`) |

**No analogue.** Java method references (`String::length`) have no TypeScript
syntax; the fixture uses the real analogue — passing the function value itself —
which is also the form where receiver binding goes wrong in practice. Java char
literals and numeric suffixes (`1.5f`, `999L`) have no port.

## Category 5 — `imports`

| fixture | nature | node kinds exercised |
|---|---|---|
| `import-forms.ts` | runtime-bearing | `ImportDeclaration` with `ImportClause` default / named / renamed / default+named / `NamespaceImport` / side-effect-only; `ImportSpecifier` with inline `type`; `ImportTypeDeclaration` (`import type`, `import type * as`); barrel resolution through `index.ts`; `ImportCall` (dynamic `import()`) plain, destructured and conditional; `ExportDeclaration` re-export and `export type` re-export |
| `cjs-interop.ts` | runtime-bearing | `ImportEqualsDeclaration` (`import x = require()`), an import **alias** to an existing name, a qualified type reached through that alias |
| `pkg/index.ts` | runtime-bearing | barrel: named re-export, renamed re-export, `export { default as }`, `export type { }`, `export *`, `export * as ns` |
| `pkg/util.ts` | runtime-bearing | named `FunctionDeclaration`, `ClassDeclaration`, `VariableStatement`, and a `default` function export |
| `pkg/models.ts` | **type-only** | `InterfaceDeclaration`, `TypeAliasDeclaration` only — importing from it must produce no runtime edge |
| `pkg/side-effects.ts` | runtime-bearing | a module with **no exports**, imported purely for its top-level effect |
| `pkg/legacy-cjs.ts` | runtime-bearing | `ExportAssignment` (`export =`), the TypeScript-only CommonJS export form, with a merged `declare namespace` for its companion type |

**No analogue.** Java static imports and wildcard imports do not port. The
nearest forms — named imports and `import * as ns` — are covered, and the
difference is recorded rather than papered over: Java resolves against a
classpath by fully-qualified name, TypeScript against the file system by module
specifier, and a TypeScript import binds a name that may be a value, a type, or
both.

**Resolution-mode sensitivity (finding).** Under `moduleResolution: node16`,
a dynamic `import()` in a CommonJS file requires an explicit file extension;
under the repo's `node` resolution it does not. `import x = require()` is legal
in a CommonJS-emitting project and an error in an ES module. Staging's config
mirrors the repo's settings so fixtures are checked as the repo checks them.

## Category 6 — `local-variables`

| fixture | nature | node kinds exercised |
|---|---|---|
| `local-variable-forms.ts` | runtime-bearing | `VariableStatement` with `var`/`let`/`const`, multiple declarators, no initialiser, `ExclamationToken` (definite assignment), `ObjectBindingPattern` (plain, renamed, defaulted, nested, rest), `ArrayBindingPattern` (positional, holes, rest, defaults, swap by destructuring assignment), initialisers of every expression kind, bindings in a `Constructor`, `MethodDeclaration`, `GetAccessor`, `SetAccessor`, `ClassStaticBlockDeclaration`, property initialiser, generator, async body, nested function, closure capture, shadowing, loop bindings in all three loop forms, `CatchClause` binding, `CaseBlock` binding |
| `helper-types.ts` | runtime-bearing | support module mixing runtime exports (`EnumDeclaration`, `ClassDeclaration`, `FunctionDeclaration`) with type-only ones (`InterfaceDeclaration`, `TypeAliasDeclaration`) |
| `cross-file-locals.ts` | runtime-bearing | locals typed by imported classes, interfaces, enums, unions and generics — resolution must follow an import edge first; `import type` bindings used only in type position |

**Java correspondence.** Java's `final` local is closest to `const` and Java's
`var` to an un-annotated `let` — both are false friends, and the fixture pins
the difference. Destructuring has no Java form at all.

## Category 7 — `method-type-parameters`

| fixture | nature | node kinds exercised |
|---|---|---|
| `generic-methods.ts` | runtime-bearing | `TypeParameter` owned by a `MethodDeclaration` rather than its class: alongside class parameters, **shadowing** a class parameter of the same name, a bound referencing a **sibling** method type parameter, unbounded beside bounded, a parameter with a **default**, a **`const` type parameter**, on `async`, generator, `this`-returning and `static` methods, on a generic arrow held in a property, on overload signatures with **differing type-parameter arity**, and on methods in an `ObjectLiteralExpression` |

**No analogue.** A TypeScript **constructor cannot declare type parameters**;
Java's generic constructors have no port, and the idiomatic replacement — a
static generic factory — is shown in `methods/constructor-patterns.ts`.

## Category 8 — `methods`

| fixture | nature | node kinds exercised |
|---|---|---|
| `method-kinds.ts` | runtime-bearing | instance / `static` / `private` / `protected` / `public` / `#private` methods, `GetAccessor`, `SetAccessor`, static getter, `async`, generator, async generator, `ClassStaticBlockDeclaration`, well-known-symbol method (`[Symbol.iterator]`), `ComputedPropertyName` method, optional method, arrow-function property, `abstract` methods and accessors, `override` on each form, and the free-function forms (declaration, async, generator, async generator, function expression, named function expression, arrow, async arrow) plus object-literal methods |
| `parameter-forms.ts` | runtime-bearing | required, optional (`QuestionToken`), defaulted, `RestParameter`, object and array `BindingPattern` parameters with renaming/defaults/nesting, a **`this` parameter**, function-typed and generic-instantiation parameters, union and nullable parameters, and `ParameterPropertyDeclaration` in a constructor |
| `constructor-patterns.ts` | runtime-bearing | implicit constructor, single constructor, **constructor overload signatures plus one implementation**, `SuperCall`, `protected` and `private` constructors, singleton via static factory, generic class constructor, static generic factories, all-parameter-property constructor, subclass inheriting a constructor |
| `overload-signatures.ts` | runtime-bearing | overload sets differing in arity, in parameter type at equal arity, in **return** type, generic overloads, method overloads, `static` overload set, `private` overloaded method, overloads declared in an object-literal **type** with one implementation, overloads differing only by optionality |
| `interface-method-signatures.ts` | **type-only** | `MethodSignature`, optional method signature, `PropertySignature` with a function type, `CallSignature`, `ConstructSignature`, `IndexSignature` (string- and number-keyed, `readonly`), generic and constrained method signatures, overloaded signatures, `this`-typed signatures, type predicate and `asserts` signatures, `AsyncIterable`/`Iterable` symbol members |

**No analogue.** `synchronized`, `native`, `strictfp`, `transient`, `volatile`,
`final` methods, and the **instance initialiser block** have no TypeScript form
(`static {}` exists; the instance form does not). Java interface `default` and
`static` methods do not port: a TypeScript interface member can never have a
body. Java records have no analogue; the nearest shape — a class of `readonly`
parameter properties — is used where one is needed.

**Deliberately not covered here.** *Which* overload a given call site resolves
to is decided by `checker.getResolvedSignature` and belongs to half two. This
fixture covers declaration syntax only.

## Category 9 — `type-parameters`

| fixture | nature | node kinds exercised |
|---|---|---|
| `generic-classes.ts` | runtime-bearing | `TypeParameter` on `ClassDeclaration` and `FunctionDeclaration`: one, two and three parameters, descriptive names, single constraint, **intersection** constraint, constraint referencing a **sibling** parameter, `DefaultType`, constraint plus default, F-bounded self-referential (`FluentBuilder<TSelf, TResult>`), `const` type parameter, generic arrow in a property |
| `generic-type-declarations.ts` | **type-only** | the same parameter forms on `InterfaceDeclaration` and `TypeAliasDeclaration`, plus **variance annotations** `in`, `out` and `in out`; generic `FunctionType`, `ConstructorType`, `AbstractConstructorType`; generic method signatures; a generic interface extending a generic interface |

**Variance is the port of `WildcardVariance`.** Java expresses variance at the
**use** site (`List<? extends Number>`); TypeScript expresses it at the
**declaration** site (`interface Producer<out T>`). They are not
interchangeable, and no use-site wildcard is simulated.

## Category 10 — `type-references`

| fixture | nature | node kinds exercised |
|---|---|---|
| `heritage-clauses.ts` | runtime-bearing | `HeritageClause` in every form: class `extends`, class `implements` (single and multiple), interface `extends` (single, multiple, generic, nested generic), `extends` a generic base with concrete / nested / forwarded arguments, `extends` **and** `implements` together, abstract base with concrete subclass, and `extends` applied to a **call expression** (the mixin pattern), which Java has no form of |
| `reference-contexts.ts` | runtime-bearing | a type referenced from every context: property, optional property, definite-assignment property, `readonly` array property, function-typed property, `IndexSignature` value, parameter, optional parameter, defaulted parameter, `RestParameter`, destructured parameter, **`this` parameter**, return type, type-parameter constraint, local annotation, explicit type arguments on a call and on `new`, `AsExpression`, `TypePredicate` (`value is T`), and `asserts value is T` |
| `array-and-tuple-types.ts` | **type-only** | `ArrayType` and `Array<T>`, `readonly T[]` and `ReadonlyArray<T>`, arrays of unions and of function types, multi-dimensional arrays, nested generics one to three deep, `TupleType` fixed / named / optional / rest / leading-rest / `readonly` / empty, tuples inside generics, a tuple as a parameter list, `ConstructorType` and `AbstractConstructorType` |

**No analogue.** Java's use-site wildcards (`? extends`, `? super`, unbounded
`?`) and `sealed` / `permits` have no TypeScript form and are not simulated.
Java's `THROWS_CLAUSE` reference context does not exist here.

**Held for half two, deliberately.** `heritage-clauses.ts` keeps to the nominal
model — every class that satisfies an interface **declares** it. Structural
satisfaction, where a class satisfies an interface without the clause, is the
case Java's model cannot express, and half two is where it should be shown
breaking. Keeping this file nominal makes that contrast legible.

## Category 11 — `type-registry`

| fixture | nature | node kinds exercised |
|---|---|---|
| `type-categories.ts` | runtime-bearing | `InterfaceDeclaration`, `ClassDeclaration`, `abstract` class, class extending a built-in (`Error`), `EnumDeclaration`, `TypeAliasDeclaration` (object, union, function), anonymous and **named** `ClassExpression`, `FunctionDeclaration`, type-predicate function |
| `type-modifiers-and-access.ts` | runtime-bearing | module visibility (exported vs module-local), `public`/`protected`/`private`, `#private` field and method, `static`, `readonly`, `abstract` member and abstract accessor, `override`, optional member, `ClassStaticBlockDeclaration`, `private constructor`, static factory, getter/setter pair, `ParameterPropertyDeclaration`, `readonly` index signature |
| `type-placement.ts` | runtime-bearing | top-level exported and non-exported declarations, a **local class** in a function body closing over a parameter, `InterfaceDeclaration` and `EnumDeclaration` inside a function body, a class inside a `Block`, a class held on a **static property**, a `ClassExpression` in an `ObjectLiteralExpression`, `ExportDefault` class |

**No analogue.** `final`, `sealed`/`permits`, package-private access, **inner
(non-static) classes** and **static nested classes** have no TypeScript form.
TypeScript nests *types* with a namespace, which is half two's assignment; the
nearest available shapes (a local class, and a class on a static property) are
used and labelled as such. Java records and `@interface` declarations do not
port.

## Category 12 — `integration`

| fixture | nature | node kinds exercised |
|---|---|---|
| `contracts.ts` | **type-only** | `InterfaceDeclaration` with `extends`, generic interfaces, generic constraints, `TypeAliasDeclaration`, indexed and mapped-ish utility usage (`Partial`, `Record`) — consumed only through `import type` |
| `service-layer.ts` | runtime-bearing | the categories combined: `import type` and value `import` in one file, `Error` subclass hierarchy, `EnumDeclaration`, generic class `implements` a generic imported interface, subclass with `override` and `super` call, composition root, closures returned from methods, `Decorator` on methods, constructor overload signatures + implementation, `async` methods, an async generator with a `do/while`, generator method, `try`/`catch`/`throw`, `ParameterPropertyDeclaration` dependency injection, generic method taking an imported `Handler` type |

---

## Consolidated "no analogue" record

Java constructs with **no TypeScript port**, recorded rather than invented:

| Java construct | why it does not port | nearest thing covered instead |
|---|---|---|
| `throws` clause / checked exceptions | TypeScript has neither | `Error` subclass hierarchy + `instanceof` narrowing (`blocks/exception-handling.ts`) |
| multi-catch `catch (A \| B e)` | catch bindings are `any`/`unknown`, never typed | narrowing inside the `catch` block |
| use-site wildcards `? extends` / `? super` | variance is declaration-site only | `in`/`out`/`in out` annotations (`type-parameters/generic-type-declarations.ts`) |
| `sealed` / `permits` | no sealed hierarchies | `private constructor`; closed unions belong to half two |
| `final` class / method / field | no `final` | `readonly` fields, `private constructor` |
| `synchronized`, `native`, `strictfp`, `transient`, `volatile` | no equivalent modifiers | — |
| package-private access | visibility is per-module, not per-package | exported vs. non-exported declarations |
| inner (non-static) and static nested classes | classes do not nest as types | local class in a function; class on a static property; namespaces (half two) |
| instance initialiser block | only `static {}` exists | field initialisers + constructor body |
| enum constructors, fields, methods, constant bodies | enum members are values, not objects | lookup `Record` + plain functions (`enums/enum-forms.ts`) |
| record declarations | no records | class of `readonly` parameter properties |
| `@interface` annotation declarations | annotations are not decorators | decorator function declarations typed by their context |
| annotations on type uses / on type parameters | decorators are illegal in type positions | — |
| generic constructors `<U> Ctor(...)` | constructors cannot declare type parameters | static generic factory (`methods/constructor-patterns.ts`) |
| interface `default` / `static` methods | interface members cannot have bodies | `abstract class` with concrete methods |
| method references `String::length` | no such syntax | passing the function value itself |
| static imports, wildcard imports | different resolution model entirely | named imports; `import * as ns` |
| char literals, numeric suffixes (`1.5f`, `999L`) | no such literal forms | — |

## Open items for the human — not mine to decide

1. ~~Exclude the staging tree from the root project.~~ **Done** by `ts-oracle`
   in `d4fb5fb`; `exclude` now carries `src/test-data/typescript`. This also
   unblocks `using` / `await using`, which need `"ESNext.Disposable"` in `lib`.
2. ~~Legacy decorators: restore or drop.~~ **Restored**, by decision: they carry
   the taint-source declarations of real TypeScript backends.
3. **`experimentalDecorators` longevity.** It still compiles under 6.0.3 and is
   a plausible removal candidate in the 7.x line. If it goes, retire that
   fixture deliberately rather than discovering it through a red gate.
4. **Oracle ceiling, for the schema doc** (owner: `ts-oracle`): 6.x is the last
   line with a usable compiler API. If 7.x becomes the only maintained line the
   oracle must drive `tsserver` out of process.

## What half two adds

Held by assignment until the schema exists: unions and intersections;
conditional types and `infer`; mapped types and key remapping; template-literal
types; `keyof` / `typeof` / indexed access; `satisfies`; `as const`;
discriminated unions and narrowing; `declare` and ambient `.d.ts`; module
augmentation; namespaces; JSX/TSX; and the two that break the ported Java model
outright — **structural satisfaction** (a class satisfies an interface without
declaring it) and **declaration merging** (one name, several declarations,
across two files, three files, and a module boundary).

---

# Half two — the type system

Constructs that exist in neither Java nor Python. Same rules: source only, no
expected facts, every fixture declares its nature. TSX is out of the first
freeze and is absent by decision.

Ten of these fourteen fixtures are **type-only**, which is the point: this half
is where a parser most easily leaks phantom call-graph rows.

| fixture | nature | node kinds exercised |
|---|---|---|
| `unions-and-intersections.ts` | type-only | `UnionType`, `IntersectionType`, literal-type members, recursive union (`JsonValue`), unions of object / function / array / tuple types, intersection producing `never`, callable intersection with properties, union-of-intersections vs intersection-of-unions, `never`/`unknown` absorption, optional member vs `\| undefined` |
| `conditional-types.ts` | type-only | `ConditionalType`, nested ladders, `InferType` in return / parameter / element / property / construct position, multiple `infer` sites, `infer ... extends`, distributive vs bracketed non-distributive, recursive conditionals (`DeepAwaited`, `Flatten`, `DeepReadonly`, `PathOf`), tuple recursion (`Reverse`), `KeysMatching` |
| `mapped-types.ts` | type-only | `MappedType`, `+`/`-` on `readonly` and `?`, mapping over a key union, **key remapping with `as`**, remap-to-`never` filtering, remapping over a union member into an event map, conditional value positions, homomorphic tuple/array mapping, `Pick`/`Omit`/`Record` rebuilt |
| `template-literal-types.ts` | type-only | `TemplateLiteralType`, cross-product over unions, `number`/`boolean` interpolation, all four intrinsics (`Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize`), nested templates, `infer` from a template (`SplitOn`, `Trim`, `ParamNames`), templates as mapped-type keys |
| `typeof-subjects.ts` | **runtime-bearing** | the values `keyof-typeof-indexed.ts` queries: `const`, `as const` array, function, class, enum — split out so the query file can be honestly type-only |
| `keyof-typeof-indexed.ts` | type-only | `KeyOfType`, `TypeQuery` (`typeof` in **type** position, distinct from the runtime operator), `IndexedAccessType`, `T[number]`, `keyof typeof Enum`, `(typeof x)[keyof typeof x]`, `InstanceType<typeof Class>`, generic `T[K]` accessors |
| `satisfies-and-const.ts` | **runtime-bearing** | `SatisfiesExpression` on object / array / tuple / function, `as const` on literals, objects, tuples, a single property and an argument, `as const satisfies` combined, annotation-vs-`satisfies` widening contrast, `const` type parameter |
| `narrowing.ts` | **runtime-bearing** | discriminated union + `switch` + `assertNever` exhaustiveness, boolean discriminant, narrowing by `typeof` / `instanceof` / `in` / truthiness / literal equality, `TypePredicate` (incl. generic and `this is`), `asserts value is T`, `asserts condition`, narrowing preserved into a closure, `unknown` narrowed structurally |
| `structural/implicit-implements.ts` | **runtime-bearing** | classes satisfying interfaces with **no `implements` clause**, used in assignment / argument / return / array / `Map` value / generic-inference positions; a declared clause for contrast; satisfaction with extra members; method vs arrow-property satisfaction; object literal satisfying an interface |
| `structural/assignable-without-syntax.ts` | **runtime-bearing** | mutually assignable unrelated classes, class→alias, object literal→class type, unrelated interface subtyping, function assignability (fewer params, covariant return, contravariant param), method **bivariance** vs property contravariance, readonly-array variance, generic structural satisfaction, `#private` **nominality**, `unique symbol` brands, excess-property freshness |
| `merging/same-file-merges.ts` | **runtime-bearing** | interface+interface (×3), interface merge adding an overload, namespace+function, namespace+class, namespace+enum, namespace+namespace, interface+class |
| `merging/two-files/` | type-only ×2, runtime-bearing consumer | one interface declared in **two files**, merged in global scope; a second interface merged the same way; consumer reading members from both |
| `merging/three-files/` | **runtime-bearing** ×3 + consumer | one interface and one namespace each declared in **three files**; consumer reading all three contributions of each |
| `merging/module-augmentation.ts` + `augmented-base.ts` | **runtime-bearing** | `declare module "./specifier"` adding members to another module's interface, a second interface augmented in the same block, a new type introduced into the other module's namespace, and `declare global` augmenting `Array<T>` and adding a `var` |
| `ambient-declarations.ts` | type-only | `declare` const/let/var, ambient function + ambient overload set, `declare class`, `declare enum`, `declare namespace` with nesting |
| `ambient-module.d.ts` | type-only | a **declaration file**: `declare module "pkg"`, wildcard `declare module "*.svg"`, scoped package with `export =` |
| `ambient-consumers.ts`, `ambient-module-consumer.ts` | **runtime-bearing** | call sites whose targets are ambient: ambient function calls, ambient overload resolution, `new` on a `declare class`, calls through an ambient namespace, imports resolved only by ambient module declarations |
| `namespaces.ts` | **runtime-bearing** | type-only namespace (erased) **and** value namespace (emits an IIFE) in one file, nested namespaces of both kinds, non-exported namespace members, `import X = Ns.Member` aliases, qualified value and type references |
| `structural/name-collisions.ts` + `collision-support.ts` | **runtime-bearing** | local classes whose members shadow `Array`/`Promise`/`Map`/`String` prototype names (`map`, `filter`, `then`, `catch`, `get`, `has`, `split`, `join`, `length`, `reduce`, `slice`), the same names called on genuine built-in receivers for contrast, local bindings named after methods, built-in *names* shadowed by local declarations in a nested scope, a local `Row` beside an imported `Row`, and receivers naming nothing local (`Row[]`, `readonly Row[]`, `Promise<Row>`, anonymous object type) |
| `type-only/erasure-boundary.ts` | **runtime-bearing** | `import type` (named, default, namespace), inline `type` specifiers beside value ones, a type-only import of a class whose value import also appears, `export type { }`, `export { type X }`, value re-export alongside |
| `overload-resolution.ts` | **runtime-bearing** | call sites resolved by literal argument type, arity, argument type at equal arity, boolean-literal return selection, generic-vs-non-generic declaration order, a nested overloaded call, and resolution through an alias |

## The two that break the ported Java model

**Structural satisfaction.** Java's `IMPLEMENTS_INTERFACE` is authoritative
because a Java class implements an interface only if it says so. In TypeScript
the clause is optional and the checker never consults it. `implicit-implements.ts`
puts every satisfaction in a load-bearing position with no clause anywhere;
`assignable-without-syntax.ts` goes further, to pairs that exist in **no syntax
at all** — no clause, no heritage, no import. Both files also mark where
structural typing *stops*: `#private` fields and `unique symbol` brands are
nominal, and two identically-shaped classes are then not interchangeable.

**Declaration merging.** `name -> single entity` is false. Coverage is at three
distances, as asked: **same file** (seven merge kinds), **two files**, **three
files**, and **across a module boundary** via `declare module "./specifier"` plus
`declare global`. The cross-file cases are global scripts, which is the only way
two plain files can merge — and that forces `isolatedModules: false`, so those
two directories carry their own `tsconfig.json` and are excluded from
`staging/tsconfig.json`. Same reason as `annotations/legacy`: a fixture whose
construct requires different compiler options needs its own project.

## Subprojects in staging

`staging/tsconfig.json` excludes three directories, each because its construct
cannot share a project with the rest:

| directory | why | option |
|---|---|---|
| `annotations/legacy` | the two decorator dialects are mutually exclusive | `experimentalDecorators: true` |
| `type-system/merging/two-files` | global scripts cannot be modules | `isolatedModules: false` |
| `type-system/merging/three-files` | global scripts cannot be modules | `isolatedModules: false` |

All four projects typecheck clean under TypeScript 6.0.3.

## Still deferred

- **TSX** — out of the first freeze by decision.
- **`using` / `await using`** — now unblocked (the root project no longer
  compiles staging), so these can be added to `blocks/` whenever wanted; they
  need `"ESNext.Disposable"` in the staging `lib`.

## Nature audit — a mistake of mine, and the rule that catches it

`ts-impl` caught `keyof-typeof-indexed.ts` declaring `nature: type-only` while
containing a class, a const, a function and an enum. Auditing every type-only
fixture the same way found the fault was **systematic, not isolated — five files**:

| file | what emitted | fix |
|---|---|---|
| `type-system/keyof-typeof-indexed.ts` | `const`, `function`, `class`, `enum` | values split into `typeof-subjects.ts`; the query file now reaches them through `import type` and is genuinely type-only |
| `merging/three-files/registry-core.ts` | `namespace` with `export const` | relabelled runtime-bearing |
| `merging/three-files/registry-http.ts` | `namespace` with `export const` | relabelled runtime-bearing |
| `merging/three-files/registry-cache.ts` | `namespace` with `export const` | relabelled runtime-bearing |
| `type-system/type-only/erased-exports.ts` | `class`, `const` | relabelled runtime-bearing; the mixture is deliberate and the header now says so |

The rule the audit applies, which is worth enforcing in the gate rather than
leaving to fixture authors (owner: `ts-oracle`):

> A file may declare `nature: type-only` only if it contains no top-level
> `const`/`let`/`var`/`function`/`class`/`enum` that is not `declare`, and no
> namespace exporting a value. `.d.ts` files are type-only by construction.

`namespace` is the trap: its nature follows its **contents**. A namespace of
types is erased; a namespace exporting one `const` emits an IIFE. `namespaces.ts`
covers both kinds in one file and is labelled runtime-bearing for that reason.

That check is mechanical, and a mislabelled fixture silently weakens the very
invariant the label exists to prove — a type-only fixture that emits cannot
detect a parser leaking call-graph rows, because the rows would be legitimate.
