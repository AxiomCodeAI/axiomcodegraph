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

Six suites, ordered by what they prove. **Fix the first failure before reading the
rest** — if the arbiter or the schema is wrong, everything below it is measuring
against a broken reference.

| suite | proves |
|---|---|
| oracle self-test | the arbiter itself is correct — mutation-tested |
| schema guard | doc, generated `.dl` and all 56 enums agree |
| golden facts | no frozen fact moved; names the row and column that did |
| closed-world | every call links or is a builtin, on a corpus whose ceiling is 100% |
| open-edges ratchet | the known-unresolvable count may fall, never rise |
| PEP 695 | `py_type_parameter` matches CPython 3.12 |

## Three rules that are not style preferences

**Never hand-write an expected fact.** The parser proposes, the golden records.
A hand-written expectation only tests whether its author and the implementer read
the spec the same way. Add source to `src/test-data/python/categories/`, run
`golden-gate.ts --promote --bless`, and let the tooling write the expectation.

**`--bless` refuses output CPython disagrees with.** That is deliberate and is why
`oracle/emit_oracle.py` still exists after the rest of the instruments were
deleted. Without it a golden records whatever the parser said, and a bug present
at freeze time becomes permanent — every later fix reads as a regression, and the
natural response is to re-bless over it.

**A schema change needs the human's word.** `src/schema/python/PYTHON-FACT-SCHEMA.md`
is frozen. Column order is the contract; new columns append only. Adding an enum
value breaks the build until the doc names it — that is the guard working, not a
nuisance. It has caught five real drifts where the column count never moved.

## Where things live

| path | what |
|---|---|
| `src/schema/python/` | the contract: schema, generated `.dl`, generator, decision specs |
| `src/test/python-tests.ts` | the one entry point |
| `src/test/python-oracle/` | the arbiter — nine files, CPython as ground truth |
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
