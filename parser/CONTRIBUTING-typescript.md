# TypeScript parser — working agreement

**All TypeScript work happens on `typescript-parser`. `main` takes merges only.**

```bash
git checkout typescript-parser
git pull
# ... work ...
npx tsx src/test/typescript-tests.ts     # must be green before you push
```

## Read Java for structure, Python for process

TypeScript is **structurally much closer to Java than to Python.** Types are
declared at declaration sites — parameters, returns, fields, type parameters with
bounds — so a syntax-directed extractor recovers most of the semantic model from
the tree alone. That is precisely why Java needed no binder pass and Python did.

Port from Java:

| Java | TypeScript |
|---|---|
| `TypeAccess`, `TypeModifier` | `public`/`private`/`protected`, `abstract`/`readonly` |
| `TypeCategory` | class / interface / enum — the same keywords |
| `MethodAccess`, `MethodKind`, `MethodModifier` | same |
| `FieldModifier` | `readonly`, `static`, `private` |
| `TypeRefContext`, `TypeRefKind` | maps closely |
| `WildcardVariance` | `in` / `out`, since TS 4.7 |
| `BlockKind`, `EdgeRole`, `ExpressionKind` | largely portable |
| `src/test-data/java/` 12 categories | port far more directly than Python could |
| `type-registry` / `type-method` / `field` / `method-parameter` extractors | near 1:1 |

Take from Python only the **process**: oracle-first, never hand-write an expected
fact, re-freezing lives outside this repository, the branch and gate structure,
and the staging-then-consolidate agent pattern. `CONTRIBUTING-python.md` carries
those three rules unchanged — read them there.

Where TypeScript exceeds **both**: its type system. Unions, intersections,
conditional and mapped and template-literal types, and structural satisfaction
have no analogue in either language. That, not runtime semantics, is the hard part
here — the inverse of Python, where runtime semantics were hard and the type
system barely existed.

## TypeScript ships a stronger oracle than Python did

CPython gave us `ast` and `symtable`: scopes and bindings, nothing more. Type and
call-target resolution had to be built, and 51% of Python call sites needed
receiver typing the oracle could not adjudicate.

The TypeScript compiler answers all of it:

| question | oracle call |
|---|---|
| what does this name refer to | `checker.getSymbolAtLocation` |
| what type is this expression | `checker.getTypeAtLocation` |
| which overload does this call pick | `checker.getResolvedSignature` |
| where does this import resolve | `ts.resolveModuleName` |
| is A assignable to B | `checker.isTypeAssignableTo` |

So resolution is **verifiable here, not merely plausible**. Every link the parser
emits can be checked against the reference implementation. That is a materially
better position than Python started from, and the gates should exploit it.

## Rule four, and it is the one that will be broken first

**The compiler is the oracle. It is never the runtime.**

Extraction must not require a `ts.Program`. A Program needs `node_modules`
resolved and costs a full typecheck — the parser would then be slower than
`tsc` while emitting less, and lose its reason to exist. Syntax plus a binder at
extraction time; the compiler only in the oracle, out of process.

The pull toward `checker.getTypeAtLocation` inside an extractor will be constant,
because it makes hard rows easy. It also makes the parser a typechecker.

## Decision one, before any code: the parse layer

Not settled. Needs the human's word.

**`ts.createSourceFile`** — the compiler's own parser. Zero grammar drift, since
it *is* the reference. `typescript` is already a devDependency. No 32KB buffer
limit. Handles TSX, satisfies, decorators, and next year's syntax on the day it
ships.

**`tree-sitter-typescript`** — matches Java and Python, reuses `LanguageParser`,
`ParserFactory`, and the callback-parse workaround. Lags the language, and
TS/JS syntax moves faster than any other language here.

Recommendation: the compiler's parser. Correctness over architectural symmetry —
and it removes a class of bug we paid for twice in Python. Cost is a
`LanguageParser` implementation that is not tree-sitter backed.

## Five semantics that break Java and Python assumptions

**Structural typing.** `implements` is optional and non-authoritative — a class
satisfies an interface without declaring it. Inheritance edges do **not** capture
subtyping, so the Java `IMPLEMENTS_INTERFACE` model does not port. Unlike Python's
duck typing this is decidable: `isTypeAssignableTo` answers it exactly.

