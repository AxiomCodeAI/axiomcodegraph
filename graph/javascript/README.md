# The JavaScript engine

A call graph for JavaScript: for every call site, which function actually runs —
client → client, with the platform named as a terminal rather than guessed at, and a
dependency parsed from source linked as a library when one is staged.

```bash
# 1. IR (the parser package, separately)
node <parser>/dist/index.js <project> <slug> false <ir-dir>

# 2. solve
bash graph/pipeline/run-souffle.sh --language javascript \
     --client-ir <ir-dir> --library <lib-ir>[,<lib-ir>...] \
     --intermediate <scratch> --output <out>

# 3. or do all of it, with the oracle and the score
bash test/javascript/run-evaluation.sh <project> <work-dir> [--production]
```

---

## There are no types, so the engine tracks values

The TypeScript engine resolves `w.inc()` by finding the TYPE of `w` and looking `inc`
up in it. JavaScript writes the type of `w` nowhere: 0.165% of parameters carry a
syntactic annotation (all Flow, rejected), 36% carry a JSDoc one, and the rest is
inferred by the reader. What decides the target is what `w` HOLDS — `const w = new
Widget()`, an argument passed at a call this engine already resolved, a `@param
{Widget} w`, a returned expression, an exported member.

So the central relation is a may-analysis over VALUES, not types
(`resolution/value-flow.dl`):

| relation | meaning |
|---|---|
| `expr_value(E, K, I)` | expression E may evaluate to value (K, I) |
| `var_value(V, K, I)` | binding V may hold it |
| `param_value(P, K, I)` | parameter P may receive it |
| `prop_value(K, I, N, K2, I2)` | property N of value (K, I) may hold (K2, I2) |
| `this_value(M, K, I)` | `this` inside callable M may be (K, I) |
| `return_value(M, K, I)` | callable M may return (K, I) |

with eight value kinds, each a hash into one IR relation or a platform name:

| kind | id | example |
|---|---|---|
| `func` | js_method | an arrow, a function, a class method |
| `ctor` | js_type | the class value itself — `Widget` |
| `inst` | js_type | an instance — `new Widget()` |
| `proto` | js_type | `Widget.prototype` |
| `module` | js_module | `require('./x')`, `import * as ns` — the export surface |
| `obj` | js_expression | an object literal, keyed by the literal node |
| `arr` | js_expression / js_type_reference | an array, with `elem_value` for what it holds |
| `ambient` | the platform name | `Math.floor`, `path.join`, `new Map()` — resolves to nothing, classifies the site |
| `str` | the literal's text | a string literal, flowing like any value so `obj[key]` resolves when a literal reaches `key` |

Every rule is a may-analysis: a binding written twice holds both values, a parameter
passed two functions holds both, a call through it fans to both. That is the honest
set. **An untyped receiver produces nothing.** Fanning `x.get()` to every `get` in the
project has no soundness argument, and it is what makes a name-matching graph worse
than no graph; the site is a declared unknown instead.

