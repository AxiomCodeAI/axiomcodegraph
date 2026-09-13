# JavaScript fixture staging

**Source only. No expected facts.** Nothing in this tree states what the parser
should emit. Node kinds are named below to describe *what the source contains*,
so coverage can be reasoned about; they are not expectations, and the oracle
(`../parser-oracle/javascript/`) remains the sole author of what any fixture's
facts are. A hand-written expectation that is wrong becomes the spec and locks
in the bug it was meant to catch.

- **121 source files** walked, **122 modules emitted** (the `.js.flow` is now walked too) (plus one `.js.flow` that is not — see Findings 12), **9 `package.json` files, 0 expectation files.**
- **Parse-verified** against `typescript@6.0.3` — the pinned oracle compiler —
  with `ts.createSourceFile(..., ScriptKind.JS)`, which is the parse the schema
  says the front end uses. One file reports diagnostics on purpose; see
  *Findings*, item 1.
- **Cross-checked** with `node --check` (Node 25 on this machine; the repo's
  floor is `engines: node >= 18`). Three files fail that check, all three
  deliberately; see *Findings*, item 2.
- Written against the approved schema in `src/schema/javascript/JAVASCRIPT-FACT-SCHEMA.md`
  (16 relation pairs, 362 columns) and the phase-0 rulings in `DECISION-MEMO.md`.

---

## Pre-OSS scrub — done, and proven a rename rather than a rewrite

Nothing in `staging/` names a corpus or benchmark that was measured against.
Scrubbed against **`js-corpus`'s measured inventory** (39 files, 79 hits) rather
than a grep of my own, and the two derivations disagreed usefully in both
directions: theirs counted a runtime-library path form (six hits my census had no
pattern for); mine counted seventeen names theirs excluded as English or as
unmeasured — a UI library's name as a bare word, a CSS-in-JS library, two
template engines, a bundler, and others.
The union was scrubbed. Neither list alone was complete, which is the argument
for two.

**Constructs were renamed, not semantics — and that is measured, not asserted.**
A semantic fingerprint of the whole fact base (every relation's row count and
every enum column's value histogram, with names, text, hashes and positions
excluded) was taken before and after. **Zero differences outside `js_comment`**;
the eleven extra comment rows are explanatory prose added during the scrub.

The fingerprint earned its keep twice on the way:

- A first rename turned `require('debug')('…')` into `require('sax').parser(true)`
  and the fingerprint moved a `FUNCTION_CALL` to a `METHOD_CALL` — a construct
  change (a require result invoked directly) hiding inside what looked like a
  specifier rename. Reverted; see the flag list.
- Scrubbing one prose line made a `DIRECTIVE` row *disappear*. The detector is
  `/\beslint(-disable|-enable|\s)/`, so **the word followed by a space in prose
  is classified as an ESLINT directive** — a parser false positive the scrub had
  accidentally removed. It is now a labelled control in `directive-comments.js`
  and a finding for `js-impl`.

**Flagged for the human, not decided** — each is a place where a fixture's value
could depend on something real:

| item | what I did | why it is your call |
|---|---|---|
| `require('debug')` ×2 | **restored** | `js-corpus` excludes it as an English word; it was never a measured corpus, only a transitive dependency. It is the only installed package here that makes `require(x)(…)` — a require result invoked directly — resolve as `RESOLVED_EXTERNAL`. If it must go, it is two lines and one construct loses its resolving instance |
| corpus-derived **measurements** (`83.6%`, `2,738 files`, `4,488 of 14,335`, `73.0%`, `2,230 B / 4,701 B`) | **kept** | they do not *name* the corpus, and `js-corpus`'s ruling was "keep every measurement, drop every identity". If measurement provenance is itself a leak, that is a much larger pass and most of it is in the schema document, not here |
| the Apache-2.0 banner in `after-long-licence.js` | **kept**; the house-style claim is now "a widely-copied house style" | the banner is generic licence text. The fixture's *realism argument* — that this length occurs in real code — rested on naming who writes it that way, and that name is gone |
| `Closure` as a JSDoc dialect name | **kept** | it names a compiler dialect the schema itself compares against, like "TypeScript"; not a corpus. Confirm |
| `eslint-disable`, `istanbul ignore` | **kept** | directive-comment syntax is the construct, and `JsDirectiveKind.ESLINT` is a schema value. Not corpora |
| the `@flow` npm scope in `flow-scoped-package.js` | **kept**; claim softened | the scope *is* the construct (`/` is a word boundary). Whether the scope is real on npm is no longer asserted |

**Not touched:** `categories/` and `verified/`, per the ruling — `categories/`
is a pure function of this tree through `promote-fixtures.mjs` and is clean iff
this is. Nothing deleted.

## Who owns a fixture's header

Fixtures now arrive on three branches into three directories, and a file that
never went through a header pass fails the suite for everyone. The rule, so it
does not recur every sweep:

| directory | owner | introduces files via |
|---|---|---|
| `staging/` | `js-fixtures` | this branch |
| `verified/` | `js-corpus` | repros against a pushed commit, per `verified/README.md` |
| `categories/` | `js-corpus` | promotion from `staging/` |

**Headers follow the directory.** Whoever introduces a file writes its four lines
— `fixture:`, `module system:`, `nature:`, `syntax floor:` — in the format below,
and the owner of the directory is the one a failure is attributed to. I do not
edit outside `staging/`, and the convention is here so nobody has to ask.

**And the recurrence ends structurally, not by agreement.** The nature label is
being derived rather than declared (ruled; for JavaScript the derivation is
exact), after which the header line is documentation that cannot fail the suite.
Until that lands, a `verified/` or `categories/` file without a `nature:` line
is `js-corpus`'s to fix — both directories are in its charter, and it has already
made the check mechanical: `fixture-headers.mjs` computes the label with the
gate's own predicate and exits 1 on any missing or disagreeing one, never
rewriting a wrong label. The gate itself (`src/test/javascript-tests.ts`,
`src/test/javascript-gates/`) is `js-oracle`'s.

**Corrected 2026-09-12.** A first version of this table put `verified/` under
`js-impl` and the gate under `js-impl`, both wrong. I inferred ownership from a
commit message's *topic* — "AST-recall completed across the nine unwalked
relations" — when `js-impl` built that harness over six relations and `js-corpus`
completed it across the other nine, so the message belongs to the second agent.
A commit's subject carries what was done, not who owns the directory; the git
author was the same human for every branch, so it was the only signal and the
wrong one. Same class as the four instrument errors below: a real signal read
against the wrong population.

## The two things every fixture declares

The brief requires both, per file, in the file's own header **and** in the tables
below, so the harness never has to parse a comment.

### 1. Module system, and the governing `package.json`

The same bytes mean different things under each system, so a fixture whose
module system is undeclared cannot be adjudicated. Every fixture is governed by
a **shipped** `package.json` in this tree, and the table names which one.

| governing file | `"type"` | `moduleSystemSource` it produces | what it governs |
|---|---|---|---|
| `cjs/package.json` | `"commonjs"` | `PKG_TYPE_COMMONJS` | all 67 files under `cjs/` |
| `esm/package.json` | `"module"` | `PKG_TYPE_MODULE` | all 9 files under `esm/` |
| `pkg-absent-type/package.json` | *absent* | `PKG_TYPE_ABSENT_DEFAULT` | `pkg-absent-type/defaulted.js` |
| `mismatch/esm-under-commonjs/package.json` | `"commonjs"` | `PKG_TYPE_COMMONJS` | the two contradiction fixtures |
| `ext/esm-package/package.json` | `"module"` | `PKG_TYPE_MODULE`, overridden by `EXT_CJS` for `.cjs` | `override.cjs`, `plain.js` |
| `ext/cjs-package/package.json` | `"commonjs"` | `PKG_TYPE_COMMONJS`, overridden by `EXT_MJS` for `.mjs` | `override.mjs`, `plain.js` |
| `exports-map/package.json` | `"module"` | `PKG_TYPE_MODULE` + `exports`/`imports` maps | 8 files |
| `jsx/package.json` | `"commonjs"` | `PKG_TYPE_COMMONJS` | `component.jsx`, `component-in-js.js` |
| `flow/package.json` | `"module"` | `PKG_TYPE_MODULE` | the 16 files under `flow/` — all **detection** fixtures under schema §2.6 |

**`NO_PACKAGE_JSON_DEFAULT` is not reachable from a fixture, and that is
recorded rather than faked.** It is 15.4% of the schema's corpus, and it requires
that nearest-ancestor lookup find *no* `package.json` at all. This repository has
one at its root, so every file in this tree has a governing config by
construction. Exercising that enum value needs a corpus file outside a package,
which is `js-corpus`'s to supply, not a fixture's to invent.

### 2. Runtime-bearing or type-only

**The vocabulary is exactly two values, and the gate enforces it** — a file
declaring anything else is reported as having no header. Ten Flow fixtures were
written with `EXCLUDED` / `EMITTED` / `PLAIN JAVASCRIPT` and failed the suite
for it; all now say one of the two.

| nature | meaning | gate predicate |
|---|---|---|
| `runtime-bearing` | the file has executable statements | `statements.length >= 1` |
| `type-only` | **no executable statement at all** — every declaration is a JSDoc comment. **No `js_call_site` or `js_expression` row may originate here** | `statements.length === 0`, and zero rows in those two relations |

**Nature and provenance are orthogonal**, and conflating them is how the ten went
wrong. `nature` describes the file's *syntax*; what the parser *does* with it is
`sourceProvenance`. A Flow file has statements (`runtime-bearing`) and is
declined (`FLOW_EXCLUDED`), and both are true at once.

### 3. Expected provenance — the line that fails by name

Every file under `flow/` and `cjs/provenance/` carries a third header:

    // expected provenance: FLOW_REJECTED|BUNDLED|PROJECT — <why, in one line>

It is not in the nature gate's vocabulary. It exists so a future gate can compare
it against `js_module.sourceProvenance` and **fail by naming the file and the
direction**, rather than reporting a detection rate. Run at `6e80847` against the
sixteen `flow/` files:

    17 match, 3 mismatch   (at df6365a — umd and the two-signal length rule landed)
      flow/detection-miss/after-long-licence.js      expected FLOW_REJECTED,  got PROJECT        <- the 2,048-byte miss
      flow/false-positive/flow-scoped-package.js     expected PROJECT,        got FLOW_REJECTED  <- detector false positive
      flow/false-positive/mentions-flow-in-prose.js  expected PROJECT,        got FLOW_REJECTED  <- detector false positive

All three are the known detector defects, each with a message that says which
construct broke instead of a number that moved. `readable.esm.js`,
`readable.umd.js` and `single-long-literal.js` each expected `PROJECT` ahead of
its fix, failed by name, and **went green on its own when the fix landed** —
three times, the same shape. And `js-corpus` measured that `.esm.` has **zero
witnesses in 4,529 corpus files**, so `readable.esm.js` was the only thing
anywhere that could show that ruling take effect. The
check is twelve lines: read the header, read the module row, compare. Owner for
adopting it as a gate: `js-oracle`, whose charter holds `src/test/javascript-tests.ts`.

Two files are type-only: `cjs/jsdoc/typedef-only.js` and
`cjs/integration/contracts.js`. Both contain nothing but comments, which is the
strictest form the label can take — there is no `export`, no `module.exports`,
no binding, so the invariant is not weakened by a stray value the way five
TypeScript fixtures were before that manifest's nature audit caught them.

A JSDoc-only fixture producing call-graph rows is a parser bug and not a corpus
gap — but only because these two files say which they are.

---

# Half one — the twelve Java categories

The port is hosted under `cjs/` on purpose. 84.3% of the schema's corpus is
CommonJS library code, so a half-one port written in ESM would be a port into the
minority dialect. ESM has its own tree (`esm/`) and is covered in half two.

## Category 1 — `annotations`

**NO ANALOGUE.** Java annotations are inert metadata read by a framework;
JavaScript has no annotation syntax. Decorators are the nearest construct and are
**out of scope by the schema's own ruling** — OQ-1 records zero occurrences in
the corpus, proposes no relation, and names the trigger that would raise it
(the first corpus file containing one). Writing a decorator fixture now would
mean writing fixtures for a relation that does not exist.

What actually carries declaration-site metadata in JavaScript is **JSDoc**, and
that is `cjs/jsdoc/` — half two, six files, because it is the type channel and
not a footnote.

## Category 2 — `blocks`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/blocks/control-flow.js` | CommonJS | runtime-bearing | `Block`, `IfStatement` (braced, unbraced, dangling-else), `ForStatement` (empty head slots, comma operator in init and update, unbraced body), `ForInStatement`, `ForOfStatement` (incl. destructuring head), `ForAwaitOf`, `WhileStatement`, `DoStatement`, `SwitchStatement`/`CaseClause`/`DefaultClause` (shared labels, fall-through, braced case, default in the middle), `LabeledStatement` on a loop **and on a bare block**, `BreakStatement`/`ContinueStatement` with and without labels, bare block containing only `var` (a block that opens no scope), four-deep nesting across a function boundary, `ClassStaticBlockDeclaration` |
| `cjs/blocks/exception-handling.js` | CommonJS | runtime-bearing | `TryStatement`, `CatchClause` with a binding, **without** one, and with an `ObjectBindingPattern`; `FinallyBlock` (incl. one that `return`s and swallows the throw), `ThrowStatement` of Error / string / number / object / null, `NewExpression` with `cause`, `Error.captureStackTrace`, three-level `Error` subclass hierarchy, `instanceof` narrowing as the multi-catch replacement, rethrow, try in a loop with `continue`, `await` in try/catch/finally, promise `.catch`/`.finally`, try inside a generator, `process.on('uncaughtException')` |

**NO ANALOGUE — `THROWS_CLAUSE`.** JavaScript has no checked exceptions and no
throws clause, exactly as TypeScript does not. Java's `ThrowsPatterns.java` and
the `THROWS_CLAUSE` type-reference context have no port and none is invented.
The nearest thing is the JSDoc `@throws` tag — a comment with no enforcement —
covered in `cjs/jsdoc/param-returns.js`.

**NO ANALOGUE — multi-catch and typed catch parameters.** A catch binding has no
type and no annotation channel. `instanceof` narrowing is covered instead.

