# Field classification — TIER 3 spec (the residue only)

**Author:** A0. **Implementer:** A3. **Status:** proposed.

This document covers **only what neither CPython's parse tree nor CPython's runtime
can adjudicate.** Everything adjudicable was promoted out of it — see the tier table
below and the predicates in `src/test/python-oracle/`.

> ## Read this before using anything here
>
> **Tier 3 is weaker than tiers 1 and 2, and the difference is not cosmetic.**
>
> Tier 1 reads a parse tree. Tier 2 asks a live object. **Tier 3 is me deciding.**
> What it buys is *author separation* — A0 wrote it, A3 implements it, so a
> disagreement is visible rather than encoded twice by the same hand. That is worth
> having, and it is the only thing it is worth.
>
> It buys **no ground truth**. If a rule below is wrong, every fixture that agrees
> with it is also wrong, and no amount of green tests will say so. Treat a tier-3
> agreement as "A3 implemented what A0 specified", never as "this is correct".
>
> Report tier 3 separately. Do not aggregate it with Gate 1.

---

## Tier classification, with per-field justification

| Field | Tier 1 (ast) | Tier 2 (inspect) | Tier 3 (this doc) |
|---|---|---|---|
| **importKind** | **8 of 9 values** | — | `DYNAMIC`; two precedence/enum questions |
| **methodKind** | 13 of 19 values | 6 of 19 values | priority order; the unrecognised-decorator default (**measured: 7.1% genuine error**, §2.3) |
| **typeCategory** | evidence only | **all 10 values** | priority order on collision; functional NamedTuple |
| **typeModifier** | `FINAL`, `SLOTS` | **8 of 10 values** | `CALLABLE_INSTANCE` (undefined) |

**Every claim below was verified against CPython 3.10.4, not assumed.** Three of the
four original hypotheses were understated; the details are in §5.

---

## 1. importKind — 8 of 9 promoted to Tier 1

Verified fully mechanical from `ast`:

| Node shape | kind |
|---|---|
| `ast.Import`, no `asname` | `MODULE_IMPORT` |
| `ast.Import`, `asname` set | `MODULE_IMPORT_ALIAS` |
| `ImportFrom`, `level == 0`, `module == "__future__"` | `FUTURE` |
| `ImportFrom`, `level == 0`, `names[0].name == "*"` | `FROM_WILDCARD` |
| `ImportFrom`, `level == 0`, `asname` set | `FROM_MEMBER_ALIAS` |
| `ImportFrom`, `level == 0` | `FROM_MEMBER` |
| `ImportFrom`, `level > 0`, `"*"` | `RELATIVE_WILDCARD` |
| `ImportFrom`, `level > 0` | `RELATIVE_MEMBER` |

Implemented in `emit_oracle.py :: import_kind_ast`. No judgment, no name list.

### Residue 1.1 — `DYNAMIC` is not an import node at all

`__import__("x")` and `importlib.import_module("x")` parse as `Call`, inside `Assign`
or `Expr`. There is no import node, so no node-shape rule can find them; recognising
them needs a **name list**, which is judgment.

**Decision procedure**, in order:

1. The node is `ast.Call`, and
2. its callee dotted path is exactly one of:
   `__import__`, `importlib.import_module`, `importlib.__import__`,
   `imp.load_module`, `imp.load_source`, `runpy.run_module`, `runpy.run_path`, and
3. it has ≥ 1 positional argument.

Then `importKind = DYNAMIC`, `importedPath` = the first argument's literal value if it
is a string constant, else `""`, and `resolvedTargetKind = UNRESOLVED`.

An `importlib` call reached through an alias (`from importlib import import_module as
imp_mod`) is **out of scope**: resolving it needs the binding table, and importKind is
computed before resolution. Emit nothing rather than half-resolve.

**Rationale for the list, not a heuristic:** any call could import. A prefix match on
`import` would catch `self.import_config()`. An exact list is wrong in a *bounded,
enumerable* way; a heuristic is wrong unboundedly.

### Residue 1.2 — the enum cannot express relative + alias

`from .rel import thing as aliased` is `level=1` **and** `asname` set. The enum has
`RELATIVE_MEMBER` and `FROM_MEMBER_ALIAS` but no `RELATIVE_MEMBER_ALIAS`. This is
decidable from ast and *inexpressible* in the schema — a schema gap, not an ast gap.

**Decision: relativity wins. Emit `RELATIVE_MEMBER`, and populate `aliasName` (c11).**

Relativity changes *resolution* (which module is meant); aliasing only changes the
bound name, and `aliasName`/`originalName` already record it losslessly. So no
information is lost, whereas choosing `FROM_MEMBER_ALIAS` would lose the level.

