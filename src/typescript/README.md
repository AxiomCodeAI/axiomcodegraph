# The TypeScript engine

A type-directed call graph for TypeScript: for every call site, which function can
actually run — client → client, and client → library, with a real declaration on the
far side rather than a name or a package.

```bash
# 1. IR (the parser package, separately)
node <parser>/dist/index.js <project> <slug> false <ir-dir>

# 2. solve
bash src/pipeline/run-souffle.sh --language typescript \
     --client-ir <ir-dir> --library <lib-ir>[,<lib-ir>...] \
     --intermediate <scratch> --output <out>

# 3. or do all of it, with the oracle and the score
bash test/typescript/run-evaluation.sh <project> <work-dir>
```

---

## What the parser gives, and what is left

Two things here are materially better than the JVM front end supplies, and both change
how much rule text is needed:

* **`referencedEntityHash` is populated.** The binder already resolved identifier
  references to declarations — 18,147 VARIABLE, 14,386 PARAMETER, 5,410
  IMPORT_BINDING, 359 METHOD, 193 TYPE on this repository's own source. The Java
  engine re-binds receivers by name inside the enclosing method because its IR has
  nothing there; none of that machinery exists here.
* **`ts_call_site` already decomposes the call** — callee name, receiver expression,
  caller function. Java reconstructs all three from expression shape.

What is left is everything about TYPES. `ts_type_reference.resolvedGroupKey` is empty
in all 18,192 rows, by design: the parser has no checker. So name → type, the module
graph, member lookup, dispatch and overload selection are the engine, entirely.

---

## Layer order ported from Java; five layers that are not Java at all

| layer | file | what makes it different here |
|---|---|---|
| projections | `projections/*.dl` | join-free views, as everywhere |
| containment | `containment/ownership.dl` | mostly a column read — the parser walked blocks already. Exists for the residue: a call at module scope has no enclosing function and is attributed to the module's synthetic initializer |
| **module graph** | `resolution/module-graph.dl` | **no Java analogue.** An import names a module AND a name in it, and the name may travel a re-export chain first |
| name resolution | `resolution/name-resolution.dl` | three scopes, not six; imports shadow nothing |
| **library scope** | `resolution/lib-scope.dl` | **no Java analogue.** A library's OWN type references have to be resolved, in the library's own scope |
| type resolution | `resolution/type-resolution.dl` | composite descent: a union is N rows, an array means `Array`, a primitive means its global interface |
| hierarchy | `resolution/type-hierarchy.dl` | `extends` and `implements` are DIFFERENT closures — see below |
| **satisfaction** | `resolution/structural-satisfaction.dl` | **no Java analogue.** 60.4% of classes implement nothing explicitly |
| member lookup | `resolution/member-lookup.dl` | keyed on the merged entity; static and instance are two tables; a shape can own members |
| **overload sets** | `resolution/overload-sets.dl` | **no Java analogue.** 44.3% of resolved targets are bodiless, for three different reasons |
| generics | `resolution/generics.dl` | `find(): T \| undefined` substituted from the receiver's own type arguments |
| expression typing | `expression-resolution/expr-type.dl` | four output relations, not one — a value can be a module or a function, neither of which has a type |
| callee resolution | `expression-resolution/callee-resolution.dl` | includes the one Java rule that must NOT be ported |
| overloads | `expression-resolution/overload.dl` | arity is a RANGE; selection is by declaration ORDER, not a specificity lattice |
| call edges | `call-edge-generation/*.dl` | six confidence classes, not four |

### The Java rule that must not be ported

In Java an unqualified `m()` is an implicit-`this` call and resolves against the
enclosing type. **In TypeScript it is not.** A bare `m()` inside a method body is a
lexically scoped function reference, and resolving it against the enclosing class
invents an edge to a same-named method the program never calls. Receiverless calls go
through the binder's answer and the module scope, never through the enclosing type.

### `extends` and `implements` are different edges

`ts_type_heritage.inheritsMembers` says which. `extends` inherits members;
`implements` asserts conformance and inherits **nothing**. Walking an implements edge
to find an inherited method is correct in Java and invents members here — a class that
`implements Logger` without declaring `warn()` has no `warn()`. So there are two
closures: `type_inherits` (members) and `type_subtype` (conformance, for dispatch
only).

### Six confidence classes

`known_edge`, `multi_inferred`, `boundary_lib`, `ambiguous_unknown` — plus two that
Java does not need:

