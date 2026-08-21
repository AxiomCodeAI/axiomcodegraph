# Python oracle — differential harness

Ground truth for Python facts, from CPython itself. **A0 owns this directory.**

```
npx tsx src/test/python-oracle/run.ts --self-test          # test the harness
npx tsx src/test/python-oracle/run.ts --oracle <file.py>   # dump ground truth
npx tsx src/test/python-oracle/run.ts --sweep <dir>        # validate the arbiter on real code
```

## Two sources, two strengths — do not conflate them

| | source | strength |
|---|---|---|
| **Gate 1** | `symtable` | **EXACT.** `py_scope` / `py_binding` set-equality, all 11 `Symbol` predicates. CPython computes this by a different algorithm in a different language. A disagreement means *we* are wrong. |
| **Gate 2** | `ast` | **CROSS-CHECK.** Structure, spans, attribute writes. This is a second implementation *by the same author as the harness*, so it detects **disagreement requiring adjudication**, not correctness. Two implementations sharing an author share its blind spots. |

Report them separately. Never aggregate into one number.

## Pinning

`CPython 3.10.4` at an absolute path (`harness/constants.ts`). Never `python3`, never
ambient PATH — Appendix B invariant #10. On this machine a conda shell resolves `python3`
to 3.12.4, which inlines comprehensions (PEP 709) and yields a structurally different scope
tree. The harness refuses to start under the wrong interpreter rather than warning.

Every golden file records the interpreter path and full `sys.version`; a golden generated
under a different regime is **refused**, not silently compared.

## Layout

```
oracle/emit_oracle.py   ground truth emitter (runs under the pinned interpreter)
harness/constants.ts    pinning, frozen spine arities, the 11 predicates
harness/oracle-runner   subprocess + interpreter self-check
harness/invariants.ts   Appendix B 1–11
harness/compare.ts      set-equality, precision/recall, disagreement classification
harness/golden.ts       golden files with provenance
harness/row.ts          safe column access
self-test/              mutation tests — the harness testing itself
```

## Why the self-test matters

The harness is the arbiter. If it is wrong, everything downstream is wrong and nobody
notices. So it is tested by **mutation**: build a fact set correct by construction, then
introduce one specific defect at a time and assert the harness reports *that* defect. A
mutation it fails to catch is a hole in the arbiter.

It has already earned this twice:

1. **`symtable.get_id()` is not deterministic.** It returns `id()` of the underlying object,
   stable within a process but varying across them. It would have made every golden file
   differ run-to-run. Caught by invariant #5 before any golden existed. Now emitted as a
   canonical pre-order ordinal, which serves the column's documented purpose
   ("cross-check handle only; never joined on").

2. **Scopes hidden in defaults, decorators, annotations and class bases.** These are
   evaluated in the *enclosing* scope, so `def f(x=lambda: 1)` makes the lambda a **sibling**
   of `f`, not a child. A naive walker loses them. Caught by sweeping the oracle over
   sqlalchemy — 34 files failed.

## A correction to the brief

The brief asked for an assertion that *symtable child order matches ast source order*.
**That premise is false**, and asserting it would have failed on real code for the wrong
reason. symtable orders children by symbol-table **construction** order:

```python
def outer():
    @d(lambda: 'DEC')
    def f(x=lambda: 'DEF', *, y: C[lambda: 'ANN'] = 2): pass

symtable -> [lambda@3, lambda@3, lambda@2, f@3]     # not source order, not even line order
```

What actually protects `py_scope.startColumn` — the real requirement, since the PK depends
on pairing ast columns to symtable scopes — is:

> every symtable child pairs 1:1 with an ast scope-introducing node, by identity
> (type, name, line), and the pairing is **unambiguous by column**.

Invariant #9a asserts exactly that, including the case that matters: two children
indistinguishable to symtable *and* sharing a column would make `startColumn` unable to
separate them, i.e. a PK collision.

## Validation

610 files across sqlalchemy, scrapy, `_pytest`, tornado, flask and requests:
**610 clean, 0 internally inconsistent**, 23,734 scopes, 142,203 bindings,
1,776 synthetic `.0` iterators — each positively asserted, never whitelisted.