The oracle emits `residue: "RELATIVE_MEMBER_ALIAS"` on these rows so the count is
visible. **Filed for A3/human:** if the count is material, add the enum value — that
is free (enum values are not the frozen contract; column order is).

### Residue 1.3 — `FUTURE` versus alias

`from __future__ import annotations as ann` is legal and satisfies both `FUTURE` and
`FROM_MEMBER_ALIAS`.

**Decision: `FUTURE` wins, unconditionally.** `__future__` changes compilation
semantics — PEP 563 stops annotations being visited at all, which the oracle already
records as a known divergence. Classifying it as an ordinary aliased member would hide
the one thing about it that matters. `aliasName` still carries the alias.

---

## 2. methodKind — the priority order

Tier 1 decides the **structural** answer (`emit_oracle.py :: method_kind_ast`):
`LAMBDA`, `NESTED_FUNCTION`, `CONSTRUCTOR`, `ALLOCATOR`, `DUNDER_METHOD`,
`INSTANCE_METHOD`, `FUNCTION`, `GENERATOR`, `ASYNC_FUNCTION`, `ASYNC_GENERATOR`,
`MODULE_INITIALIZER`, `CLASS_INITIALIZER`, and — by LANGUAGE RULE, not decorator —
`CLASS_METHOD` for `__init_subclass__` / `__class_getitem__`.

Tier 2 decides the **descriptor** answer (`emit_introspection.py :: method_kinds`):
`STATIC_METHOD`, `CLASS_METHOD`, `PROPERTY_GETTER/SETTER/DELETER`, `ABSTRACT_METHOD`.

What remains is **which wins when both apply** — and that is not observable, because
`methodKind` is a single column and Python allows the conditions to co-occur.

### 2.1 The decision procedure — evaluate in this exact order, first match wins

```
 1. not a def/lambda                          -> not a py_method
 2. synthetic <module>                        -> MODULE_INITIALIZER
 3. synthetic <classbody>                     -> CLASS_INITIALIZER
 4. ast.Lambda                                -> LAMBDA
 5. @overload present                         -> OVERLOAD_STUB
 6. @property / @x.setter / @x.deleter        -> PROPERTY_GETTER | _SETTER | _DELETER
 7. @staticmethod                             -> STATIC_METHOD
 8. @classmethod                              -> CLASS_METHOD
 9. @abstractmethod (and 5-8 did not match)   -> ABSTRACT_METHOD
10. async def + yield in body                 -> ASYNC_GENERATOR
11. async def                                 -> ASYNC_FUNCTION
12. yield / yield from in body                -> GENERATOR
13. enclosing scope is a class:
       name == "__init__"                     -> CONSTRUCTOR
       name == "__new__"                      -> ALLOCATOR
       dunder name                            -> DUNDER_METHOD
       otherwise                              -> INSTANCE_METHOD
14. enclosing scope is a function/lambda/comp -> NESTED_FUNCTION
15. otherwise                                 -> FUNCTION
```

`methodModifier` is a **set** and is not subject to this ordering: it records every
applicable flag (`ASYNC`, `GENERATOR`, `STATIC`, `CLASS`, `PROPERTY`, `SETTER`,
`DELETER`, `ABSTRACT`, `OVERLOAD`, `FINAL`, `CACHED`, `SYNTHETIC`). **Nothing is lost
by the ordering above** — a `@property @abstractmethod` is `PROPERTY_GETTER` with
`ABSTRACT` in its modifier set. That is the whole reason the ordering is safe to fix.

### 2.2 The named ambiguous cases, resolved up front