* **`ambient_terminal`** — resolved to a `declare`d signature with no body in any IR.
  `fs.readFile` has no TypeScript body to find. A correct END, not a blind spot.
* **`intrinsic_terminal`** — `<div/>` resolves into `JSX.IntrinsicElements`, and
  `import("m")` is a module load. Neither reaches project code, and neither is a miss.

Without those two, nearly half the graph reports as a gap.

---

## How it is measured

Ground truth is **`checker.getResolvedSignature`** — the TypeScript compiler, run out
of process, over the same source. The engine resolves from the parser's IR through its
own rules; the oracle resolves from source through `tsc`; the two share nothing but
the text. `test/typescript/ground-truth/`.

The site universes agree exactly. On the Parser repository both find **14,076** call
sites; on remeda both find **23,011**; every one joins on its source span. For a
conservation contract that is the strongest evidence available, and it is what makes
the accuracy numbers mean anything.

Scoring is **per site, not per edge** — a 12-way dispatch set is one site a reader
cannot trust, not 1 agreement and 11 over-approximations.

| bucket | meaning |
|---|---|
| `EXACT` | one target, and it is the compiler's |
| `SOUND_SUPERSET` | several targets, the compiler's among them |
| `WRONG` | targets named, the compiler's not among them — the serious one |
| `MISSED` | the compiler named a declaration, the engine found none |
| `SYNTHESIZED_OK` | an implicit constructor: the compiler resolved and there is nothing to point at, and the engine correctly invented nothing |

### The dispatch envelope — the CHA/RTA analogue

The JVM harness reads two truths from class files: the declared target, and the
class-hierarchy envelope. `test/typescript/ground-truth/tsc-envelope.mjs` builds the
second, and **CHA does not port**: the relation that governs dispatch here is
assignability, not the inheritance graph, because 60.4% of classes satisfy their
interfaces with no `implements` and 21.5% of assignable pairs appear in no syntax at
all. So the envelope is built with `checker.isTypeAssignableTo` over the project's
classes:

* **CHA** — every project class assignable to the receiver's type that has the member.
* **RTA** — the subset whose class is actually instantiated somewhere.
* Plus the **overload set** of the resolved symbol, because picking a different
  overload of the same function is an over-approximation, not a wrong target.

An engine target inside the envelope is a dispatch possibility; one outside it is a
demonstrable false positive.

---

## What is not built

Stated because a graph you cannot trust the boundaries of is not useful.

* **JSX component calls do not exist in the IR.** The engine's rules are written; the
  parser emits zero rows carrying `JSX_COMPONENT_CALL` (PARSER-DEFECTS.md, PD-TS-1).
  144 of zustand's 4,346 sites are invisible today, and on a React application the
  ratio would invert.
* **Generic inference through a callback** — `map<U>(f: (t: T) => U): U[]` — is not
  substituted. `U` is bound by the argument's return type, which is inference rather
  than substitution, and guessing it would fabricate. Those sites stay unresolved and
  countable.
* **Structural satisfaction is name-based**, comparing member names and not member
  types. It is kept off the primary resolution path for exactly that reason: it is the
  one relation here that could fabricate rather than over-approximate.
* **`../` in a re-export specifier** is not resolved; `./` and non-relative are.
  `export_specifier_unresolved` counts what is left.
* **Library bodies are not expanded.** A `boundary_lib` edge is marked and not
  followed, as in the client-only Java build.

---

## Every suppression is countable

A trade that cannot be counted cannot be defended, so each narrowing exports what it
dropped:

| relation | what it records |
|---|---|
| `unresolved_receiver` | every unresolved site, with the reason: `receiver_untyped` (a staging gap), `member_absent` (an engine or parser defect), `no_receiver`, `other_form` |
| `arity_rejected` | every candidate arity matching dropped, with the counts that dropped it |
| `type_rejected` | every candidate argument typing dropped |
| `import_unresolved` / `import_binding_unresolved` | a dependency not staged vs a name not exported |
| `type_ref_unresolved` | which type NAMES have no declaration — the fastest read on which library is missing |
| `export_specifier_unresolved` | re-export specifiers that reached no module |
| `module_export_recovered` / `import_binds_interop` | the size of the PD-TS-2 workaround |
| `heritage_unresolved` / `heritage_dynamic` | a supertype that did not resolve, and a `extends mixin(Base)` that has no static answer |
| `satisfaction_unmeasured` | a required interface member no candidate class has |