**A staged library's parameters are not tracked.** Its bodies are read for what they
declare and return — an export surface, a class, a prototype member, `return app` — never
for what callers pass; a generic library is the shape whose parameters unify everything
(one utility library's modular files reached 31,533 values per export). What a library
does with a callback it is handed is a MODEL, stated per library in
`resolution/frameworks.dl`, and checked against execution in `test/javascript/realapp`.

The one closed-world assumption is on parameters: their values are the arguments at
the calls this engine resolved, and a caller it cannot see is a value it does not know.
`param_flow_assumes_closed_world` records that per parameter.

## What the parser gives, and what is left

* **The binder's answer.** Every identifier reference carries
  `resolvedBindingLinkHash` / `resolvedParameterLinkHash`, with hoisting and the
  temporal dead zone already decided. No name lookup is written in this engine.
* **The module graph in the expression relation.** `require()` is a call and
  `module.exports = X` is an assignment; the parser mints import/export rows from them
  with a link back to the expression, so the VALUE on the far side is read from the
  tree. `resolvedFilePath` is extension-less and joins the module's `qualifiedName`.
* **Members declared by assignment.** `F.prototype.m = function`, `F.prototype = {
  m() {} }`, `Object.assign(F.prototype, {...})` are js_method rows with an owner type,
  so pre-ES6 classes need no special case in member lookup.
* **JSDoc as a tree.** `@param {import('./x.js').default} node` is a type-reference row
  carrying the import hop the parser resolved.

What is left is everything about VALUES: name → value, the export surface, member
lookup up the `extends` chain, `this`, return values, arguments into parameters,
arrays. That is the engine, entirely.

## Layer order

| layer | file | what is JavaScript-specific about it |
|---|---|---|
| projections | `projections/*.dl` | column views, provenance-tagged `"client"` / `"lib"` |
| containment | `containment/ownership.dl` | the class scope a js_type has no FK to; a function declaration's binding → its js_method (no link either way) |
| module graph | `resolution/module-graph.dl` | one export surface for both systems, keyed by name with `default` for `module.exports = X`; a CommonJS default value's properties ARE its members |
| hierarchy | `resolution/type-hierarchy.dl` | ONE closure — every heritage form inherits members, there is no `implements` |
| value flow | `resolution/value-flow.dl` | the may-analysis above |
| arrays | `resolution/arrays.dl` | the one platform type modelled: `push`, `[i]`, `map`, `forEach`, `for..of`, `T[]`; `Map` / `Set` as collections, including an instance of a class that extends one (#619) |
| ambient | `resolution/ambient.dl` | platform names as values, so a site reached through one is classified from the value, not the syntax |
| JSDoc types | `resolution/reference-types.dl` | `@param`/`@type`/`@returns`, `import()` types, typedef aliases, wrappers |
| library models | `resolution/frameworks.dl` | what a handful of library calls DO to values, as facts: assign-like (`Object.assign`, `merge-descriptors`), inherit-like (`Object.setPrototypeOf`, `setprototypeof`, `Object.create`), a platform superclass (through an import, a binding, or a bare `extends Map`; `super.m()` and `super()` on it are ambient), and what express hands a route handler |
| parse gaps | `resolution/parse-gaps.dl` | what the parser could not read, joined to what it costs: a module marked partial, an unresolved import's cause, a receiver whose written type could not be read (#617) |
| callee resolution | `expression-resolution/callee-resolution.dl` | one rule per CALL FORM — the callee lives somewhere different in each |
| call edges | `call-edge-generation/*.dl` | eight confidence classes |

### The Java rule that must not be ported

A bare `m()` inside a class method is NOT an implicit-`this` call. It is a lexically
scoped reference, the binder resolved it, and resolving it against the enclosing class
would invent an edge to a same-named method the program never calls.

### `.call` / `.apply` / `.bind` are classified by name

The parser marks `f.call(o, a)` FUNCTION_CALL_CALL and moves the receiver into argument
position: the function that RUNS is `f`, and the oracle is written to answer with `f`'s
signature rather than `Function.prototype.call`. But `selector.apply(node)` on an object
with its own `apply` method gets the same kind. Both readings are derived; they cannot
both produce a target.

### Eight confidence classes

`known_edge`, `multi_inferred`, `boundary_lib`, `ambiguous_unknown` — plus three the
JVM model does not need:

* **`ambient_terminal`** — the callee or receiver value is the platform (`console.log`,
  `path.join`, `arr.forEach`). A correct end, not a blind spot; the parser's own triage
  measures this class at 15–24% of all sites. A site whose callee MAY also be a
  project function (`const f = cond ? mine : Math.floor`) is `multi_inferred` and
  carries an `ambient_terminal` row beside the project edge.
* **`implicit_constructor`** — `new C()` / `super()` where no constructor exists up the
  chain: the synthesized default runs.
* **`dynamic_terminal`** — `obj[expr]()`, `eval`, `import()`. No static target by
  construction; complete because it says so.
* **`fan_capped`** — more targets than `--dispatch-cap` (default 20): refused rather
  than emitted, as in the Java and Python rule sets, and counted.

Plus two edge classes that are not resolutions of the site's callee but edges INTO a
function the site hands over (`call-edge-generation/callbacks.dl`): **`callback_registered`**
(`xs.forEach(f)`, `p.then(f)`, `emitter.on('x', h)`, `setTimeout(f)`) and
**`event_dispatch`** (`x.emit('x')` → every `x.on('x', h)` on a value x may hold). Both
feed reachability; neither is scored against the compiler, which has no notion of them.

## Validated against execution, not only the compiler

`graph/test/javascript/torture/` instruments every function body (the caller carried in an
`AsyncLocalStorage`) and checks each executed `caller → callee` edge against the graph:
0.98 on a hand-written program covering every invocation form; **0.97 on a real express
service with its 68 dependencies installed, staged as `--library` and instrumented too**
(`graph/test/javascript/realapp/`), where the missing three are a lazy `Object.defineProperty`
getter, lodash's runtime-built API, and a tracer artifact — each named in `known-missing.txt`.

## How it is measured

Ground truth is **`checker.getResolvedSignature`** from a `ts.Program` built with
`allowJs` + `checkJs` over the project's own files, out of process
(`test/javascript/ground-truth/tsc-oracle.mjs`). The engine resolves from the parser's
IR; the oracle resolves from source; the two share nothing but the text.

JavaScript types are inferred, and the checker gives up on a callee of type `any` —
roughly half of all sites on the parser's corpus. Those sites are reported UNDECIDED
and enter no rate: an engine target there is neither confirmed nor refuted. The
client→client rates are computed over the sites the compiler decided.

Scoring is per SITE (`ground-truth/score.py`): `EXACT`, `SOUND_SUPERSET`, `WRONG`,
`MISSED`, plus the buckets that are not client→client — `LIB_AMBIENT_OK` /
`LIB_MISSED` (the compiler named a `.d.ts`), `SYNTHESIZED_OK` (an implicit
constructor), `TYPE_ONLY_TARGET` (the compiler named a JSDoc function type),
`TARGET_OUTSIDE_IR` (a `.ts` sibling the JavaScript front end never saw), `DECL_IMPL_OK`
(an in-project `.d.ts` the compiler preferred to the body beside it).

## Every suppression is countable

| relation | what it records |
|---|---|
| `unresolved_receiver` | every unresolved site with its reason: `receiver_untyped`, `member_absent` (the row to read first), `callee_untyped`, `no_target`, `dynamic`; beside `receiver_untyped`, `receiver_type_unreadable` when the receiver's written JSDoc type is a parse gap |
| `import_unresolved` / `import_binding_unresolved` | a dependency not staged vs a name the module does not export |
| `import_unresolved_cause` | why: `computed_specifier` (no static answer exists), `not_staged` (a staging decision), `builtin` (a terminal) |
| `parse_gap` / `module_partial` / `site_in_partial_module` | every construct the parser could not represent, per module; the modules a `PARSE_ERROR`, `eval` or `with` leaves partial; the unresolved sites inside one |
| `package_entry` | what each package exposes under a specifier (`main` / `module` / `exports`, per condition), resolved to a module or a named absence (#616) |
| `heritage_unresolved` / `heritage_dynamic` | a supertype that did not resolve; a computed `extends` |
| `type_ref_unresolved` | which JSDoc type NAMES reached no class |
| `param_flow_assumes_closed_world` | every parameter whose values are the visible callers' arguments |

## What is not built

* **JSX component calls do not exist in the IR.** The JavaScript schema has no JSX call
  kind, so `<Comp/>` is neither a site nor a miss; the oracle counts and excludes them.
* **Primitive results are not typed.** `this.greet().toUpperCase()` is
  `ambiguous_unknown`, not `ambient_terminal`: nothing here knows `greet` returns a
  string.
* **Inner defaults of a destructured parameter** (`function f({ cb = () => {} })`) are
  not attributed (PD-JS-5).
* **Strings are literals only.** `{ ['a' + 1]: f }` and `obj['pre' + k]()` are not
  concatenated.
* **Library bodies are not expanded.** A `boundary_lib` edge is marked and not followed.

`PARSER-DEFECTS.md` lists the parser gaps the rules work around (one of them since fixed), with the join each
workaround uses so it can be retired.