| Case | Verdict | Why |
|---|---|---|
| `@property` + `@abstractmethod` (property outermost) | `PROPERTY_GETTER`, modifier `ABSTRACT` | Verified: the runtime object is a `property` with `__isabstractmethod__=True`. Callers see an attribute, so the access shape is what matters. |
| `@abstractmethod` + `@property` (reversed) | **cannot occur in working code** | Verified: raises `AttributeError: attribute '__isabstractmethod__' of 'property' objects is not writable` **at class creation**. `ast` still sees it. Emit per rule 6, and emit a `py_parse_gap`-style note; do not special-case broken code. |
| `@staticmethod` that declares `self` | `STATIC_METHOD` | The descriptor is authoritative; `self` is then an ordinary first parameter with `isReceiverParameter=false`. Naming is not binding. |
| `@classmethod` + `@property` | `PROPERTY_GETTER`, modifier `CLASS` | Legal on 3.9–3.10 only (removed in 3.11). Rule 6 precedes rule 8 so this needs no exception. Access shape again dominates. |
| `functools.cached_property` | `PROPERTY_GETTER`, modifier `CACHED` | Verified distinct descriptor type. It is an attribute access at the call site, which is what `methodKind` exists to tell the engine. |
| `async def` with `yield` | `ASYNC_GENERATOR` | Verified `inspect.isasyncgenfunction`. Rule 10 precedes 11. |
| `def` with `yield` | `GENERATOR` | Rule 12. |
| lambda assigned in a class body | `LAMBDA` | Verified: at runtime it is an ordinary `function`, indistinguishable from a `def`. **Only ast can tell**, so tier 1 owns it and rule 4 precedes everything class-related. |
| nested `def` inside a method | `NESTED_FUNCTION` | Rule 14. Enclosing scope, not enclosing class, decides. |
| `@overload` stubs | `OVERLOAD_STUB` | **Tier 1 only.** Verified `typing.get_overloads` does not exist on 3.10, so the stubs are *invisible at runtime* — only the final implementation is in `__dict__`. Rule 5 is early because a stub must never become a call target. |

### 2.3 The default for an unrecognised decorator — MEASURED, not asserted

This is the highest-risk decision in the document, and it is the only one that is
**open-world**: every other tier-3 item is a precedence rule over cases I enumerated,
whereas this one is applied to decorators nobody has seen. **No fixture can contradict
it**, because a fixture only ever contains decorators someone thought to write.

So it was measured instead, against a population of decorators this project did not
author: `oracle/measure_decorator_default.py` parses stdlib source with `ast`, imports
the module, and compares the structural prediction against what the name **actually
became** at runtime. Tier 2 is ground truth for exactly this question.

**Result over 167 stdlib modules:**

| | |
|---|---|
| methods governed by the default (no recognised decorator present) | 28 |
| structural prediction correct | 24 |
| **wrong** | **4 → 14.3%** |
| of which measurement artifact (C-implemented class shadows the Python source) | 2 |
| **genuine failures** | **2 → 7.1%** |

**Decision, unchanged but now evidenced: an unrecognised decorator does NOT change
`methodKind`.** Fall through to rules 10–15 and classify structurally. Additionally set
`methodModifier += DECORATED` and record every decorator in `py_decorator`.

**The failure mode is single and nameable: a decorator that returns a non-function
descriptor.** Both genuine failures are `@DynamicClassAttribute` on `enum.Enum.name`
and `.value`, where the runtime object is a custom descriptor and the source looks like
an ordinary method. `@lru_cache`, `@wraps`, `@contextmanager` and the rest of the tail
all preserve the structural answer.

**This is detectable, and must be reported rather than absorbed.** When tier 2 is
available (stdlib) and the runtime object is neither a function nor a known descriptor,
emit `residue = "DECORATOR_RETURNS_DESCRIPTOR:<name>"`. Over the mined corpus tier 2 is
unavailable by policy, so the residue count is the only signal — which is why §7 asks
A5 to report it.

**Two things the measurement changed in tier 1, which is the point of measuring:**

1. **`@x.setter` / `@x.deleter` were not recognised.** 21 of the first 36 apparent
   "default failures" were property setters across the stdlib. That was a bug in my
   tier-1 table, not evidence about the default — the first measured rate of 62% was
   mostly my own error.
2. **Three dunders are implicitly converted by the language**, regardless of
   decorators (verified on 3.10.4): `__new__` → `staticmethod`,
   `__init_subclass__` → `classmethod`, `__class_getitem__` → `classmethod`. These are
   language rules, not decorator effects, so they now sit in tier 1 and outrank
   everything. Rules 13a–13b below.

Rule 13 is therefore amended:

```
13. enclosing scope is a class:
      name in {__init_subclass__, __class_getitem__} -> CLASS_METHOD   (language rule)
      name == "__new__"                              -> ALLOCATOR      (implicitly static)
      name == "__init__"                             -> CONSTRUCTOR
      dunder name                                    -> DUNDER_METHOD
      otherwise                                      -> INSTANCE_METHOD
```

**Known limit, stated rather than hidden:** for a decorator that replaces the object
with a non-callable or a different object, `methodKind` will be structurally right and
semantically wrong. `py_decorator.replacesTarget` is the signal, and the engine must
consult it. Measured frequency of that case in the stdlib: **7.1%** of
default-governed methods.

## 3. typeCategory — priority order on collision

All 10 values are runtime-detectable (tier 2). The residue is **which wins**.

