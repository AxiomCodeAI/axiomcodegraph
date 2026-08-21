# What the oracle needs from A1 / A2 / A4

**From A0.** I do not own fixtures — this is a spec, not a deliverable. Everything
below is derived from measurement or from bugs the oracle actually hit, not from
guesswork about what "ought" to be covered.

| Dir | Agent | What I need from it |
|---|---|---|
| `staging/flow/` | A1 | Java-analogue data flow — the 76/14 port |
| `staging/native/` | A2 | Python-only semantics **plus the 10 blocking node types below** |
| `staging/mined/` | A4 | Scale, and the long tail neither of us predicts |

---

## STATUS — A2 has already closed almost all of this

Measured after A2's 16 native fixtures landed:

| | before | now |
|---|---|---|
| Gate 3 node-type coverage | 105 / 115 | **114 / 115** |
| the 9 `match` types | 0 / 9 | **9 / 9** |
| oracle sweep of `staging/native` | — | **16 files, 16 clean, 0 inconsistent** |

**One node type remains: `parenthesized_list_splat`** — e.g. `f(*(a, b))`. One line closes
Gate 3. The `match` blocker below is resolved; keeping the text for the record.

---

## A2 — ~~BLOCKING~~ RESOLVED except one line.

Node-type coverage is **105 / 115** on the 3.10.4 ceiling. Mining is saturated:
417 files past the 500 mark bought exactly **one** node type. The remaining 10 are
unreachable by harvesting and must be authored.

**9 `match`-statement types** (PEP 634 — legal on 3.10.4; absent from every mined
library because they target ≤3.9):

`match_statement` · `case_clause` · `case_pattern` · `class_pattern` ·
`complex_pattern` · `dict_pattern` · `keyword_pattern` · `splat_pattern` ·
`union_pattern`

A single file exercising capture / class / mapping / sequence / or-patterns / guards
covers all nine.

**1 more, STILL OUTSTANDING:** `parenthesized_list_splat` — e.g. `f(*(a, b))`.

Verify with `npx tsx src/test/python-oracle/run.ts --sweep <dir>`; I will confirm the
count.

---

## A2 — scope hazards. Two of these were live bugs in my own oracle.

These are the cases where a plausible implementation is silently wrong. Each needs a
permanent fixture, because each already broke something:

1. **Scopes hidden in defaults, decorators, annotations, class bases.** Evaluated in
   the *enclosing* scope, so `def f(x=lambda: 1)` makes the lambda a **sibling** of
   `f`, not a child. A walker that stops descending at a scope node loses it.
   *Broke my oracle on 34 of 563 sqlalchemy files.*
   ```python
   def outer():
       @d(lambda: 'DEC')
       def f(x=lambda: 'DEF', *, y: C[lambda: 'ANN'] = 2): pass
       class K(Base(lambda: 1), metaclass=Meta(lambda: 2)): pass
       return [q for q in [r for r in z]]   # outer iterable is evaluated OUTSIDE
   ```

2. **Same-line siblings.** Two lambdas or two comprehensions on one line have
   identical `(kind, name, line)`; only `startColumn` separates them, and the
   `py_scope` PK depends on it. Measured at 0.60% of scopes in site-packages.
   ```python
   g = (lambda: 1, lambda: 2)
   h = [x for x in a] + [y for y in b]
   ```

3. **symtable child order is EVALUATION order, not source order.** For the snippet in
   (1), symtable yields `[lambda@3, lambda@3, lambda@2, f@3]`. Do not pair by index.

4. **Class scope is not a closure scope.** A method sees a class attribute as a
   *global*, not a free variable. Getting this wrong invents resolutions the runtime
   does not have.

5. **Nested calls sharing a start offset** — `super().set_exception(e)`: outer call,
   attribute and inner call all start at index 0.

## A2 — Python-only semantics, ranked by measured frequency

| Construct | Corpus frequency | Why it matters |
|---|---|---|
| `@property` | 1,014 | turns an attribute read into a method call |
| `@classmethod` / `@staticmethod` | 717 | shifts every positional arg by one |
| `@overload` | 567 | stub bodies that must **never** be call targets |
| multiple inheritance | 12.1% of classes | C3 / MRO ordering |
| `super()` | 833, 98% zero-arg | MRO slice, *not* virtual dispatch |
| `__slots__` | 420 classes | authoritative attribute set |
| `__getattr__` / `__getattribute__` | 72 classes | attribute set is open |
| `Protocol` / `ABC` / `Enum` / `NamedTuple` / `TypedDict` / `dataclass` | 93/14/42/32/18/49 | distinct `typeCategory` |
| metaclass keyword | 12 | |

## A1 — flow fixtures, ranked by what actually needs resolving

From the receiver-shape census (23,677 bare-name receivers):

| Receiver binds to | Share | Needs |
|---|---|---|
| **import** | **37.2%** | import graph — no inference |
| **local** | **36.8%** | depends on RHS shape |
| parameter | 17.4% | interprocedural arg flow |
| module global / `def` / `class` | 4.1% | no inference |
| closure (free var) | 1.7% | outer scope |
| comprehension target | 0.4% | iterable element |

Please weight the set accordingly — **imports are the single largest bucket and the
cheapest win**, and the current Java-analogue set has no notion of them. Also needed:
`*args`/`**kwargs` passthrough (2.8% of functions, where positional flow is provably
unsound), keyword arguments (12,000 sites — they cannot be linked positionally), and
attribute chains at depth 2 (16% of receivers).

Annotations cover only **31.8%** of parameters, so fixtures that annotate everything
will not exercise the mechanism that actually carries Python.

## A4 — mining

- **Filter test trees.** In the 2.7 stdlib, 650 of 1,922 files sit under `test/`,
  `lib2to3/tests/`, `idlelib/idle_test/` and include deliberately-unparseable
  fixtures. Left in, every sweep opens by re-triaging known-intentional failures.
- **Keep a handful of the broken ones on purpose**, as a negative set: "the parser
  fails cleanly and records why" is worth asserting.
- **Do not chase node-type coverage.** It saturates at ~86%; that is A2's job now.
  Mine for *shape* diversity instead — deep nesting, heavy decoration, dynamic
  dispatch, large files (>32,767 chars, which is the tree-sitter direct-parse limit —
  see `HANDOFF-parser-core-32k.md`).

## How to check your own work

```
npx tsx src/test/python-oracle/run.ts --sweep staging/<yours>
```

`clean` means the oracle found no internal inconsistency: symtable and ast agree on
the scope tree, the pairing is unambiguous, and every comprehension scope has exactly
one `.0`. It does **not** mean the parser is right — that comparison needs the parser.

Report anything the oracle calls `internallyInconsistent` to me directly. That is my
bug, not yours.