**Declaration merging.** One interface name can have N declarations across N files
that merge into one type. `name -> single entity` is false, and so is any primary
key that assumes it. Design for it before the first `ts_type` row.

**Type-only constructs.** `import type`, `export type`, type aliases, conditional
and mapped and template-literal types have no runtime existence. They belong to
the type graph and must never enter the call graph, or it fills with phantom
edges. Flag them at emit time, not downstream.

**Ambient declarations.** `.d.ts` and `@types/*` are the typeshed analogue, except
they ship inside packages and are therefore always present. Third-party types are
available in a way Python's never were — but they are declarations without bodies,
so `lib_ts_*` gets declarations only, exactly as `lib_py_*` does.

**Real overloads.** Unlike Python's `@overload`, TypeScript overload signatures are
resolved by the compiler. `getResolvedSignature` names the winner, so overload
resolution is oracle-adjudicated rather than spec-adjudicated.

## The four agents

| agent | owns | runs |
|---|---|---|
| `ts-oracle` | `src/schema/typescript/`, `src/test/typescript-tests.ts`, `../parser-oracle/typescript` | first, alone; stops for schema approval, then returns for the gate |
| `ts-impl` | `src/parsers/typescript/`, `src/analysis-types/typescript/` | continuous, in its own worktree |
| `ts-fixtures` | `src/test-data/typescript/staging/` | continuous |
| `ts-corpus` | `src/test-data/typescript/categories/`, `verified/` | batched |

`ts-oracle` writes no fixtures. `ts-fixtures` supplies source; the oracle harness
decides what the facts should be. A test case therefore always has two authors, which
is the point — a hand-written expectation tests only whether its author and the
implementer read the spec alike.

The oracle owns **both halves of correctness**: `../parser-oracle/typescript`
authorises expectations, and `src/test/typescript-tests.ts` detects drift without being
able to re-bless. The in-repo gate takes no `ts.Program` and no network.

`ts-oracle` and `ts-impl` stay separate deliberately. If the implementer authors the
expectations, the suite catches regressions and never a wrong premise — the failure
Python paid for twice.

`ts-corpus` carries two jobs that pull against each other: mining wants more fixtures,
consolidating wants fewer. They were separate agents so neither could quietly win.
Merged, the guard is explicit — never prune the sole cover for a node kind, and report
every prune declined for that reason, so the human sees the tension instead of its
resolution.

## The gate before merging to main

```
npx tsx src/test/typescript-tests.ts
```

Mirrors the Python suite, plus one check Python could not have:

| check | proves |
|---|---|
| compiles | `tsc --noEmit` clean — the suite reports on code that builds |
| golden facts | no frozen fact moved; names the row and column that did |
| closed-world | every call links or is ambient, on a corpus whose ceiling is 100% |
| open-edges ratchet | the known-unresolvable count may fall, never rise |
| **tsc-adjudicated resolution** | every resolved call target equals `getResolvedSignature` |

That last row is the one to build first. It is the check Python never got, and it
turns resolution from a judgement call into a measurement.

## Where things live

| path | what |
|---|---|
| `src/schema/typescript/` | the contract: schema, generated `.dl`, generator, decision specs |
| `src/test/typescript-tests.ts` | the whole suite — no Program, no network |
| `src/test-data/typescript/categories/` | fixtures by entity kind |
| `src/test-data/typescript/verified/` | the admitted corpus and its frozen `_golden/` |
| `../parser-oracle/typescript` | the compiler-backed oracle. Re-freezing happens here, never in this repo. |

## Adding a test case

Same bar as Python: a fixture is admitted only if **every call site links to a
declared entity or is ambient** — measured, not judged. A shape that is resolvable
in principle but does not resolve yet goes in `categories/edge-cases/OPEN_*.ts`
and the ratchet tracks it.

One addition. Because the oracle knows types, a fixture must also state whether it
is **runtime-bearing or type-only**. A type-only fixture that produces call-graph
rows is a bug in the parser, not a gap in the corpus.
