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
| `legacy/legacy-decorators.ts.quarantined` | runtime-bearing | as above plus **`Parameter` decorators** and constructor-parameter decorators, `PropertyDescriptor`-shaped method decorators, `ParameterPropertyDeclaration` |

**Java correspondence.** Java annotations are inert metadata; decorators are
functions **called at class-definition time**, so each decoration is a call site
and every decorator fixture is runtime-bearing. Java's `@interface` declaration
ports to the decorator function declaration itself, typed by its context
parameter.

**Quarantine.** `legacy/` is parked on a non-compiled extension and has its own
README. The root project compiles `src/**/*` without `experimentalDecorators`,
so a legacy-dialect file there reddens the shared gate — including the *Python*
suite, which runs a project-wide `tsc --noEmit`. The one-line remedy, and the
coverage cost of dropping legacy decorators instead (parameter decorators exist
in no other dialect), are in `annotations/legacy/README.md`.

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

1. **Exclude the staging tree from the root project.** The root `tsconfig.json`
   compiles `src/**/*`, which sweeps in parser *inputs* as application source.
   Three concrete consequences observed: the legacy-decorator fixture reddened
   the **Python** suite; `using` declarations cannot be added because the root
   `lib` lacks `ESNext.Disposable`; and `npm run build` emits **80 fixture files
   into `dist/`**, shipping test data in the published package.
2. **The coupling itself.** `src/test/python-tests.ts` runs a project-wide
   `tsc --noEmit` as its first check, so either language effort can redden the
   other's suite. Two parallel branches with one shared project is the design
   worth revisiting; item 1 is the cheap mitigation.
3. **Legacy decorators: restore or drop.** `annotations/legacy/README.md` sets
   out both paths and the specific coverage lost by dropping (parameter
   decorators exist in no other dialect; Angular and NestJS DI depend on them).
4. **`experimentalDecorators` longevity.** It still compiles under 6.0.3 and is
   a plausible removal candidate in the 7.x line. If it goes, retire that
   fixture deliberately rather than discovering it through a red gate.
5. **Oracle ceiling, for the schema doc** (owner: `ts-oracle`): 6.x is the last
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
