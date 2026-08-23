# Python parser — working agreement

**All Python work happens on `python-parser-work`. `main` takes merges only.**

```bash
git checkout python-parser-work
git pull
# ... work ...
npx tsx src/test/python-tests.ts     # must be 6/6 before you push
```

## The gate before merging to main

```
npx tsx src/test/python-tests.ts
```

Four checks, all against expectations checked into `src/test-data/python`. No
interpreter, no oracle, no network — it runs anywhere the project builds.

| check | proves |
|---|---|
| golden facts | no frozen fact moved; names the row and column that did |
| closed-world | every call links or is a builtin, on a corpus whose ceiling is 100% |
| open-edges ratchet | the known-unresolvable count may fall, never rise |
| PEP 695 | `py_type_parameter` matches CPython 3.12 |

## Three rules that are not style preferences

**Never hand-write an expected fact.** The parser proposes, the golden records.
A hand-written expectation only tests whether its author and the implementer read
the spec the same way. Add source to `src/test-data/python/categories/`, run
`../parser-oracle/python && npx tsx bless.ts`, and let the tooling write the expectation.

**Re-freezing happens in `../parser-oracle/python`, never here.** It runs CPython
over each fixture and refuses to record facts CPython disagrees with. If it lived
in this repository the quickest way past a red check would be to re-freeze, and a
bug present at that moment would become permanent — every later fix would read as
a regression, and the response would be to freeze over it again. This repository
can DETECT drift and cannot AUTHORISE it.

**A schema change needs the human's word.** `src/schema/python/PYTHON-FACT-SCHEMA.md`
is frozen. Column order is the contract; new columns append only. Adding an enum
value breaks the build until the doc names it — that is the guard working, not a
nuisance. It has caught five real drifts where the column count never moved.

## Where things live

| path | what |
|---|---|
| `src/schema/python/` | the contract: schema, generated `.dl`, generator, decision specs |
| `src/test/python-tests.ts` | the whole suite — four checks, no interpreter |
| `src/test-data/python/categories/` | fixtures by entity kind, mirroring `test-data/java` |
| `src/test-data/python/verified/` | the admitted corpus and its frozen `_golden/` |

## Adding a test case

Put source in the right `categories/` directory. It is admitted only if **every
call site links to a declared entity or is a builtin** — measured, not judged.
That is what makes the corpus a tripwire rather than a second copy of the backlog.

If a shape is locally resolvable *in principle* but does not resolve yet, it goes
in `categories/edge-cases/OPEN_*.py` and the ratchet tracks it. Four are open now:
a union from two branches, a reassigned local, a property in a receiver chain, and
a subscript into a homogeneous list.