## Category 3 — `enums`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/enums/enum-idioms.js` | CommonJS | runtime-bearing | frozen `ObjectLiteralExpression` (string, numeric, computed and bit-flag members), an unfrozen one as the control, `Symbol()` and `Symbol.for()` constants, a reverse map built by a loop (member names are not literals in the source), a class of static constant instances with `values()`/`valueOf()`, `SwitchStatement` over the values, `Object.values`/`Object.keys` consumption |

**NO ANALOGUE.** There is no `enum` keyword and `ts_enum_member` has no `js_*`
counterpart; the schema says so. Java enum constructors, per-constant fields,
per-constant class bodies and `implements` on an enum have no port. The four
idioms real code uses are covered instead, and **the property worth pinning is
that none of them is a declaration**: a frozen object of constants is a value,
and a parser that mints a type for it is guessing.

## Category 4 — `expressions`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/expressions/literals.js` | CommonJS | runtime-bearing | `NumericLiteral` (decimal, leading/trailing dot, exponent, hex, octal, binary, separators, `-0`, beyond `MAX_SAFE_INTEGER`), `BigIntLiteral`, `StringLiteral` (both quotes, every escape, `\x`, `\u`, `\u{}`, surrogate pair, line continuation), `NoSubstitutionTemplateLiteral`, `TemplateExpression` (nested, multiline, escaped `${`), `RegularExpressionLiteral` (flags, classes, named groups, lookahead, lookbehind, backreference, `\p{}`) **beside a division on the next line**, `TrueKeyword`/`FalseKeyword`/`NullKeyword`, `undefined` as an **identifier** and `void 0`, `ObjectLiteralExpression` (shorthand, quoted, numeric, float, computed, template-computed, methods, generator, async, accessors, symbol key, `__proto__`, spread, trailing comma), `ArrayLiteralExpression` (holes, spread of a string, nested) |
| `cjs/expressions/operators.js` | CommonJS | runtime-bearing | `BinaryExpression` across arithmetic / comparison / strict and loose equality / logical / bitwise / all three shifts / `**` right-associativity; **every compound assignment including `??=`, `&&=`, `\|\|=`**; `PrefixUnaryExpression`/`PostfixUnaryExpression`; `ConditionalExpression` nested; `TypeOfExpression`, `VoidExpression`, `DeleteExpression`, `in`, `instanceof`, comma operator; `SpreadElement`; destructuring **assignment** (not declaration) in object, array, nested, member-target, swap and rest forms; `AwaitExpression`, `YieldExpression`, `yield*`; `MetaProperty` (`new.target`); optional chaining and `??` as operators |
| `cjs/expressions/calls-and-member-access.js` | CommonJS | runtime-bearing | `CallExpression` (plain, method, static, chained, through an index, parenthesised callee, comma-detached callee, spread, trailing comma, curried), `NewExpression` (with/without an argument list, of a variable, of a class expression, qualified, nested, spread, `Reflect.construct`), `SuperCall` and `super.method()`, `PropertyAccessExpression`, `ElementAccessExpression`, optional chaining in all three forms, `PrivateIdentifier` access and the `#x in obj` brand check, calls in every `edgeRole`, calls nested in parentheses and in `&&` |

**RULE THIS CATEGORY PINS.** One `ASSIGNMENT` kind covers every compound form,
with the operator in `operatorString` as a **column**. `operators.js` contains
`a += 1; b += 2;` on one line, which is the case where flat emission yields four
depth-0 rows and the engine-side pairing workaround **invents** the pair
`a` ↔ `2`. It also nests compound assignments inside parentheses, a ternary, a
call argument, a template substitution and an array element — five positions
where a subtree rooted at a non-emitting node has died in a real parser.

**NO ANALOGUE.** Java method references (`String::length`) — there is no `::`,
`js_method.methodReferenceKind` is a parity slot that stays `""`, and the real
analogue (passing the function value, and losing the receiver by doing so) is
covered instead. Java's qualified constructor invocation (`outer.new Inner()`)
and `this(...)` delegation have no form. Java char literals and numeric suffixes
(`1.5f`, `999L`) do not exist.

## Category 5 — `imports`

**Ported, but not to a directory of this name.** JavaScript has two import
systems and 83.6% of module edges are expression-borne, so the category is split
by system rather than kept as one file:

- **CommonJS** — `cjs/commonjs/`, 13 files (half two, below).
- **ESM** — `esm/`, 9 files (half two, below).
- **Module-system edges** — `mismatch/`, `ext/`, `pkg-absent-type/`,
  `exports-map/` (half two, below).

**NO ANALOGUE.** Java static imports and wildcard imports do not port; the
resolution models are unrelated. Java resolves against a classpath by
fully-qualified name; JavaScript resolves against the file system by specifier,
through a `package.json` that is frequently not in the repository at all.

## Category 6 — `local-variables`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/local-variables/local-variable-forms.js` | CommonJS | runtime-bearing | `VariableStatement` with `var`/`let`/`const`, multiple declarators, no initialiser; `ObjectBindingPattern` (plain, renamed, defaulted, renamed-and-defaulted, two-level nested, rest, computed key, quoted key, numeric key); `ArrayBindingPattern` (positional, hole, rest, defaults, nested, from a string, from a `Set`); bindings in a constructor, method, getter, setter, static method, `ClassStaticBlockDeclaration`, generator (before and after a `yield`), async body, every loop head, `CatchClause`, `CaseClause`; closure capture; three-level shadowing; local `class`, local function declaration and local class expression; one initialiser of each `initializerKind` |
| `cjs/local-variables/helper-values.js` | CommonJS | runtime-bearing | support module: `ClassDeclaration`, constructor function with prototype methods, frozen constant object, factory function, and a `@typedef` — so an importer can bind a local to a real type, an assignment-declared type, or a comment-only one |
| `cjs/local-variables/cross-file-locals.js` | CommonJS | runtime-bearing | locals whose types live in another file: `new` on an imported class, a call on a require alias, a call on a destructured import, a JSDoc `import('...')` type with no runtime evidence, an imported constructor function, imported constants, an assignment-declared class, a Node builtin (`AMBIENT_BUILTIN_TARGET`), and a reassigned binding |

`cross-file-locals.js` is where the schema's **three-hop IR completeness** story
is exercised: the declared name as written, `js_variable.initializerKind =
REQUIRE_CALL` with its `importLinkHash`, and `js_import.resolvedFilePath`. The
parser resolves nothing across the boundary and the row is complete anyway. This
is also the shape behind **34.4% of the oracle's declines** — the single largest
cause — so it is the highest-value call-graph fixture in half one.

**JAVA CORRESPONDENCE, with the false friends pinned.** Java's `final` local and
`const` agree (both freeze the binding, not the value). Java's `var` and
JavaScript's `var` are false friends: Java's is block-scoped type inference,
JavaScript's is function-scoped and hoisted. Destructuring has no Java form.

## Category 7 — `method-type-parameters`

**NO ANALOGUE.** JavaScript has no type syntax, therefore no type parameters,
therefore none on a method. The schema declares **no `js_type_parameter`
relation at all** and puts JSDoc `@template` (1,013 sites) in `js_type_reference`
with `contextKind = TEMPLATE`, explicitly declining to port `ts_type_parameter`
for comment-borne rows.

The construct is covered where it actually lives:
`cjs/jsdoc/callback-and-template.js` has `@template` on a function, on a class,
on a method **shadowing its class's**, with a constraint, with a sibling
constraint, with a default, and on a `@typedef` and a `@callback`.

## Category 8 — `methods`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/methods/method-kinds.js` | CommonJS | runtime-bearing | every `methodKind`: `FunctionDeclaration` (plain, async, generator, async generator), `FunctionExpression` (anonymous, **named**, async, generator, async generator), `ArrowFunction` (parens, no parens, no params, block body, async, arrow-returning-arrow on one line), `MethodDeclaration` (instance, static, async, static async, generator, async generator), `Constructor`, `GetAccessor`/`SetAccessor` incl. static, `PrivateIdentifier` method / static method / accessor, `ComputedPropertyName` method and static, well-known-symbol methods, `PropertyDeclaration` holding an arrow, `ClassStaticBlockDeclaration`, class expressions named and anonymous, a class declared inside a function, and every object-literal member form |
| `cjs/methods/parameter-forms.js` | CommonJS | runtime-bearing | `Parameter` in every `bindingForm`: identifier, defaults (incl. a default referencing an earlier parameter, a default that is a **call**, and one referencing the function itself), `RestParameter`, rest of an array pattern, `ObjectBindingPattern` (renamed, defaulted, two-level nested, rest, computed key, mixed), `ArrayBindingPattern` (holes, defaults, nested, rest), mixed patterns across two parameters, the same forms on arrows, async arrows, constructors, methods, a setter, a static factory, an object-literal method, a generator and an async function; `Function.length` vs the real parameter count; a function that ignores its parameters and reads `arguments` |
| `cjs/methods/constructor-patterns.js` | CommonJS | runtime-bearing | implicit constructor, implicit **derived** constructor (a `super(...args)` that appears nowhere in the source), explicit with defaults and rest, `SuperCall` incl. in both branches of an `if`, `super.method()`, a derived constructor that **returns another object**, the private-constructor replacement (a `#brand` checked at runtime), static factories as the overload replacement, the constructor-function forms of the same shapes, and `new.target` |
| `cjs/methods/arity-dispatch.js` | CommonJS | runtime-bearing | function redefinition (one name, two declarations, the second wins), dispatch by arity (`fs.readFile`, `app.listen`), by `typeof`/`Array.isArray`/`instanceof` (a DOM selector library's `select()`), by options object, by argument shape (a utility library's `get`), a class method doing all of it (`res.send`), two names for one implementation, and 19 call sites through them |

**NO ANALOGUE — overloading.** JavaScript has no overload sets: a second
declaration of a name replaces the first, there is exactly one callable per name,
and there is no signature-based dispatch at a call site. `arity-dispatch.js` is a
**negative port**: it covers what real code does instead, which moves the
dispatch into the body and out of the call graph entirely. The JSDoc `@overload`
tag claims otherwise and is a comment; it is in
`cjs/jsdoc/satisfies-and-unknown-syntax.js`.

**NO ANALOGUE.** `synchronized`, `native`, `strictfp`, `transient`, `volatile`,
`final` methods; the **instance** initialiser block (only `static {}` exists);
Java interface `default`/`static` methods (there are no interfaces); records;
generic constructors; `final` parameters and parameter annotations. TypeScript's
`this` parameter and parameter properties have no JavaScript spelling either —
`isParameterProperty` is a parity slot that stays `false`, and the `this` **type**
is a JSDoc tag.

## Category 9 — `type-parameters`

**NO ANALOGUE.** Same reason as category 7, at the declaration site: there is no
type syntax and no `js_type_parameter` relation. Java's use-site wildcards
(`? extends`, `? super`), bounded parameters and variance have nothing to port
to. `@template` coverage is in `cjs/jsdoc/callback-and-template.js`.

## Category 10 — `type-references`

**MOSTLY NO ANALOGUE, and the part that ports does not port to this category.**
JavaScript has no type annotations: 0.165% of parameters in the schema's corpus
carry a syntactic one and **all 64 of those are Flow, not TypeScript**. There is
no declaration-site type channel in the syntax at all.

`js_type_reference` therefore holds **JSDoc type expressions only**, and every
row in it has `isTypeOnly = true`. The coverage is in `cjs/jsdoc/`:

| what Java's `type-references` covers | where it is here |
|---|---|
| array types, nested generics | `param-returns.js` — `string[]`, `Array<string>`, `Promise<Array<Map<string, number>>>`; `typedef-only.js` — `Array<Object<string, Array<Header>>>` |
| interface refs, superclass refs | `extends-implements.js` — `@extends`, `@augments`, `@implements`, `@interface` |
| type-parameter bounds | `callback-and-template.js` — `@template {object} T`, `@template {keyof U} K` |
| wildcards | **no analogue** — no variance, no wildcards, nothing to express |
| `permits` refs | **no analogue** — no sealed hierarchies |
| the `THROWS_CLAUSE` reference context | **no analogue** — see category 2 |

The one JavaScript-specific addition, which Java has no version of: a type
reference whose **only evidence is a comment**, and a reference to a type
declared in another file by `import('./x').T` — a module edge inside a comment.

## Category 11 — `type-registry`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/type-registry/type-categories.js` | CommonJS | runtime-bearing | `ClassDeclaration` plain / extending a builtin / extending `EventEmitter` / with every member form; `extends` a **call** (mixin, `isComputedSuperclass`), a **member expression**, and an inline `require`; `ClassExpression` anonymous, named, immediately instantiated, in an array, and assigned to an export; constructor function with prototype members; a function that is *not* a type; `@typedef` and `@callback`; and **eleven controls that must not become types** — object literals, frozen objects, `Object.create(null)`, arrays of objects, factories, builtin instances, bound functions, arrows, symbols, and a namespace object holding a class |
| `cjs/type-registry/type-placement.js` | CommonJS | runtime-bearing | a type declared at module scope (exported and not), in a function body **closing over a parameter** (so one syntactic site is N runtime classes), in a block, in a loop, in a `catch`, in an IIFE, as a `static` field, in a `static {}` block, assigned onto a constructor, as an object-literal property, as an argument, as a return value, as an array element, in both branches of an `if`, and three arrow boundaries deep |

**NO ANALOGUE.** `interface`, `enum`, `record`, `@interface`, `final`,
`sealed`/`permits`, package-private access, and **inner (non-static) and static
nested classes**. Java's `Outer.Inner` is a type in a type's namespace;
JavaScript has no type namespace, so `Outer.Inner` is a static **property**
holding a class and the class itself is declared at whatever scope the expression
sits in. That is why `js_type` has no owning-type FK and `js_field` does, and
`type-placement.js` shows the shape rather than simulating the Java one.

## Category 12 — `integration`