**Measured, not assumed:** across **909 stdlib classes**, collisions occur in
**8 cases (0.9%)**, all one shape: `PROTOCOL_TYPE + ABC_TYPE + GENERIC_TYPE`
(`typing.Protocol`, `typing.SupportsAbs`, and siblings). Synthetic probing found one
more real shape: `DATACLASS_TYPE + EXCEPTION_CLASS_TYPE`.

### 3.1 The decision procedure — first match wins

```
1. typing.is_typeddict(cls)                    -> TYPEDDICT_TYPE
2. cls._is_protocol                            -> PROTOCOL_TYPE
3. isinstance(cls, enum.EnumMeta)              -> ENUM_CLASS_TYPE
4. issubclass(cls, tuple) and has _fields      -> NAMEDTUPLE_TYPE
5. dataclasses.is_dataclass(cls)               -> DATACLASS_TYPE
6. issubclass(cls, BaseException)              -> EXCEPTION_CLASS_TYPE
7. issubclass(cls, type)                       -> METACLASS_TYPE
8. isinstance(cls, abc.ABCMeta)                -> ABC_TYPE
9. typing.Generic in cls.__mro__               -> GENERIC_TYPE
10. otherwise                                  -> CLASS_TYPE
```

**Ordering rationale.** The rule is *most specific first*, where "specific" means the
narrower set:

- `TYPEDDICT` and `PROTOCOL` first because both are *structural* declarations that say
  what the class is FOR. Every Protocol is also an ABC and a Generic — that is an
  implementation detail of `typing`, not a description of the class. Answering `ABC` for
  `typing.SupportsAbs` would be true and useless.
- `NAMEDTUPLE` and `DATACLASS` before `EXCEPTION`: a `@dataclass class E(Exception)` is
  a dataclass *whose base happens to be* Exception. The generated `__init__` and field
  order are the load-bearing facts; `EXCEPTION` is recoverable from `py_type_base`
  anyway, so nothing is lost.
- `ABC` late because `ABCMeta` is extremely common as an implementation vehicle.
- `GENERIC` last: it is nearly always a *modifier* on some other category, and the
  `GENERIC` entry in `typeModifier` already records it.

**Nothing is lost by this ordering.** Every losing predicate is preserved: as a
`typeModifier` flag (`ABSTRACT`, `GENERIC`, `FROZEN`), in `py_type_base` (the Exception
base, the Protocol base), or in `mroKind`.

### 3.2 Functional NamedTuple / TypedDict — ast and runtime disagree

`Point = collections.namedtuple("Point", "x y")` and
`TD = TypedDict("TD", {"a": int})` create real classes **at runtime** but are
**`Assign` nodes** to `ast`. Tier 2 sees a class; tier 1 sees an assignment.

**Decision: no `py_type` row.** The parser emits a `py_binding` with
`targetEntityKind = TYPE`, and a `py_type_inference` row with
`evidence = CONSTRUCTOR_CALL` (engine-emitted). A class-statement fixture covers the
class-syntax form.

**Why:** `py_type`'s PK chains off `(module, qualifiedName, name, startLine, endLine)`
of a **class statement**. A functional form has no class statement, so the key would
have to be synthesised — inventing a declaration site that does not exist in the
source. This is the same discipline as refusing `OBJECT_CREATION` in §4.5 of the
schema. This is a **known recall gap**, and it should be reported as one, not papered
over.

### 3.3 Nested and conditionally-defined classes

Category is independent of placement — `py_type.typePlacement` (c6) already carries
`NESTED_PLACEMENT`, `LOCAL_PLACEMENT`, `CONDITIONAL_PLACEMENT`, `TYPE_CHECKING_PLACEMENT`.
Apply §3.1 unchanged.

Two consequences worth stating: a class inside `if TYPE_CHECKING:` **never exists at
runtime**, so tier 2 cannot see it and only tier 1 evidence applies. A class defined
inside a function likewise is not in the module namespace, so tier 2 misses it. Both
are tier-2 *blind spots*, not parser errors — the harness must not report them as
recall failures.

---

## 4. typeModifier — mostly promoted; one value is undefined

**The original assumption that this is pure fiat was wrong.** 8 of 10 values are
runtime-detectable and are now tier 2; 2 more are tier 1. Legal values, enumerated
first as requested:

| Value | Tier | Predicate |
|---|---|---|
| `ABSTRACT` | 2 | `cls.__abstractmethods__` non-empty, or `isinstance(cls, ABCMeta)` |
| `FINAL` | **1 (ast only)** | `@typing.final` decorator. **Verified: sets no attribute before 3.11**, so there is no runtime witness on 3.10.4. |
| `FROZEN` | 2 | `cls.__dataclass_params__.frozen` |
| `SLOTS` | 1 and 2 | `__slots__` in the class body / in `cls.__dict__` |
| `GENERIC` | 2 | `typing.Generic in cls.__mro__` |
| `RUNTIME_CHECKABLE` | 2 | `cls._is_runtime_protocol` |
| `HAS_GETATTR` | 2 | `__getattr__`/`__getattribute__` in `cls.__dict__` |
| `HAS_SETATTR` | 2 | `__setattr__` in `cls.__dict__` |
| `HAS_CALL` | 2 | `__call__` in `cls.__dict__` |
| `CALLABLE_INSTANCE` | **3 — undefined** | see below |

Measured over 909 stdlib classes: `ABSTRACT` 55, `SLOTS` 53, `HAS_GETATTR` 25,
`HAS_CALL` 23, `HAS_SETATTR` 4.

### 4.1 Residue — `CALLABLE_INSTANCE` has no definition distinct from `HAS_CALL`

A class defines `__call__` **iff** its instances are callable. The two values are
coextensive as written, so one of them is dead.

**I am not inventing a distinction to justify the column.** Two coherent options:

- **(a) Remove `CALLABLE_INSTANCE`.** Enum values are not the frozen contract, so this
  is free. Recommended.
- **(b) Redefine** `HAS_CALL` = `__call__` declared *on this class*, and
  `CALLABLE_INSTANCE` = callable *including inherited* `__call__`. Both detectable
  (`in cls.__dict__` vs `hasattr(cls, "__call__")`). Only worth it if the engine
  actually needs the inherited case.

**Filed for A3 and the human.** Until decided, the oracle emits `HAS_CALL` only and
never `CALLABLE_INSTANCE`; a parser emitting the latter will show as a disagreement,
which is the correct outcome for an undefined field.

---

## 5. Where the original read was wrong

Recorded because the corrections changed the tiering, and because a spec that only
confirms its brief is not evidence of anything.

| Original claim | Verified result |
|---|---|
| "importKind is fully mechanical" | **8 of 9.** `DYNAMIC` is not an import node at all, and the enum cannot express relative+alias. |
| "methodKind is largely adjudicable via inspect" | **Partly.** Descriptors give 6 values, but `OVERLOAD_STUB` is *invisible at runtime on 3.10* (`typing.get_overloads` is 3.11+) and a class-body lambda is indistinguishable from a `def`. Both fall to tier 1. |
| "typeCategory is partly runtime-detectable" | **Fully** — all 10 values. Only the collision order is residue, and collisions are 0.9% of stdlib classes. |
| "typeModifier I assumed was pure fiat" | **Wrong, as suspected.** 8 of 10 are tier 2, 2 are tier 1, and exactly one (`CALLABLE_INSTANCE`) is genuinely undefined. |

One further correction, to my own work: the first version of the tier-2 emitter
excluded `ABC_TYPE`/`GENERIC_TYPE` when `_is_protocol` was set — which is a §3.1
priority decision smuggled into tier 2, and it made collisions read as 0%. Removed;
tier 2 now reports every predicate that holds and flags the collision, and the real
rate is 0.9%.

---

## 7. Residue is now load-bearing — it needs a gate

The residue mechanism carries real weight: `DECORATED:<names>`,
`RELATIVE_MEMBER_ALIAS`, `DECORATOR_RETURNS_DESCRIPTOR`, and the absence of
`CALLABLE_INSTANCE`. Each marks a place where the oracle declined to answer.

**That is exactly where wrongness will hide.** A residue row is not a failure, so
nothing currently counts them; a rising residue rate would accumulate silently while
every gate stayed green.

**Requested of A5** (logged in `coordination/schema-oracle.jsonl`): report **residue
rate per field** in `coverage-report.jsonl`, alongside node-type coverage, as a
first-class progress signal:

```
residueRate = rows with non-empty residue / total rows, per field per sweep
```

with a per-kind breakdown, and the top unrecognised decorator names by frequency.
A rise means the corpus grew a construct the spec does not cover — which is
information, and currently invisible.

---

## 6. For A3

- Predicates: `src/test/python-oracle/oracle/emit_oracle.py` (tier 1, in the
  `classifications` block) and `oracle/emit_introspection.py` (tier 2, **stdlib only —
  it refuses anything else, verified against `pip`**).
- Tier labelling: `harness/classification.ts :: tierFor`.
- **Do not run tier 2 over the mined corpus.** It imports, which executes code.
- **If the parser already contradicts this spec, file it — do not bend the spec.**
  Two items are already filed above: the missing `RELATIVE_MEMBER_ALIAS` enum value
  (§1.2) and the undefined `CALLABLE_INSTANCE` (§4.1).