| fixture | module system | nature | node kinds exercised |
|---|---|---|---|
| `cjs/integration/contracts.js` | CommonJS | **type-only** | `@typedef` (object, union with a nullable member, a repository contract expressed as a record of function types), `@callback`, `@template` `Result<T>` — consumed by three runtime-bearing modules and containing no statement |
| `cjs/integration/errors.js` | CommonJS | runtime-bearing | three-level `extends` hierarchy rooted at the builtin `Error`, `new.target` in a base constructor, `Error` `cause`, `Error.captureStackTrace`, `toJSON`, and the same hierarchy's **prototype-era** member (`Object.create(Error.prototype)` plus a borrowed method) |
| `cjs/integration/repository.js` | CommonJS | runtime-bearing | the whole assignment-declared vocabulary with real call sites through it: `util.inherits`, `EventEmitter.call(this)`, `PROTOTYPE_ASSIGNMENT` methods (async, async generator), a prototype **field**, `Object.defineProperty` getter, `STATIC_ASSIGNMENT`, `Object.assign(proto, {...})`, `module.exports = X` followed by a member; JSDoc `@constructor`/`@augments`/`@implements` and cross-file `import('...')` types |
| `cjs/integration/service-layer.js` | CommonJS | runtime-bearing | the modern half: destructured requires, a class with `#private` fields implementing a `@typedef` contract with no `implements`, a decorator-free caching wrapper, arity dispatch inside a method, try/catch/finally over an await, a closure returned from a method capturing `this` through an arrow, an async generator with an unbounded loop, a **conditional `require` inside a method body**, a getter, a composition root, and an export object built member by member |

The four files together put **one call site of each `receiverTypeSource`** in one
program: `LOCAL_CLASS`, `IMPORT_ALIAS`, `JSDOC` and `NODE_BUILTIN`.

---

# Half two — what neither Java nor TypeScript has

## CommonJS, exhaustively — `cjs/commonjs/`, 13 files

83.6% of module edges in the schema's corpus are expression-borne and **0 files
are mixed** — the partition is bimodal, not averaged. `js_import`/`js_export` are
minted in a second pass from `js_expression` rows, and every fixture here is
input to that pass.

| fixture | nature | node kinds / constructs exercised |
|---|---|---|
| `require-forms.js` | runtime-bearing | builtin, uninstalled bare package, scoped-and-called, relative, relative with extension, up-a-level, directory, side-effect-only, member-picked at the require site (`require('util').inherits`), two hops deep (`require('path').posix.sep`), a require as a **call argument**, `require.resolve`, `require.cache`, `require.main`, and the five CommonJS free variables (`__dirname`, `__filename`, `module`, `exports`, `require`) that no source line declares |
| `require-non-literal.js` | runtime-bearing | nine unresolvable specifiers: identifier, template with substitution, concatenation, `path.join`, member expression, ternary over two literals, **a template with no substitution as the control** (it *is* a literal and a parser that rejects every template gets it wrong the other way), `require` aliased to another name, and `module.require`. `specifierKind = NON_LITERAL`, `resolvedFilePath = ""`, plus a `js_parse_gap` — never a guess |
| `destructured-require.js` | runtime-bearing | one require, N bindings, one line: two names, renamed (three rows), two-level nested, default in the pattern, **object rest** (binds names that are not in this file), array destructuring, destructuring a member of a require, two requires in one `VariableStatement`, and a `let` destructure that is later reassigned. This is why `startColumn` is in `js_import`'s PK — without it these collide **by doubling** |
| `module-exports-assignment.js` | runtime-bearing | `module.exports = <function>` (a web framework's entry-module shape) with statics hung off the exported value afterwards, a `defineProperty` getter on it, and a prototype chain on it |
| `module-exports-members.js` | runtime-bearing | `module.exports.foo =` in eight shapes: anonymous function, **named function whose name disagrees with the export name**, arrow, plain value, object literal, identifier, class expression, **computed export name**, a nested property write that is *not* a module edge, and `Object.defineProperty(module.exports, ...)` with `enumerable: false` |
| `exports-shorthand.js` | runtime-bearing | `exports.foo =`, assignment through a local alias of `exports`, `Object.assign(exports, {...})` (N edges from one call), `exports` read as a value, and **reassigning `exports` itself** — after which every subsequent line is invisible to an importer, so a fact base recording them asserts exports that do not exist |
| `reexport-require.js` | runtime-bearing | `module.exports = require('./y')` in five shapes: a member of a require, named members re-exported one at a time from two different modules, a builtin re-export, a spread of a require (the names are in the other file), and a re-export with a non-literal specifier |
| `conditional-require.js` | runtime-bearing | twelve nested requires — function body, `if`, `try`/`catch` (the optional-dependency probe, where an unresolvable specifier is *intended*), lazy singleton for cycle-breaking, bare block, loop, three function boundaries deep, `\|\|` short-circuit, ternary, switch case and catch block, class method and static method, and a top-level IIFE (**`isTopLevel` false, `isConditional` false — two different questions**) |
| `export-overwrite-unconditional.js` | runtime-bearing | `exports.a =`, `module.exports.alsoA =` and a `defineProperty`, then an **unconditional** `module.exports = {}`, then edges that survive, an `exports.e =` that does not (the alias still points at the old object), and a **second** unconditional overwrite |
| `export-overwrite-conditional.js` | runtime-bearing | the same construct guarded six ways: `if` with no else, if/else where **both** branches overwrite, inside a `try`, inside a function body, inside a loop, and as a short-circuit and a ternary expression |
| `circular-a.js` / `circular-b.js` | runtime-bearing | a require cycle resolved by exporting before requiring on one side and deferring the require into a function on the other. The reason each is written that way is not in its syntax |
| `exports-array.js` | runtime-bearing | `module.exports = [...]` — `exportedValueKind` is neither `FUNCTION` nor `OBJECT_LITERAL` |

**The overwrite pair is the point.** The schema claims an overwrite only when it
is unconditional, and the two files are the same construct with different
reachability. A parser that treats a guarded overwrite as one deletes exports
that exist on the other branch; one that treats an unguarded one as conditional
keeps exports that do not exist. Either error looks correct in isolation, which
is why they ship as a pair.

## Module-system and script-kind edges

| fixture | module system | nature | what it is for |
|---|---|---|---|
| `mismatch/esm-under-commonjs/esm-syntax.js` | **ESM syntax, CommonJS config** | runtime-bearing, **cannot run** | `contradictionKind = ESM_SYNTAX_UNDER_COMMONJS`, measured at 6.2% of real files, all in this direction, all bundler input. `ImportDeclaration` (default, named, renamed, namespace, side-effect), `ExportDeclaration`, `ExportDefault`. `ts.createSourceFile` parses it happily; `node` refuses. The Q3 ruling is emit-and-flag, and this file is what makes that checkable — facts **and** the flag |
| `mismatch/esm-under-commonjs/mixed-both-systems.js` | **MIXED** | runtime-bearing, **cannot run under either** | `contradictionKind = MIXED`. Both `import` and `require` module edges in one file. The module-system-coherence gate (§7.3.4) needs a file that would violate its unflagged form in order to be able to fail |
| `esm/require-under-esm.js` | **CommonJS syntax, ESM config** | runtime-bearing, **cannot run** | `contradictionKind = REQUIRE_UNDER_ESM` — the direction the corpus measured **zero** times, because it is a hard `ReferenceError` rather than a bundler-tolerated one. Zero occurrences is exactly why the fixture must exist: an unemitted declared value is otherwise indistinguishable from a real gap |
| `esm/create-require.js` | ESM | runtime-bearing, runs | `importForm = CREATE_REQUIRE` — the sanctioned ESM→CJS bridge. Two `createRequire` results, one of them **not named `require`**, so a matcher keyed on the identifier finds nothing |
| `ext/esm-package/override.cjs` + `plain.js` | CJS by extension / ESM by package type | runtime-bearing | same directory, same `package.json`, two module systems, decided by three characters of file name. `moduleSystemSource = EXT_CJS` vs `PKG_TYPE_MODULE` |
| `ext/cjs-package/override.mjs` + `plain.js` | ESM by extension / CJS by package type | runtime-bearing | the mirror. `EXT_MJS` vs `PKG_TYPE_COMMONJS`, plus top-level await and `import.meta` |
| `pkg-absent-type/defaulted.js` | CommonJS **by default** | runtime-bearing | `PKG_TYPE_ABSENT_DEFAULT` — 76.0% of the corpus. Same `moduleSystem` as `ext/cjs-package/plain.js` for a **different reason**, and one of the two becomes an ES module the day a line is added to a file it does not contain |
| `exports-map/` (8 files + `package.json`) | ESM, with `.cjs` members | runtime-bearing | `exports` map with `types`/`import`/`require`/`node`/`browser`/`default` conditions, an `imports` map with a `#`-prefixed specifier and a wildcard pattern, a subpath export, `./package.json` self-export, a relative path that deliberately **bypasses** the exports map, a dynamic import of a subpath, and a `#`-specifier that is **not** in the map (a hard failure with no node_modules fallback) |
| `jsx/component.jsx` | CommonJS | runtime-bearing | JSX in an unambiguous extension: `JsxElement`, `JsxSelfClosingElement`, `JsxFragment` both spellings, `JsxAttribute` / `JsxSpreadAttribute` / `JsxExpression`, member-expression tag, text and entity children, **calls inside braces** (the case that lost 4,488 of one application's 14,335 TypeScript call sites), an arrow returning JSX inside a brace, and a class component |
| `jsx/component-in-js.js` | CommonJS | runtime-bearing | the same JSX in a plain `.js`, **with `<`, `>` and `<<` used as operators in the same file**. The schema rules `scriptKind` provenance-only because 0 of 2,942 files parsed differently between `JS` and `JSX`; this file is the two-sided test of that claim, and `hasJsxContent` is recorded *after* parsing rather than guessed from the extension |
| `esm/imports/import-forms.js` | ESM | runtime-bearing | every declaration-borne form: default, named, renamed, default+named, namespace, side-effect-only, `node:` and bare builtin spellings, an uninstalled package, a barrel, and dynamic `import()` (awaited, destructured, non-literal specifier, conditional, and unawaited as a Promise) |
| `esm/imports/pkg/index.js` | ESM | runtime-bearing | a barrel: `export {} from`, renamed, `export { default as }`, `export { default }`, `export *`, `export * as ns`, and a re-export whose target does not exist |
| `esm/imports/pkg/util.js`, `side-effects.js` | ESM | runtime-bearing | named exports of every declaration kind plus a default; and a module with **no exports at all**, imported for its top-level effect (`bindingForm = SIDE_EFFECT_ONLY`, both names `""`) |
| `esm/exports/export-forms.js` | ESM | runtime-bearing | `export const/let/var/function/async function/function*/class`, export lists with and without renaming, **one name exported twice under two names**, `export default` of an expression, and a **string-named export** (`export { x as 'not-an-identifier' }`) |
| `esm/import-meta.js` | ESM | runtime-bearing | `MetaProperty` `import.meta` — not a member access on an object, because `import` is a keyword; `import.meta.url`, `import.meta.resolve` (a resolver call that is Node's answer rather than tsc's model of it), and a host-specific property that may not exist |
| `esm/top-level-await.js` | ESM | runtime-bearing | `hasTopLevelAwait`: await at module top level, awaited dynamic import, await in a loop, in a ternary initialiser and in a `try` at depth 0, and a nested non-async function that cannot use it |

## Prototype-based everything — `cjs/prototypes/`, 7 files

The §3 defect class in its purest form: every construct here emits trivially as
an expression and the **structure** — that a type gained a member, or a
superclass — is absent unless something mints it.

| fixture | nature | node kinds / constructs exercised |
|---|---|---|
| `constructor-function.js` | runtime-bearing | `typeCategory = CONSTRUCTOR_FUNCTION`: `this.x =` fields in a constructor (incl. a **conditional** one and a per-instance method), the forgotten-`new` guard, a declared constructor function with no prototype members at all (its only evidence is a `new` elsewhere), one assigned to a `var`, a **named function expression** (two names, one of them private), a factory returning an object literal as the control, and `new` in seven forms — plain, no argument list, through a variable, through a member, on a runtime-chosen constructor, and `Reflect.construct` |
| `prototype-assignment.js` | runtime-bearing | `PROTOTYPE_ASSIGNMENT` methods (named function expression, anonymous, **an arrow whose `this` is lexical and therefore wrong**, an existing function installed under two names, generator, async, computed name, `Symbol.iterator`), prototype **fields** (incl. a shared mutable array), `STATIC_ASSIGNMENT` (more common than the prototype form at 521 sites), `PROTOTYPE_OBJECT_LITERAL` (which discards everything assigned above it, including `constructor`), a member added after that replacement, reads of the prototype as controls, and a write **through an alias** whose target does not contain the word `prototype` |
| `object-assign-prototype.js` | runtime-bearing | `OBJECT_ASSIGN_PROTOTYPE`: N members from one call where the names are keys of an **argument**; mixing in `EventEmitter.prototype` (a **copy**, not a link — `instanceof` stays false); a mixin factory so the callee is not `Object.assign`; object spread as the replacing variant; and the **unnameable** case where the source is a required module or a runtime-computed value, plus `Object.assign` onto a plain options object as the control |
| `define-property-accessors.js` | runtime-bearing | `OBJECT_DEFINE_PROPERTY`: getter-only, getter+setter, setter-only, a **data** property with `writable: false`, non-enumerable, ES2015 shorthand descriptors, `Object.defineProperties` (N members, one call), a computed member name, `defineProperty` on `module.exports` (the same call, but an export), and ten property **reads** that execute a function body |
| `util-inherits.js` | runtime-bearing | an `extends` edge as a **call**, with no `extends` token in the file: `util.inherits`, the destructured `inherits` alias, a two-level chain, the hand-rolled `Object.create(Super.prototype)` + `constructor` repair, `Object.setPrototypeOf` on both the prototype **and** the constructor (static inheritance, a second edge), a supertype that is a call result (`isComputedSuperclass`), a supertype that is an inline `require`, an ES6 class extending a constructor function, and a constructor function inheriting from a class |
| `object-create-chain.js` | runtime-bearing | `Object.create(null)` (a dictionary, not a type), `Object.create(proto)` (a real heritage edge whose subtype is an **object**), a three-level literal chain with property shadowing, `Object.create(proto, descriptorMap)` — one call that links a prototype **and** declares members — the OLOO factory, `__proto__` in a literal as the fourth spelling of the link, and runtime re-linking |
| `iife-module.js` | runtime-bearing | `IIFE_CALL` (113 sites): both parenthesisations, the **UMD head** (a conditional module edge choosing between three module systems in expression position), the dependency-injection form with a longer parameter list than argument list, the `!`/`+`/`void` punctuations that need no parentheses at all, a recursive named function expression, an arrow IIFE and an async one, and a parenthesised function expression that is **not** invoked as the control |

## JSDoc as the type channel — `cjs/jsdoc/`, 6 files

0.165% of parameters carry a syntactic annotation; 36.4% carry a JSDoc one. This
is where declared types live.

| fixture | nature | tags and constructs exercised |
|---|---|---|
| `typedef-only.js` | **type-only** | `@typedef` object with `@property` (optional, nullable `?`, non-nullable `!`, recursive), union, intersection, function-type, `@template` generic, **`import('./x').T`** (a module edge inside a comment), a typedef of a type nothing declares, tuple / `Object<K,V>` / three-deep nested generic, `function(this:T, x=, ...n): *`, `*`, `?`, `@enum`. **No statement in the file** |
| `param-returns.js` | runtime-bearing | `@param` (plain, optional, defaulted-in-the-comment, rest, **a name no parameter has**, dotted names for a destructured object), `@returns`/`@return`/`@yields`/`@throws`, `@this`, fourteen type-expression shapes in one signature, `@type` on `let`/`const`/a `Map`/a function value/a destructuring/three `this.x` fields, and the **inline cast** `/** @type {T} */ (expr)` — the only place JSDoc annotates something that is not a declaration |
| `callback-and-template.js` | runtime-bearing | `@callback` (error-first, with a return type, **generic**, with `@this`), `@template` on a function, two on one tag, **constrained** (`@template {object} T`), with a **default** (`@template [T=string]`), on a class, on a method **shadowing its class's**, constrained by a **sibling** parameter, and on a recursive generic `@typedef` |
| `extends-implements.js` | runtime-bearing | `@interface` (a class whose methods are signatures), an interface as a `@typedef`, `@extends`+`@implements` agreeing with the code, `@extends` on a class whose `extends` clause is a **call** (the comment supplies what syntax cannot), `@constructor`+`@augments` on a constructor function, **`@lends`** (a comment that retargets every declaration in the expression it annotates), `@implements` of an imported interface, `@implements` of a name nothing declares, and `@abstract` |
| `contradicting-jsdoc.js` | runtime-bearing | **every comment disagrees with its code**: arity, parameter names, optionality, type, rest-vs-`arguments`, `@returns` on a function that returns nothing, `@async`/`@generator` on neither, `@extends` naming a different class than the code, `@implements` of an interface the class does not satisfy, `@type {number}` on a string, `@readonly` on a reassigned binding, a `{@link}` to a missing symbol, a **detached** comment, and **two JSDoc blocks on one declaration** |
| `satisfies-and-unknown-syntax.js` | runtime-bearing | `@satisfies` on a declaration and in the inline-cast position, `@enum`, `@const`, `@default`, **`@overload`** (three claimed signatures, one function), and then the dialect boundary: Closure-only `function(new:Date, n)`, `!`/`?` prefixes, trailing commas, `=` optional suffix; TypeScript-only conditional, mapped, template-literal and indexed-access types; **genuinely malformed** types (unbalanced brace, empty, prose, truncated) that must yield one `UNKNOWN_SYNTAX` row with the text preserved plus a parse gap; an unknown **tag** carrying a well-formed type (a different problem from unknown type syntax); inline `{@link}` markup that is not a type; and a `//` comment and a single-star block comment containing tags, which are **not** JSDoc |

## Hoisting and binding — `cjs/hoisting/`, 8 files

The relation with no `ts_*` analogue. This is the Python port, not the
TypeScript one.

| fixture | nature | constructs exercised |
|---|---|---|
| `var-hoisting.js` | runtime-bearing | the two scope columns: `var` declared in a block and visible outside it, read before its declaration (`undefined`, **not** a ReferenceError — the difference from a TDZ), declared twice in one function, in `if`/`for`/`try`/`catch`/`switch` bodies, **not** escaping a nested function, shadowing a parameter, an **unreachable** declaration whose binding still exists, `var` in for-in/for-of heads surviving the loop, a `let` beside it as the control, and the fact that a CommonJS module scope **is** a function scope |
| `tdz.js` | runtime-bearing | a `const` that shadows an outer name of the same name and is therefore unreadable above its declaration; `typeof` **not** protecting a TDZ binding; `CLASS_TDZ`; a class expression assigned to a `const`; per-iteration `let` bindings; mutual references deferred through closures; `const` freezing the binding and not the value; a `let` with no initialiser; `CATCH_PARAMETER` shadowing a module const; and an optional catch binding that declares nothing |
| `function-decl-vs-expression.js` | runtime-bearing | `HOISTED_FULLY` vs `NOT_HOISTED`: a declaration called above its own text; a `var` function expression called early (**TypeError**) beside a `const` one (**ReferenceError**) — same construct, different error, one keyword apart; the named function expression's private inner name; a block-level declaration whose binding differs between strict and sloppy; two declarations of one name; a declaration colliding with a `var`; generator/async/async-generator declarations; and function expressions in argument, property, element, return, ternary and default positions |
| `closures-over-loops.js` | runtime-bearing | one loop, two keywords, two programs: `var` (one shared binding, every closure sees `3`) vs `let` (one binding per iteration); the pre-ES2015 IIFE workaround and the `.bind` workaround; `const` in a for-of head; `var` in a for-in head; async captures resolving after the loop; a nested loop capturing both counters; a closure capturing a **binding** and observing a later mutation; and a counter factory that writes to its capture |
| `this-by-call-form.js` | runtime-bearing | one function, six values of `this`: bare call, method call, **detached** method, `.call`/`.apply` (receiver as `FIRST_ARGUMENT`), `.bind` (and the fact that binding twice does not rebind), and `new`; then computed call, optional call, passed as a callback, tagged template with and without a receiver; `var self = this` vs the nested-function trap in a constructor; `Array.prototype.map`'s `thisArg`; a class body being strict inside a sloppy file; and **module-level `this` being `module.exports`** in CommonJS and `undefined` in ESM |
| `arrow-lexical-this.js` | runtime-bearing | `bindsThis = false`: lexical `this` as the **absence** of a binding, not a special rule; an arrow inside a method vs a plain function in the same position; the per-instance bound-handler idiom; three nested arrows resolving at one boundary; an arrow at module level; an arrow as an object-literal property (`this` is *not* the object) beside a shorthand method; `.call`/`.bind` being **accepted and ignored**; an arrow reading the enclosing function's `arguments`; an arrow having no `prototype` and no `[[Construct]]`; concise vs block bodies; every parameter form; and two arrows on one line |
| `sloppy-implicit-global.js` | runtime-bearing | **no `'use strict'`, deliberately.** `GLOBAL_IMPLICIT`: assignment to an undeclared name at module level and inside a function; the `var a = b = c` chained-assignment typo; Annex B block-level function declarations creating a function-scoped `var` **as well**; sloppy `arguments` aliasing its named parameters; a legacy octal literal and octal escape (**syntax errors under `'use strict'`**, so the directive is a parse-time input); `delete` on an unqualified name; a function whose body is strict inside a sloppy file; and a class body that is strict regardless |
| `with-statement.js` | runtime-bearing | **no `'use strict'`, and it cannot be an ES module.** `WITH` scope kind, `hasWithStatement`, `WITH_STATEMENT_SCOPE` parse gap: a template-engine-style render body where every free name may be a property of the subject; a name shadowed by a with-subject property; an **inherited** property found by `with` (so enumerating own keys does not bound the captured names); a computed subject; a closure declared inside a with-body that carries the unresolvability out with it; and nested `with` |

## Call forms syntax cannot decide — `cjs/call-forms/`, 7 files

| fixture | nature | constructs exercised |
|---|---|---|
| `call-apply-bind.js` | runtime-bearing | `receiverPosition = FIRST_ARGUMENT` (1,048 sites): `.call` with and without arguments and with `null`; `.apply` with a literal array, a variable and `arguments` (so **argumentCount is not the arity**); `.bind` (no invocation here), partial application, binding a bound function, and `new` on a bound function **overriding** the bound receiver; borrowed methods (`Array.prototype.slice.call(arrayLike)`, `Object.prototype.hasOwnProperty.call`, `Math.max.apply`); `Function.prototype.call.bind` uncurrying (three levels of indirection from the function that runs); `Reflect.apply`; spread as the modern replacement; and the prototype-era super-method call |
| `computed-and-optional-calls.js` | runtime-bearing | `COMPUTED_CALL` (663 sites): a **string literal key as the control**, a variable, a concatenation, a member expression, a dispatch-table loop, a numeric index, a symbol key, a doubly-computed receiver, and a computed read that is not a call; `OPTIONAL_CALL` (28 sites): optional member then call, optional call, optional computed call, a short circuit that skips argument evaluation, an optional call on a null variable, a partially-guarded chain, and `??` beside `?.`. Records that `new a?.b()` and ``a?.b`x` `` do not parse, so no fixture can contain them |
| `accessor-invocation.js` | runtime-bearing | `GETTER_INVOCATION`/`SETTER_INVOCATION`, **reserved**: accessors declared in a class (incl. static and computed), an object literal and by `defineProperty`; then invocations that are not calls — read, derived read, write, static read, **destructuring**, **spread** (N invocations from one token), `Object.assign`, `JSON.stringify`, compound assignment (getter *and* setter), `++`, optional chaining, computed read, and reads in template / condition / argument / return positions; the proof pair (`plain.value` and `lazy.value` are the same expression shape and one runs code) and the same object gaining a getter at runtime; plus `getOwnPropertyDescriptor` reading the getter **without** invoking it |
| `proxy-traps.js` | runtime-bearing | `PROXY_TRAP_CALL`, **reserved**: `get`, `set`, `has`, `deleteProperty`, `ownKeys`, `getOwnPropertyDescriptor`, `defineProperty`, `getPrototypeOf` traps invoked by ordinary property syntax, `in`, `delete`, `Object.keys` and spread; a method call through a proxy being **two** operations; `apply` and `construct` traps on a proxied function; an autovivifying proxy where no static claim about which properties exist can be correct; `Proxy.revocable`; and identical expressions against the raw target as controls |
| `dynamic-code.js` | runtime-bearing | `DYNAMIC_CODE_CALL`, `isDynamicCode`: **direct** eval reading a local and creating a binding, vs four spellings of **indirect** eval (`geval(...)`, `(0, eval)(...)`, `globalThis.eval(...)`, `eval?.(...)`) that see only global scope — expressions differing by punctuation with different scope effects; `new Function` and `Function` without `new`; the `new Function('return this')()` globalThis shim; a template compiler assembling a body from data; `setTimeout` with a **string** argument beside the same call with a function; and five controls (`JSON.parse`, `Number`, `new RegExp`, `String.raw`, a local named like eval) |
| `tagged-templates.js` | runtime-bearing | `TAGGED_TEMPLATE_CALL` (20 sites): a call with **no parentheses**, zero / one / several / adjacent substitutions, a call inside a substitution, multiline; a member-expression tag, a computed tag, a **call** as the tag (the CSS-in-JS signature), `String.raw`, and a tag held in a reassigned variable; plus untagged templates (nested, multi-substitution) as the control that must **not** mint a call site |
| `generators-and-iterators.js` | runtime-bearing | `GENERATOR_RESUME`, **reserved**: generator declaration with a value **sent in** by `next(v)` (data flowing backwards through a `yield`), `yield*` delegation, generator methods / static / prototype-assigned, an async generator; explicit resumption via `next`, `return` and `throw`; **implicit** resumption via `for...of`, destructuring, spread, `Array.from`, `new Set` and `for await`; and a hand-written iterator with the same protocol and no generator anywhere, which is why the distinction cannot be drawn from the call site |

## Added after the first coverage sweep — `flow/`, `cjs/directives/`, and two more

Seven fixtures written to close enum values that the first sweep against the
parser showed carrying **zero rows across the entire corpus**. An enum value with
no fixture cannot be told apart from an unimplemented one (§4 of
`BUILDING-A-PARSER.md`), so each of these closes a hole in the audit rather than
adding volume.

| fixture | module system | nature | node kinds / constructs exercised | closed |
|---|---|---|---|---|
| `flow/flow-pragma.js` | ESM (`flow/package.json`) | runtime-bearing, **runs** | `/* @flow */` with **no annotation syntax** — the comment-only Flow dialect (`/*: T */`, `/*:: … */`) that exists so Flow code ships without a build step. A **third** type-comment dialect beside JSDoc and TypeScript's | `FLOW_PRAGMA`, `hasFlowPragma` |
| `flow/flow-annotations.js` | ESM (`flow/package.json`) | runtime-bearing, **cannot run** — Flow's inline syntax is stripped by a build step | inline Flow annotations, split into the half that **overlaps TypeScript** (identical spelling, different language — recording it as TypeScript is the mistake `declaredTypeSource` prevents) and the half that is **Flow only**: `?T` maybe types, `{\| \|}` exact objects, `$Shape`, `mixed`, `+`/`-` variance sigils, `opaque type`, `import type` | `SYNTACTIC_FLOW`, `FLOW_SYNTAX` |
| `cjs/directives/cli-entry.js` | CommonJS | runtime-bearing | a **shebang** — the one comment form whose POSITION is load-bearing: legal only as the first two bytes, and `ts.createSourceFile` gives it its own trivia kind | `SHEBANG` |
| `cjs/directives/directive-comments.js` | CommonJS | runtime-bearing | `// @ts-check`, `@ts-expect-error`, `@ts-ignore`, `eslint-disable`, `istanbul ignore`, and a directive-**looking** comment that is prose. The source-map footer was moved out of this file — see the pair below and Findings 6 | `TS_CHECK` |
| `cjs/directives/source-map-footer-short.js` + `source-map-footer-long.js` | CommonJS | runtime-bearing | **a paired repro, not two fixtures.** Identical trailing source-map footer, differing only in length (2,078 B and 12,298 B), receiving **opposite** `sourceProvenance` verdicts — `GENERATED_MONOLITH` and `PROJECT`. Neither is generated | `SOURCE_MAP` |
| `cjs/directives/no-check.js` | CommonJS | runtime-bearing | `// @ts-nocheck` as the **first** comment (moving it three lines down silently disables it), over JSDoc that contradicts its code — the same contradiction as `jsdoc/contradicting-jsdoc.js` but **declared unchecked**, so a fact base that cannot tell the two apart asserts one of them was verified | `TS_NOCHECK` |
| `cjs/expressions/deep-nesting.js` | CommonJS | runtime-bearing | **GENERATED — the only generated file in this corpus**, because its content is a depth no human writes deliberately. Five shapes past the depth-32 cap by different routes: binary chain 45, ternary ladder 39, member chain 39, nested calls 35, nested arrays 37. Real provenance: minified output, generated parsers, long `&&` guard chains | `DEPTH_CAP_REACHED`, `isTruncated` |
| `cjs/prototypes/bound-members.js` | CommonJS | runtime-bearing | a member whose value is the **result of `.bind()`**: the class-component constructor-rebinding idiom, a prototype member bound at its declaration site, a bound static, partial application at the declaration site, a bound class field, and an arrow doing the same thing as the LEXICAL contrast | attempted `BOUND` — see Findings 7 |

`cjs/parse-gaps/README-parse-error.md` is not a fixture. It records why
`PARSE_ERROR` has no dedicated one and asks for the ruling that would let it have
one, rather than shipping a file that does not parse into a tree five other
agents sweep.

## Flow — DETECTION coverage, under the out-of-scope ruling

**Schema §2.6 (ruled 2026-09-12) puts Flow out of scope.** A Flow file emits
exactly one `js_module` row with `sourceProvenance = FLOW_EXCLUDED` and
`hasFlowPragma = true`, and nothing in any other relation. So every fixture here
tests the **detector**, never the language. `flow/README-detection.md` carries
the full argument; this is the index.

**`FLOW_EXCLUDED` is not implemented yet** — it exists in the schema and not in
`src/`. Every measurement below is therefore of the *pre-ruling* behaviour, which
is exactly what these fixtures are for: they say what should happen, and the
current output is the gap.

### The detector, and what it is

`hasFlowPragma` is `/@flow\b/.test(sourceText.slice(0, 2_048))`. Pragma only —
there is **no extension check**, and `JS_SOURCE_EXTENSIONS` is
`['.js', '.jsx', '.mjs', '.cjs']`.

### `detection/` — the detector must fire, and does

Five single-purpose files, each a pragma spelling that a naive detector misses.
All five verified **FIRES**.

| fixture | spelling it defends |
|---|---|
| `line-pragma.js` | `// @flow` on line 1 — the canonical form |
| `block-pragma.js` | `/* @flow */` — what Flow's own upstream source uses |
| `jsdoc-pragma.js` | the pragma inside a JSDoc block **surrounded by other tags**, which defeats a first-line-of-first-comment check |
| `strict-pragma.js` | `// @flow strict-local` — a **mode suffix**. Flow has `@flow`, `@flow strict`, `@flow strict-local` and `@flow weak`, and an exact-string match catches only the first |
| `after-shebang.js` | the pragma on line **2**, because a shebang must be line 1. Every Flow-typed CLI entry point looks like this |

### `detection-miss/` — the detector cannot fire

| fixture | why it misses | verified |
|---|---|---|
| `no-pragma.js` | Flow syntax, **no pragma**, ordinary `.js`. Nothing to detect. Uses only the **silent** half of Flow — measured zero diagnostics — so no parse gap can flag it either. **This is the only fixture in the corpus that can make `SYNTACTIC_FLOW` fire**, and without it a gate asserting zero passes vacuously forever | MISS, **6** `SYNTACTIC_FLOW` params |
| `after-long-licence.js` | the pragma sits at **byte 2,317**, past the 2,048-byte window, behind an Apache-2.0 banner. A widely-copied house style puts the pragma at the END of a copyright block | MISS, **1** `SYNTACTIC_FLOW` param |

### `false-positive/` — the detector must NOT fire, and does

Under §2.6 exclusion is load-bearing, so a false positive **silently deletes a
real JavaScript file** — its functions, call sites and imports all vanish, and
`FLOW_EXCLUDED` makes the deletion look deliberate. That is the mirror image of a
miss and equally invisible to a count.

| fixture | the trigger | verified |
|---|---|---|
| `mentions-flow-in-prose.js` | one migration-note comment. The most likely place for the word to appear is where someone writes down why a file is *not* typed yet | **FIRES** at byte 1,472 |
| `flow-scoped-package.js` | a **scoped package specifier**. `/` is a word boundary, so `@flow\b` matches inside an import path, a string and a template | **FIRES** at byte 982 |

Both headers are written **without** the token, so each file's trigger is
attributable to exactly one deliberate place.

### `libdef.js.flow` — the extension route, which does not exist

§2.6 names two detection routes: a pragma, **or a `.js.flow` extension**. There
is no extension check, and `.js.flow` is not in `JS_SOURCE_EXTENSIONS`, so the
file is **never walked** — zero rows, not even a module row. That is not the same
outcome as exclusion, and the ruling is explicit: the module row "records that
the file was seen, identified, and declined. It is countable, it is greppable."
A file that is never scanned cannot be counted, so `js-corpus` cannot size the
population. Findings 12.

### The six pre-ruling fixtures, repurposed

Written when the assignment was Flow *language* coverage. All six carry a pragma,
so all six are kept as detection cases — and they are the **strongest** in the
set, because their payloads are large and hostile. Measured, pre-exclusion:

| file | what comes back if the detector misses it |
|---|---|
| `declare-statements.js` | **14 `js_method` rows**, 13 of them `bodyPresence = NO_BODY` — type-only declarations in the call graph, gate §7.1 |
| `casts.js` | **4 `js_parse_gap` rows sharing one primary key**, gate §7.2 — see Findings 13 |
| `recovery-mangling.js` | **63 top-level statements out of ~25 written**: 32 phantom `ExpressionStatement`s, 4 detached `Block`s, 53 diagnostics |
| `silently-typed.js` | 28 `SYNTACTIC_FLOW` params and **0 diagnostics** — the silent half |
| `flow-annotations.js` | 12 `SYNTACTIC_FLOW` params, 22 gaps |
| `flow-pragma.js` | comment-only Flow (`/*:: */`), which runs unmodified |

A purpose-built exclusion test would have an empty body and prove nothing. These
fail loudly, in gated relations.

**Not sourced from any held-back corpus.** The Flow-detector holdout has not been
cloned, read or counted. Everything here is written from Flow's own
documentation.

## JSX tag names — the five forms, and why "capitalised = component" is wrong

`js-impl`'s recall harness found **833 JSX tag names emitting nothing**, and what
a tag name *is* is going to `js-oracle` as a schema question. These two fixtures
exist so whatever is ruled has something that can fail.

| fixture | nature | what it carries |
|---|---|---|
| `jsx/tag-forms.jsx` | runtime-bearing | **22 distinct tag names, 34 elements, 0 diagnostics** — every form in one file so the discrimination is forced rather than inferred across fixtures |
| `jsx/unterminated-element.jsx` | runtime-bearing in intent, **does not compile** | the corpus's only non-Flow `PARSE_ERROR`. See Findings 16 |

**The rule JSX actually uses is syntactic, not semantic**, and the common
shorthand — "capitalised or dotted tags are references" — is wrong in **three**
directions. Stated precisely:

> A tag is a **value reference** iff its name is a **member expression**, or a
> simple identifier that is a **valid ECMAScript identifier** not beginning with
> a lowercase ASCII letter. Everything else that is a simple name is an
> **intrinsic** and compiles to a string. A **namespaced** name is a third form.

The validity clause is not pedantry: `ts.isIdentifier()` returns **true** for
both `my-element` and `Foo-Bar`, so a rule written as
*"isIdentifier && begins lowercase = intrinsic"* — the obvious implementation —
gets `Foo-Bar` wrong and mints a reference to a binding that cannot exist.

| form | example in the fixture | what it is |
|---|---|---|
| bare lowercase identifier | `div` `span` `a` `br` `h1` `input` `li` `use` | **intrinsic** — compiles to the string `"div"`, references no binding |
| hyphenated, lowercase | `my-element` `ion-button` | **intrinsic** — `-` cannot appear in an identifier, so it can only be a string |
| hyphenated, **capitalised** | `Foo-Bar` | **intrinsic**, and the case the shorthand gets wrong in its third direction. `ts.isIdentifier()` is true, the first letter is uppercase, and it is still a string — no binding named `Foo-Bar` can be declared in JavaScript |
| bare capitalised identifier | `Button` `Host` `NotDeclaredAnywhere` | **value reference** |
| bare identifier, not a lowercase ASCII letter | `_Private` `$Dollar` | **value reference** — `_` and `$` are not lowercase letters, so the intrinsic rule does not apply |
| member expression | `Modal.Header` `Modal.Body.Inner` `View.Fragment` `this.Slot` **`widgets.panel`** | **value reference** — and `widgets.panel` is lowercase, which is the case that breaks "capitalised = component" |
| namespaced | `svg:circle` | **a third form**, neither intrinsic nor reference; most transforms reject it |

Five discriminators the file is built around, each of which fails a plausible
wrong implementation:

1. **`const div = function ShadowingDiv() {}` is in scope**, and `<div />` must
   NOT resolve to it. If it does, the rule was implemented as resolution rather
   than as syntax — the sharpest single test in the file.
2. **`<NotDeclaredAnywhere />` is in no scope at all** and throws `ReferenceError`
   at runtime. That is the proof a capitalised tag really is a name lookup; an
   extractor emitting nothing loses the only evidence the reference existed.
3. **`<Button></Button>` writes the name twice.** One element — one reference, or
   two? A walker that visits the closing element double-counts every
   non-self-closing component, and 11 of the 33 elements here have a closing tag.
4. **Attribute names are never references** — `className`, `data-testid`,
   `aria-label`, `xlink:href` — but a **spread** is: `{...rest}` is a real read.
5. **`<Foo-Bar />` is capitalised and still not a reference.** The only case that
   defeats both the shorthand *and* the obvious `isIdentifier` implementation of
   the corrected rule.

Also covered: the anonymous fragment `<>` (no tag name at all) beside the named
`<View.Fragment>` (a member reference), tags in attribute values, tags returned
from an arrow inside an attribute, and tags in both arms of a ternary.

**Not sourced from any held-back corpus** — the Flow-detector holdout is now the
only instrument that can see pragma-less Flow. These are written from a UI
library's documented API shapes (`<Modal.Header>` is a compound-component API).

## Two fixtures written against columns that do not exist yet

Both were written before the code they discriminate, so the column has something
that can fail on the day it lands rather than a corpus that happens to agree.

### `cjs/methods/parameter-references.js` — for `resolvedParameterLinkHash`

A reference naming a parameter currently reaches nothing: 137,960 references to a
parameter of their own method, 15,382 more one scope up. The column is an FK to
`js_method_parameter`, and **the hard part is knowing when NOT to link** — the
obvious implementation, *"an identifier whose name matches a parameter of an
enclosing method"*, is wrong in nine of the cases below.

| section | case | must link to |
|---|---|---|
| 1 | reference in the parameter's own body | the parameter |
| 2 | closure reference one scope up — never referenced in the owner's body | the parameter, across a method boundary |
| 3 | referenced only inside a nested arrow, three boundaries deep | the parameter |
| 4a | a **block-scoped local** of the same name | **the local** |
| 4b | a nested function whose own parameter shadows the outer | **the inner parameter** |
| 4c | a **catch parameter** shadowing a function parameter | **the catch parameter** |
| 4d | **`var` redeclaring a parameter** — the same binding, not a shadow | **the parameter, still** |
| 4e | a parameter shadowing a module-level `const` of the same name | the parameter |
| 5a–5c | defaulted, a default **referencing an earlier parameter**, rest | the parameter |
| 5d | `OBJECT_PATTERN` — one row with `name = ""` plus N variables | **open question**, see below |
| 5e–5f | `ARRAY_PATTERN` with a hole and a nested pattern; a pattern referenced from a closure | |
| 6a | `arguments` | **nothing** — no declaration exists |
| 6b | a free identifier sharing a name with a *sibling* function's parameter | **nothing** |
| 6c–6d | `obj.direct` property access, and an object-literal **key** beside a shorthand | **nothing** / the shorthand only |

**5d posed a question that is now ruled — and my premise for it was wrong.** I
wrote that a destructured parameter mints "one row plus N `js_variable` rows".
It does not: `emitVariables()` skips every PARAMETER-regime binding, so **no
parameter mints a `js_variable` row at all**. Verified —
`js_variable.bindingRegime = PARAMETER` counts **0** corpus-wide, and my own
earlier sweep already showed it while I read the regime off
`js_method_parameter` instead. The schema's §3.5 claimed otherwise and has been
corrected; the emitter was right.

The consequence is sharper than the version I posed: the bound names exist in
the fact base **only as references**, so `resolvedParameterLinkHash` is identical
for `alpha` and `beta` and nothing else can tell them apart. A **binding-path
column on the reference row** is being appended, and
`cjs/methods/pattern-binding-paths.js` carries its discriminators — 22 functions
covering renamed keys (`{wire: local}`, where the reference is `local` and the
path is `wire`), three-deep nesting, defaults incl. one reading an earlier
sibling, object rest and array rest (**complements, not paths** — the set is not
in the file), array indices, a **hole** that shifts every later index, mixed
object/array routes (`rows.0.cell`), computed and symbol keys (**not knowable
from syntax**), and four controls where a simple parameter must have no path
at all.

Measured at `2d5a4dc`: 23 parameters, 30 variables, 63 named references,
`bindingResolution` spread across `LOCAL` 34, `MODULE` 21, `CLOSURE` 3,
`GLOBAL_BUILTIN` 3, `UNRESOLVED_FREE` 2. `resolvedParameterLinkHash` is not yet
a column.

### `cjs/jsdoc/nested-params.js` — for the dotted and bracketed `@param` forms

`cjs/jsdoc/param-returns.js` already contained dotted `@param` names and **did
not catch the defect**, because its dotted tags hang off a destructured parameter
and the row came out empty rather than wrong. Having the construct is not the
same as discriminating on it, which is why this is a second file.

**Measured, and two things differ from how the defect was described to me:**

1. **The positional count is not wrong.** In `withLaterPlainParam`, the later
   plain `@param` lands at position 1 with `declaredTypeName = "number"`. What is
   corrupted is the *parent's* type text, which receives **the raw remaining
   comment** — sibling tags, newlines and leading asterisks. Six shapes reproduce
   it; `orphanDotted`, whose parent tag is absent, gives `""` instead. And
   `outOfOrderTags` shows tags are matched to parameters **by name, not by
   order**, which is correct and worth not breaking while fixing the rest.

2. **The bracket forms have a separate defect nobody named.** `[x]` and `[x=y]`
   extract their type correctly and set `isOptional = false`, `hasDefault =
   false`. `defaultsDisagree` pins the cause: it is the only bracketed parameter
   here that *also* has a default in the code, and the only one returning `true,
   true` — so both columns are derived **from the code alone**, and the bracket's
   optionality is discarded on the way past. A silent loss, so nothing in
   `declaredTypeName` reveals it.

**Both closed at `e3d45cd`**, verified against this file: dotted parents now read
`"object"`, and `[x]` gives `isOptional = true`. One observation left as a
question rather than a finding: `[x=fallback]` sets `isOptional` but
`hasDefault` stays code-derived (`defaultsDisagree`, which has a code default,
is the only `true`). The schema ties `isOptional` to JSDoc and says nothing
about `hasDefault` reading it, so two columns from two sources is a defensible
reading; whether a comment-declared default should be captured anywhere is
`js-oracle`'s to say.

Also covered: a default containing `=` and `[` (`[tricky=a=b]`, `[alsoTricky=[1,2]]`),
a bracketed **and** dotted member (the commonest real shape), a comment default
disagreeing with a code default, and a `@param` naming a parameter that does not
exist — measured to be **dropped entirely**, so the fact base cannot record that
the comment contradicted the code.

## Provenance by name — four files, two findings

Shape (5) of `js-impl`'s day-one list: a `.min.js` inside a non-skipped
directory. `cjs/provenance/readable.{min,bundle,umd,esm}.js` — one per alternate
of `JS_MINIFIED_NAME_PATTERN`, each short, readable, hand-written, each with
`expected provenance: BUNDLED_EXCLUDED`. Measured: **all four classified by name,
4/4 match the header line.** `BUNDLED_EXCLUDED` has producers for the first time.

Two things the four exposed, **both now ruled** (2026-09-13):

1. **`.esm.js` is a conventional name for hand-authored source, and the name rule
   deletes it.** A dual package's ES-module entry is very often `index.esm.js`
   beside `index.cjs.js`, written by a person, not a bundler. Under gate §7.3.5 a
   non-`PROJECT` file contributes zero rows to any denominator, so the `esm`
   alternate is a name-based deletion of real source. **Ruled: `esm` is removed
   from the pattern — landed. `umd` follows it (module-format markers go; build-product
   markers `min`/`bundle` stay) — ruled, not yet landed, and `readable.umd.js` fails by
   name until it does.** `min`/`bundle` name a build product; `esm` names a module
   format. The general rule: *where a name signal and a content signal disagree,
   the content signal wins* — a bundle included by mistake inflates a denominator
   detectably; real source deleted by mistake leaves nothing to notice. Prefer the
   error that can be found. `readable.esm.js` expected `PROJECT` ahead of the fix,
   failed by name, and **went green when the removal landed** — the shape working
   as intended. **The length signal was ruled too**: it now requires a second,
   content-based signal, with a single long literal excused.
   `cjs/provenance/single-long-literal.js` — one 5,226-character string in
   otherwise ordinary code — expects `PROJECT` and reads `BUNDLED` until that
   lands.

2. **Two non-`PROJECT` provenances, two emission behaviours.** `FLOW_EXCLUDED`
   emits exactly one `js_module` row and nothing else (§2.6). `BUNDLED_EXCLUDED`
   emits everything — the four small files here contribute **168 rows** outside
   `js_module` — and is merely dropped from denominators at gate time. §7.3.5's
   wording ("classified, never counted") permits that reading, but a consumer
   that filters on `sourceProvenance != PROJECT` now gets a module row with no
   children for one value and a full subtree for the other. **Ruled: bundled
   emits fully; the column is the filter; no gate-time drop; and the two are
   NOT unified.** `FLOW_EXCLUDED` is a *rejection* — the parser cannot emit
   correct facts, so it stops. `BUNDLED` is a *provenance* — correct facts about
   real code that is not project source, and dropping them at gate time would be
   the parser deciding what a consumer wants. The naming that hides the
   distinction is `js-oracle`'s to settle — **and it did**: the values are now
   `FLOW_REJECTED` (a rejection) and `BUNDLED` (a tag). Every `expected
   provenance:` header in this tree was renamed to match, and the rename was
   *found* by the provenance check failing on sixteen files at once — a literal
   comparison is loud when the vocabulary moves, which is the correct behaviour.

**A rule from being wrong about `BUNDLED_EXCLUDED` twice.** An "unreachable"
enum value is a *claim about the grammar*, and it stays merely *unobserved* until
the grammar actually forbids it. I recorded the value as unreachable because the
content heuristic could not be honestly reached — and never checked whether a
second route existed. It did, and it ran first. The distinction between
*unobserved* and *unreachable* is the same one §4 draws between a gap and a
reservation; the burden is on the claim.

## "Coverage on paper" — the discriminator-coverage audit, specified

`param-returns.js` contained dotted `@param` tags and did not catch the defect,
because its rows came out **empty** rather than wrong. That failure mode
generalises, so it is a computation rather than a habit.

### The measure

> For every column, count the **distinct values the corpus produces**. A column
> with **one distinct value, or none**, is one that nothing in the tree can
> discriminate: a correct implementation and one that never fills it produce
> identical output.

Skip columns where the count is uninformative by construction — anything
matching `/UniqueHash$|LinkHash$/`, plus `serviceVersionLinkHash`,
`baseMservPath`, `filePath`, `fileName`.

### It measures the FIXTURE CORPUS, not the parser

This is the part to get right before implementing it. Run against a real corpus
almost every column has many values and the measure says nothing. Run against
**this tree** it asks *does the discriminator set discriminate* — which is a
question about fixtures, and therefore mine. It belongs beside the fixture
corpus, not in a corpus sweep.

### It needs an allowlist, or it is a report nobody reads

At `e92d135`: **3 always-empty, 29 single-valued — and 30 of those 32 are
documented invariants.** A 94% false-positive rate is the §4 enum-audit lesson
exactly: *"the audit must be a gate with an explicit allowlist, not a report
someone reads."* The allowlist, derived and checked:

| allowlisted | why it is invariant by design |
|---|---|
| `isExternal = false` on all **13** relations | parity slot; always false on parser output |
| `call_site.isTypeOnlyTarget = false`, `expression.isTypeOnlyReachable = false`, `type_reference.isTypeOnly = true` | **asserted** invariants — §7.1 gates them |
| `import.isTypeOnly = false` | parity slot; JavaScript has no `import type` |
| `method_parameter.bindingRegime = PARAMETER` | true by definition of the relation |
| `method_parameter.isParameterProperty = false`, `type.isAbstract = false` | parity slots; no such concept in JavaScript |
| `type_heritage.position = 0`, `inheritsMembers = true` | single inheritance, and no `implements` to distinguish |
| `module.emissionRegime`, `targetTsVersion`, `startLine = 1` | invariant per run by construction |
| `method.methodReferenceKind = ""` | documented parity slot inherited from Java — the reason it is written down |
| `method.isEntryPoint = false` | tier 2, declared and not staged |

**With that allowlist the audit reports two**, and both are real:

- `js_type_reference.resolvedFilePath` — `@param {import('./x.js').T}` and
  `@extends {import('./x.js').C}` are both in the tree and neither resolves. The
  comment channel's version of the heritage hop below. Owner: `js-impl`.
- `js_type.modifiers` — §3.2 says `""` mostly, "static blocks recorded". Static
  blocks are in four files; the column is empty everywhere. Either the column is
  dead or the recording is missing. Owner: `js-oracle` to say which.

### It is a floor, not a ceiling

A column with **two** distinct values passes and may still be badly
under-discriminated — an enum with eight values showing two reads as covered.
The **enum-emission audit** (§7.1) catches that case for enum columns and cannot
catch an always-empty non-enum column; this catches the second and not the first.
They are complementary and neither subsumes the other. Running only one is how a
corpus looks covered.

### What it found, first run

Three real, two of them mine, and the instructive one is not a missing fixture:

| column | verdict |
|---|---|
| `js_type_heritage.resolvedFilePath` | **a missing SHAPE, not a missing fixture.** Empty in all 40 heritage rows, `importLinkHash` populated in 14 — every one a Node builtin — because every `extends` in the tree was same-file. A count of heritage rows read as full coverage. Closed by `cjs/type-registry/cross-file-heritage.js`: 8 rows now resolve to real project files across three heritage forms |
| `js_type_reference.isTruncated` | **mine.** The *expression* depth cap was exercised; the *type-reference* cap, the same 32, never was. Closed by a 40-deep `Array<…>` JSDoc type |
| `js_module.sourceProvenance` | **not a gap — a fix.** `js-impl` repaired the source-map false positive |

### The provenance pair stays, as a regression test

With the false positive fixed, `source-map-footer-short.js` and `-long.js` both
read `PROJECT`, which is right — and nothing in the corpus now produces
`GENERATED_MONOLITH` or `BUNDLED_EXCLUDED`. Both need **real build output**
rather than an imitation written to pass the heuristic, so both are `js-corpus`'s.
The pair is kept because a fixture that stopped reproducing is how the defect
would come back unseen.

## Three more, each measured before the code that will read it

| fixture | for | measured at `a5f6aab` |
|---|---|---|
| `cjs/jsdoc/casts-and-throws.js` | `JsTypeReferenceContextKind.CAST` and `THROWS` — now in the vocabulary, not yet emitted | nine cast sites and four `@throws` produce **zero** rows; the `@type`-on-declaration controls produce `VARIABLE`. **Plus the 63% controls** (§5e–5k), added on `js-oracle`'s decomposition: nine `@type` tags over statements, **seven right today, two nothing — and the two are one shape**, an assignment to a bare identifier. Declarations and member-target assignments already walk down correctly. *(The decomposition was since falsified on tip — the recoverable population was 70, now landed — and the two nothing-cases are attributed to a named schema gap: `JsTypeReferenceOwnerKind` has no `EXPRESSION` owner. Routed to `js-oracle`.)* **And 5k found something an order of magnitude larger than what it was written for**: tracing its silence, `js-impl` found `scopeOfNode` and `scopeByNode` swapped in four places (`c1a52e1`), so every `js_method.bodyScopeLinkHash` had been the *enclosing* scope since the first commit. Measured here: **908 of 908** non-initializer methods shared body and owner scope before the fix, **0 of 908** after. After the fix 5e–5k is **9 of 9**. That is the strongest argument in this document for writing the narrow discriminator past the case that was asked for. The multi-declarator case, one row for two bindings, is being measured against tsc's behaviour rather than ruled by taste; no expectation is written here either way. The 1,942-case is here in **both** forms — `/** @type {T} */ ((x) => …)` which TypeScript treats as a cast, and `/** @type {T} */ (x) => …` which it does not — so whichever the ruling picks, the other is the control |
| `cjs/expressions/trailing-comments.js` | a `js_comment` defect | 25 uniquely-marked comments, 15 emitted, **10 missing — every one trailing a comma.** Every last-element comment with no comma survives. Not "inside a bracket": *after a comma*, one token. **`js-corpus` has an independent repro** at `verified/trailing-comment-in-brackets/` — three controls, four losses, correctly designed; every one of its four losses also follows a comma, so the two files agree and mine narrows the cause. Both stay: theirs is the repro, this is the discriminator |
| `esm/imports/pkg/index.js` (existing) | `export * as X from` | **already exposed the defect and I had never checked the line.** `export {a as b} from` → `EXPORT_DECLARATION`; `export * from` → `EXPORT_ALL`; `export * as util from` → **no row at all**. The construct was in the file from the first commit |

### On deriving the nature label rather than declaring it

Asked because the failure has recurred twice as the corpus grew, and the answer
is **yes, derive it — for JavaScript the derivation is exact.** The gate already
computes `statements.length === 0`; the declared label is redundant with the
predicate, so the check `declared === derived` can only ever catch header hygiene
and never a parser defect. The reason a *declared* label was worth having in
TypeScript is that TypeScript has erasable declarations — a file full of
`interface` has statements and no runtime. JavaScript has none; Flow's `declare`
was the one exception and it is now `FLOW_EXCLUDED`. So: compute nature from the
statement count, keep the parser-side assertion (a zero-statement file emits no
`js_expression` or `js_call_site` row — that is the half that matters), and let
the header line be documentation that cannot fail the suite. The recurring class
of failure disappears rather than being fixed one file at a time. Owner:
`js-oracle`, for the gate; the three files named this round are in `verified/`,
which is `js-corpus`'s, and not mine.

### The trap sweep, mechanically

`js-corpus` named the "fixture that mentions the construct it tests" as my trap,
correctly — it has bitten me twice. Swept the whole tree against every
text-keyed detector the parser has (`@flow` in the first 2 KB, the source-map
footer, `@ts-check`/`@ts-nocheck`, shebang, the three bundler preambles) plus a
check for **detached** JSDoc blocks carrying a tag, which mint phantom rows.
**Clean**: every trigger is in a file that intends it, and the one detached-tag
hit is `contradicting-jsdoc.js`'s deliberate comment-attached-to-nothing case.

My first pass reported twenty hits, and they were the harness — a path
predicate comparing `flow/` against `./flow/` and never matching. Fixed before
believing it. That is the third time in as many days that the first answer from
an instrument I built was the instrument.

## Instrument errors — four mechanisms, one check

Recorded as a set because each was caught the same way and none was the parser.
Every one produced a number that was *real* against a population that was
*wrong*, and nothing about the output looked off.

| # | mechanism | what it reported | what was true |
|---|---|---|---|
| 1 | a **global cell-set** that could not attribute a value to a column | `THIS` looked observed | it was a value of some other column |
| 2 | a **PK located positionally** after a column was appended past it | 10,092 `js_expression` rows sharing one key | `introducesDeclarationLinkHash` is almost always empty |
| 3 | a **path filter** where a provenance filter was needed | 35 rows from excluded Flow files | the two `detection-miss/` files, which are supposed to emit |
| 4 | a **stale worktree** created from tip with the edit uncommitted | all nine `@type` controls produced nothing | the section was not in the copy being measured |
| 5 | **ownership inferred from a commit subject** | `verified/` and the gate attributed to `js-impl`, in five places | a subject carries what was done, not who owns the directory; every branch here has one git author, so the subject was the only signal and it answers a different question |
| 6 | **a conditional echo that did not fire**, followed by unconditional output | "c1a52e1 is in my branch" — the commit body printed, so I read ancestry as confirmed | `merge-base --is-ancestor … && echo` had failed silently; `js` moved between my merge and my measurement; the "179/179 still shared" was the *pre-fix* build |
| 7 | **wrong working directory** | `staging/flow/: No such file or directory` — read as a merge having deleted my tree | the grep ran in the primary checkout, whose `main` has no JavaScript test data at all. Checked in one command before believing it |
| 8 | **the scrub's own description quoting the name it removed** — *twice* | `MANIFEST.md` first narrated the scrub with a runtime-library path form, then narrated *that* catch by naming a UI library as an example of a bare word. The canonical instrument found the second at line 30 | not an instrument error but the same family: a document *about* a scrub is where an author's guard is down, because the name feels like a citation rather than a reference. The measured inventory caught it; my own census had no pattern for it |

The one check: **before trusting a null result — or a uniform one, or a
confirmation — confirm the instrument could have returned something else.**
The set keeps growing and that is the point: its growth is the evidence the
sweep is still happening. A set that stops growing is usually a set that
stopped being swept.

**Re-measured against the canonical artefact.** `src/test/OSS-SCRUB-INVENTORY.md`
(generated at `49db344`) assigns `js-fixtures` **47** hits with line numbers.
That tree **predates the scrub commits** — `js` had not yet taken `f07ed63` —
so the 47 are the pre-scrub files. Running the same instrument,
`npx tsx src/test/oss-scrub-gate.ts --scope src/test-data/javascript/staging`,
on this branch returned **1 hit**: `MANIFEST.md:30`, the scrub's own account
naming a UI library as an example of a bare word — the eighth-entry mechanism,
inside the paragraph that documents the eighth-entry mechanism. Fixed. The
instrument now returns **0 hits over 129 tracked files**, and that number is the
one to reconcile against; three earlier counts — 79, 80, 57 — disagreed because
at least one scan ran on a tree without the scrub, and this one did too. #6
is the sharpest: the output *looked like* a yes because a no was silent and the
next line printed regardless. `cmd && echo yes || echo NO` is the form that
cannot do that. A uniform zero from a fresh
instrument is the first thing to sweep, not the first thing to file. The
corollary that generalises: the defects that get filed are the ones nobody swept
for, so the sweep is the discipline and the catch is the expected outcome.

---

## Consolidated "no analogue" record

Java constructs with **no JavaScript port**, recorded rather than invented.

| Java construct | why it does not port | nearest thing covered instead |
|---|---|---|
| type parameters, on types **and** on methods | no type syntax at all; the schema declares no `js_type_parameter` relation | JSDoc `@template` in `jsdoc/callback-and-template.js`, stored as `js_type_reference` with `contextKind = TEMPLATE` |
| type annotations on declarations | 0.165% of parameters have one, and all 64 measured are **Flow** | JSDoc `@param`/`@type`/`@returns` — the actual channel, at 36.4% |
| use-site wildcards `? extends` / `? super` | no variance, nothing to annotate | — |
| `sealed` / `permits` | no sealed hierarchies | — |
| `throws` clause / checked exceptions | JavaScript has neither | `Error` subclass hierarchy + `instanceof` narrowing (`blocks/exception-handling.js`); the JSDoc `@throws` comment |
| multi-catch `catch (A \| B e)` | catch bindings have no type | narrowing inside the `catch` block |
| `enum` | no such declaration; no `js_enum_member` relation | four real idioms in `enums/enum-idioms.js`, none of which is a declaration |
| annotations, `@interface` declarations | no annotation syntax; decorators are **deferred by schema OQ-1** with a recorded trigger | JSDoc tags (`jsdoc/`) |
| `interface` | no interfaces | `@interface` and `@implements` comments, plus structural satisfaction with no declaration anywhere |
| `record` | no records | a class of fields assigned in the constructor |
| method overloading | one callable per name; a redeclaration replaces | runtime argument inspection (`methods/arity-dispatch.js`) and static factories |
| generic constructors | no type parameters | `@template` on a class |
| `this(...)` constructor delegation | no such form | static factories; `super()` is the only delegation |
| method references `String::length` | no `::`; `methodReferenceKind` is a parity slot that stays `""` | passing the function value, and the receiver loss that causes |
| inner / static nested classes | classes do not nest as **types**; there is no type namespace | a static property holding a class, and a local class in a function (`type-registry/type-placement.js`) |
| instance initialiser block | only `static {}` exists | field assignment in the constructor |
| `final` class / method / field / parameter | no `final` | `const` bindings, `Object.freeze`, `writable: false` |
| `synchronized`, `native`, `strictfp`, `transient`, `volatile` | no equivalent modifiers | — |
| package-private access | visibility is per-module | exported vs non-exported; `#private` members, which are a **real** access boundary unlike `_x` |
| static imports, wildcard imports | unrelated resolution models | named and namespace imports; destructured requires |
| qualified constructor `outer.new Inner()` | no such form | — |
| char literals, numeric suffixes (`1.5f`, `999L`) | one number type plus BigInt | `BigIntLiteral`'s `n` suffix, which is the only suffix there is |

Two TypeScript constructs that also do **not** port, per the schema's §4:
declaration merging (there is none — a second `class Foo` is an error) and
`import type` (`js_import.isTypeOnly` is a parity slot that stays `false`).

---

## Findings, handed over rather than acted on

1. **`ts.createSourceFile` reports two parse diagnostics on legal sloppy-mode
   JavaScript.** `cjs/hoisting/sloppy-implicit-global.js:78-79` uses a legacy
   octal literal (`0755`) and an octal escape (`'\101'`). Both are legal in a
   sloppy CommonJS file and `node --check` accepts the file; TypeScript 6.0.3
   reports *"Octal literals are not allowed"* and *"Octal escape sequences are
   not allowed"* as **grammar errors regardless of mode**, because it has no
   sloppy mode to be in. The nodes are still produced.

   This is a real disagreement between the two oracles the schema names, on a
   construct the schema's own `js_parse_gap` relation has a value for
   (`PARSE_ERROR`). It is **not mine to rule on**: it belongs to `js-oracle`
   (whether a TypeScript grammar diagnostic on runtime-legal syntax mints a
   `js_parse_gap` row, and whether the second oracle overrides it) and to
   `js-impl` (whether `parseDiagnostics` are read at all). Repro: the fixture
   plus `ts.createSourceFile(path, text, ES2022, true, ScriptKind.JS)`.

2. **Three fixtures fail `node --check`, all three by design**, and the list is
   here so a future sweep does not read them as breakage:
   `jsx/component-in-js.js` (JSX is not ECMAScript; a bundler compiles it),
   `mismatch/esm-under-commonjs/esm-syntax.js` and
   `mismatch/esm-under-commonjs/mixed-both-systems.js` (that is what they are
   for). Two further files parse and cannot **run**: `esm/require-under-esm.js`
   (`ReferenceError: require is not defined`) and
   `exports-map/consumer/consumer.js` (`ERR_PACKAGE_IMPORT_NOT_DEFINED`, on
   purpose).

3. **`NO_PACKAGE_JSON_DEFAULT` cannot be exercised by any fixture in this
   repository** — see the module-system table above. Owner: `js-corpus`.

4. **A `.d.ts` beside a `.js` is not covered.** §5 of `BUILDING-JAVASCRIPT.md`
   asks which one a JavaScript import resolves to when a `node_modules` package
   ships both. That is a resolution question about installed packages, not a
   source-shape question, so no fixture can pose it honestly — it needs a real
   `node_modules` tree. Owner: `js-corpus` / `js-oracle`.

5. **The nature label should be a gate, not a convention.** Every file in this
   tree carries three header lines — `module system:`, `nature:` and
   `syntax floor:` — and all 86 were audited mechanically before this manifest
   was written. The rule, which is worth enforcing in-repo rather than leaving
   to fixture authors (the TypeScript manifest records five files that were
   mislabelled until `ts-impl` caught one by hand):

   > A file may declare `nature: type-only` only if
   > `ts.createSourceFile(...).statements.length === 0`. A file declaring
   > `runtime-bearing` must have at least one statement. Both header lines must
   > be present.

   In JavaScript that predicate is exact — unlike TypeScript, where a
   `namespace` exporting one `const` emits an IIFE and the nature follows the
   contents. There is no erasable declaration form here, so a file either has
   statements or it does not. Owner: `js-oracle` (the in-repo suite) or
   `js-oracle` (the gate list). I deliberately did not add the script to this
   tree: anything that is not JavaScript source in `staging/` becomes an input
   to the extractor.

6. **`sourceProvenance` is decided by file length rather than by evidence, and
   errs in both directions.** `js-module-extractor.ts` searches `BUNDLER_PREAMBLES`
   within `sourceText.slice(0, 4096)`. Four of the five patterns are genuine
   headers and are correctly bounded. The fifth, `sourceMappingURL`, is a
   **footer** by convention, so the bound does the opposite of its stated purpose:
   it is *supposed* to stop a token "appearing in a comment halfway down a
   hand-written file" being read as evidence, but for any file under 4 KB the
   head window is the whole file, and for any file over it the footer is excluded
   entirely.

   **Measured**, on this checkout's `node_modules` — 816 files scanned, 42 of them
   carrying a source-map footer and no other preamble pattern:

   | | files |
   |---|---|
   | short enough that the footer lands in the head window → `GENERATED_MONOLITH` | **21** |
   | long enough that it does not → `PROJECT` | **21** |

   A 50/50 split on identical evidence. Two files from ONE build in this checkout's
   dependencies (2,230 B and 4,701 B) get opposite verdicts — same build, same
   directory, opposite verdict.

   **Why it is not cosmetic.** Gate §7.3.5 says a file whose `sourceProvenance` is
   not `PROJECT` contributes zero rows to any coverage denominator. So both errors
   are silent: a hand-written file drops out of coverage while everything reads
   green, and a genuinely generated file is counted as project source. That is a
   measurement reporting success, which §7 calls the most expensive shape of error
   available.

   **The repro is in this tree and needs no `node_modules`:**
   `cjs/directives/source-map-footer-short.js` and `source-map-footer-long.js`
   are hand-written, carry the identical footer, and are classified
   `GENERATED_MONOLITH` and `PROJECT` respectively. Owner: `js-impl`.

   **The instance in my own tree is fixed at the cause, not patched.** The footer
   used to sit at the bottom of `directive-comments.js`, which meant that file's
   `@ts-check` coverage was being dropped for a reason that had nothing to do with
   directives. It has been moved into the paired repro, where being misclassified
   is the point rather than a side effect.

7. **The zero-row ledger, corrected.** The first sweep against `11af0db` found
   **18** non-reserved enum values with no row anywhere in the corpus — I reported
   13 in prose, which was an arithmetic error in my own count and is corrected
   here. Ten are now closed: eight deliberately, plus `PARSE_ERROR` (reached
   incidentally by Flow's inline syntax) and `GENERATED_MONOLITH` (reached by the
   misclassification in Findings 6, which is not a closure anyone should keep).

   **Eight remain**, and they fall into four kinds that must not be conflated:

   | value | kind | owner |
   |---|---|---|
   | `JsContradictionKind.MIXED` | has a fixture, produces nothing | `js-impl` — Findings in the coordination log |
   | `JsThisBinding.BOUND` | has a fixture, unreachable by construction (only `js_method` carries the column, and a `.bind()` RHS lands in `js_field`) | `js-impl` |
   | `JsImportForm.IMPORT_EQUALS` | **not expressible in JavaScript** — `import x = require()` is TypeScript syntax | should be a documented parity slot, like `methodReferenceKind` |
   | ~~`JsBodyPresence.NO_BODY`~~ | **I was wrong.** I wrote "not expressible in JavaScript — there is no `declare`". Flow has one, the corpus contains Flow, and `flow/declare-statements.js` now mints **13** such rows with **zero** diagnostics. It is not a parity slot; it is Findings 9 | `js-impl` |
   | ~~`JsDirectiveKind.USE_STRICT`~~ | **RULED and REMOVED** (`bae3a6f`). I reported it as "arguably misplaced"; `js-oracle` removed the value outright, on the ground that a string-literal expression statement can never produce a `js_comment` row and reserving it would invite someone to mint one | closed |
   | `JsModuleSystemSource.NO_PACKAGE_JSON_DEFAULT` | unreachable from any fixture — this repository has a root `package.json` | `js-corpus` |
   | ~~`JsSourceProvenance.BUNDLED_EXCLUDED`~~ | **I was wrong — half of it is reachable.** The *content* heuristic (line length) is unreachable honestly; the *name* rule (`/\.(min\|bundle\|umd\|esm)\.[cm]?jsx?$/i`) is not, and it runs first. `cjs/provenance/readable.{min,bundle,umd,esm}.js` — four ordinary readable files — are all `BUNDLED_EXCLUDED` by name. Requested as shape (5) by `js-impl` | closed; two findings below |
   | `JsModuleKind.JSON_MODULE` | needs an import attribute, which is above the ES2022 working floor | blocked on the floor ruling |

   Only the first two are defects. The middle four are reservations that should be
   **written down as such** so the audit stops reporting them, and the last two are
   corpus reach rather than parser gaps. Telling those apart is the whole point of
   §4's allowlist, and the list above is what it should contain.

8. **`js_parse_gap` duplicates its primary key on Flow files, and the cause is
   two defensible decisions meeting.** `flow/casts.js` produces **four rows
   sharing one PK** — column 1 of the line one past the last, all
   `1005: '</' expected.`, all at `start = the file's length`. Verified through
   the extractor,
   with the key located **by name** (`jsParseGapUniqueHash`) rather than by
   position; see Findings 10 for why that matters.

   The PK is `(ownerModule, gapKind, startLine, startColumn)` and every
   diagnostic is minted `PARSE_ERROR`, so the diagnostic **code is not in the
   key**. Separately, `ScriptKind.JS` carries `languageVariant = JSX` — the
   schema's own stated reason for ruling `scriptKind` provenance-only — so a Flow
   generic in an unparseable position opens an **unterminated JSX element** and
   recovery runs to end of file, where every diagnostic shares one offset.

   **What I could not reproduce, recorded so nobody re-derives it:** a minimal
   synthetic version does not collide. N casts of `(raw: Array<number>)` in an
   otherwise empty module give N diagnostics and **zero** at EOF, for N in
   0,1,2,3,5,8. I expected linearity in the number of generic casts; there is
   none. The EOF count moves up *and down* as later lines are added, because the
   unterminated element swallows whatever follows — which also means the count is
   not a stable number to assert, only its being greater than one. The collision is emergent in a
   realistic file, which is the argument for the fixture rather than a three-line
   regression test — and the reason the file must not be "simplified".
   Owner: `js-impl`.

9. **Flow's `declare` breaks the nature predicate I proposed, and reaches an enum
   value I called unreachable.** `flow/declare-statements.js` has 15 top-level
   statements, zero runtime and zero diagnostics. Two consequences:

   - The mechanical gate from Findings 5 — `type-only` iff
     `statements.length === 0` — now returns the wrong answer. I argued it was
     exact for JavaScript because "there is no erasable declaration form here";
     Flow has one. Measured refinement: **14 of the 15 statements carry
     `ts.ModifierFlags.Ambient`**, and the fifteenth is the `interface`, which is
     type-only by kind. So: *every top-level statement carries `Ambient`, or is an
     `InterfaceDeclaration`/`TypeAliasDeclaration`*. This is a widening — both
     `cjs/` type-only fixtures still satisfy the original form — and if Flow is
     ruled out of scope it is not needed at all.
   - `JsBodyPresence.NO_BODY`, which Findings 7 called a permanent parity slot,
     is minted **13 times** by this one file. That entry is struck.

10. **A harness note, because I made the mistake myself.** My PK-uniqueness check
    located each key as *the last column*, which was the schema's Appendix A
    convention. `js_expression` now has `introducesDeclarationLinkHash` appended
    **after** `jsExpressionUniqueHash`, so the check read an almost-always-empty
    column and reported **10,092 rows sharing one primary key** in
    `cjs/blocks/control-flow.js`. There is no such defect. `js-impl` had already
    moved its own gate to locate keys by name (`1b99d0d`); my scratch harness had
    not. §7's warning in miniature — most of what an adjudication harness finds is
    wrong with the harness — and the cost of checking before reporting was one
    `head -1`.

12. ~~**`.js.flow` is never walked**~~ — **CLOSED by `js-impl`.** Verified at
    `e92d135`: `flow/libdef.js.flow` is walked and emits one module row with
    `sourceProvenance = FLOW_EXCLUDED`, `hasFlowPragma = true`. The original
    finding follows.

    **`.js.flow` is never walked, so the extension detection route in §2.6 does
    not exist.** `JS_SOURCE_EXTENSIONS` is `['.js', '.jsx', '.mjs', '.cjs']`.
    `flow/libdef.js.flow` produces **zero rows — not even a module row**, which
    is a different outcome from exclusion and the ruling says so explicitly: the
    module row is what makes a declined file "countable" and "greppable". Not
    scanned is indistinguishable from not present, so the detector cannot be
    measured on the file class the Flow libdef installer places by the hundred. Owner:
    `js-impl`.

13. **The 121 duplicate primary keys are reproduced, and the proposed fix does
    not fix them.** §7.3b-2 records that `js-oracle` could not reproduce the
    collision across six shapes, and asks for "one file and one offset that
    produces the pair". `flow/casts.js` is that file: **four `js_parse_gap` rows
    with one `jsParseGapUniqueHash`**, verified through the extractor with the
    key located by name.

    **The described mechanism is not the actual one.** §7.3b-2 attributes it to
    "error recovery emitting one diagnostic twice". It is not one diagnostic
    twice — it is **four distinct diagnostics that all land at the same offset**,
    `start = the file's length`. `ScriptKind.JS` carries
    `languageVariant = JSX`, so a Flow generic in an unparseable position opens
    an unterminated JSX element and recovery runs to end of file.

    **Therefore adding `detail` (c1) to the key does not work.** That is the
    one-line fix §7.3b-2 proposes and calls obvious. All four rows carry the
    *identical* detail — `1005: '</' expected.` — so the widened key still
    collides. A discriminator that varies per row is needed: an ordinal within
    the file, or the diagnostic's index. Measured, and reported before anyone
    spends the day the section says the fix would take.

    **And it does not reproduce when simplified.** N casts of
    `(raw: Array<number>)` in an otherwise empty module give N diagnostics and
    **zero** at EOF, for N in 0,1,2,3,5,8 — which is very likely why six shapes
    found nothing. The collision is emergent in a realistic file. Do not
    minimise the fixture.

14. **The 2,048-byte pragma window missed four of my own six Flow fixtures**, and
    I did not do it on purpose. I wrote `/* @flow */` into all six and the
    detector reported `hasFlowPragma = false` for `casts.js`,
    `declare-statements.js`, `recovery-mangling.js` and `silently-typed.js`,
    because my explanatory headers pushed the pragma past the window. I have
    moved the pragma to line 1 in all six, which is where Flow requires it
    anyway.

    Recorded rather than quietly fixed, because the accident is the evidence: if
    an author *deliberately* writing Flow files trips the bound **4 times out of
    6**, a corpus of real files with licence headers will trip it constantly, and
    every one of those is a silent detection miss. `detection-miss/after-long-licence.js`
    now reproduces it on purpose. The fix is not a larger number — any bound can
    be exceeded — but bounding to the **leading comment run** rather than to a
    byte count, which is also what Flow itself does. Owner: `js-impl`.

16. **The Flow-exclusion collateral audit, run mechanically — and one real
    casualty.** Prompted by `edge-shapes.js`, which bundled a `with`, an
    `Object.defineProperty`, a constructor function and a pragma, and took
    `hasWithStatement` to zero corpus-wide when it was excluded.

    I ran the same question over this tree as a computation rather than by eye:
    for every **schema-declared enum value**, which files produce it, and is
    every one of those files about to be excluded? Restricting to declared enum
    values matters — the same audit over all cell values returns 822 hits, almost
    all of them identifier names, and the signal is lost in it.

    **Three values had only Flow producers. Two are correct to drop:**

    | value | verdict |
    |---|---|
    | `JsBodyPresence.NO_BODY` | correct — `declare function` is Flow, and §7.3a-2 rule 3 *asserts* no such row survives in an emitted file |
    | `JsParseGapKind.FLOW_SYNTAX` | correct — it only ever applied to Flow files |
    | `JsParseGapKind.PARSE_ERROR` | **the casualty.** A general-purpose gap kind for any malformed JavaScript, produced only by Flow files by accident |

    `jsx/unterminated-element.jsx` now carries `PARSE_ERROR` on purpose, in a file
    with nothing to do with Flow, and the audit is down to the two that should
    drop. The same audit over the *other* exclusion path — `sourceProvenance !=
    PROJECT` — returns nothing extra, so `source-map-footer-short.js` carries no
    unique value.

    **No unintended pragmas.** Nothing outside `flow/` contains the token, in the
    first 2 KB or anywhere else, so nothing in this tree is being silently eaten
    the way `js-corpus`'s prose-pragma fixture was.

17. **An ordering dependency between two changes that are each fine alone.**
    **Corrected 2026-09-12: "the only reproducer" was imprecise, and the
    precise version is worse.** There are **two halves** to the duplicate-key
    defect and they need **two different repros**:

    | half | what it needs | repro | survives exclusion? |
    |---|---|---|---|
    | **widened key** — two *genuine, distinct* facts at one offset | a key that can tell them apart | `js-corpus`'s seven-line case from a real component library, which carries **no pragma** | **yes** |
    | **de-dup** — N *field-identical* rows collapsing to one | rows that are identical in every field | `flow/casts.js`, four rows | **no** |

    So `js-corpus` is right that the fix is real rather than hidden by exclusion,
    *for its half*. `flow/casts.js` is the only repro for the other half, and it
    is Flow, and exclusion retires it.

    I tried to replace it and **could not**. Five malformed JSX shapes —
    unterminated element, unterminated nested, mismatched close, unterminated
    fragment, unclosed attribute brace — produce 1–2 diagnostics each and **zero**
    positions carrying more than one, plus a realistic broken component produces
    exactly one. TypeScript's JSX recovery is well behaved in a way its Flow
    recovery is not.

    **A second attempt, after the ruling gave precise ablation conditions
    (§7.3b-2: a generic with exactly one type argument, a compound expression,
    two or more levels of enclosing braces), also failed.** Those conditions
    describe a *Flow cast*, and the plain-JavaScript analogue — a comparison
    chain `a[i] < b > (c)`, which is the shape a JSX-variant parser might read as
    a generic — produces **zero diagnostics** at one, two and three brace levels,
    with bare, call and member operands. Eight shapes, all clean. TypeScript's
    disambiguation handles them; the `:` of a cast is what pushes the parser into
    the type grammar first, and only Flow has one.

    **So the dependency is real and now has a specified fix.** §7.3b-2 rules
    *de-duplicate field-identical diagnostics, key unchanged* — which is lossless
    and correct, and which `flow/casts.js` verifies exactly: four field-identical
    rows must become one. The ordering:

    - **de-dup lands first** → `flow/casts.js` proves it works, and exclusion then
      retires the fixture harmlessly. This is the order to take.
    - **exclusion lands first** → the de-dup ships unverified, because nothing
      left in the corpus produces a duplicate.

    **And the ablation may be evidence of something larger.** Thirteen shapes
    now fail to reproduce it without Flow: eight plain-JavaScript comparison
    chains (`a[i] < b > (c)`, at one, two and three brace levels, with bare, call
    and member operands) and five malformed-JSX shapes. If field-identical
    duplicate diagnostics turn out to be **Flow-specific**, then de-duplicating
    them is correct but **unverified for JavaScript**, and the confidence anyone
    places in that half of the fix should reflect that. I am not ruling on it —
    it is being ruled with `js-oracle` and `js-impl` — but the negative result is
    the parser-visible part and it is recorded here.

    Owner: `js-impl` and `js-oracle`. Recorded rather than solved.

    *(For the record, the ordinal I suggested was considered and rejected in
    `bae3a6f`, correctly: it would make the primary key depend on tsc's internal
    diagnostic ordering, so a compiler patch bump could rewrite every hash in the
    relation — the same cascade the schema refuses for `targetTsVersion`.)*

18. **Minified and bundled output is not covered here**, deliberately. It is a
   provenance classification (`sourceProvenance`, `BUNDLED_EXCLUDED`) decided by
   file-level heuristics on real build output, and a hand-written imitation of a
   bundler output would test the heuristic against a specimen written to pass
   it. Owner: `js-corpus`.

---

## The question for the human — ECMAScript floor and Node line

**Not answered, and no fixture assumes an answer beyond the repository's own.**
The evidence I used in the absence of a ruling:

- the repo's `tsconfig.json` sets `"target": "ES2022"` and `"lib": ["ES2022"]`;
- the repo's `package.json` sets `"engines": { "node": ">=18.0.0" }`;
- the schema itself already depends on **ES2022** constructs — `js_field.isPrivateName`
  (`#x`), `js_module.hasTopLevelAwait`, `js_block`/`js_scope`'s
  `CLASS_STATIC_BLOCK`, and `js_expression.operatorString` listing `??=` and
  `||=` (ES2021).

So the working floor is **ES2022 / Node 18**, and every use of syntax above
ES2020 is quarantined to the files below, each of which can be dropped or
downgraded without touching anything else. **Decorators are used nowhere**,
because schema OQ-1 defers them with a recorded trigger.

| fixture | above-ES2020 syntax used |
|---|---|
| `cjs/expressions/literals.js` | ES2021 numeric separators |
| `cjs/expressions/operators.js` | ES2021 logical assignment (`&&=`, `\|\|=`, `??=`) |
| `cjs/blocks/control-flow.js` | ES2022 class field, `static {}` |
| `cjs/local-variables/local-variable-forms.js` | ES2022 `static {}` |
| `cjs/expressions/calls-and-member-access.js` | ES2022 class field, `#private`, `#x in obj` |
| `cjs/methods/method-kinds.js` | ES2022 class field, `#private`, `static {}` |
| `cjs/methods/constructor-patterns.js` | ES2022 class field, `#private` |
| `cjs/type-registry/type-categories.js` | ES2022 class field, `#private`, `static {}` |
| `cjs/type-registry/type-placement.js` | ES2022 class field, `static {}` |
| `cjs/integration/service-layer.js` | ES2022 class field, `#private` |
| `cjs/integration/errors.js` | ES2022 `Error` `cause` (a library feature, not syntax) |
| `esm/exports/export-forms.js` | ES2022 arbitrary module namespace name (`export { x as 'str' }`) |
| `esm/top-level-await.js` | ES2022 top-level await — **whole file** |
| `ext/cjs-package/override.mjs` | ES2022 top-level await |

If the ruling lands **below ES2022**, the two top-level-await fixtures are
deleted outright and the class-field / `#private` / `static {}` lines are excised
from the nine files that carry them — at the cost of leaving
`js_field.isPrivateName`, `js_module.hasTopLevelAwait`, `CLASS_STATIC_BLOCK` and
`js_scope.CLASS_STATIC_BLOCK` with **no fixture at all**, which is the trade to
weigh. If the ruling lands **above ES2022**, decorators become fixture-able and
OQ-1's trigger fires.
