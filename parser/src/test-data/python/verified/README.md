# verified/ — the regression corpus

Every file here was **admitted by measurement, never by judgement**: each one's
call sites all link to a declared entity or are builtins, so the ceiling is
exactly 100%. Any unresolved call that appears later is a regression, not an
argument about analysis scope.

    npx tsx src/test/python-oracle/golden-gate.ts            # check  (CI)
    npx tsx src/test/python-oracle/golden-gate.ts --select   # who qualifies
    npx tsx src/test/python-oracle/golden-gate.ts --promote  # re-admit
    npx tsx src/test/python-oracle/golden-gate.ts --bless    # re-freeze

`_golden/` holds one file per relation: every emitted fact, sorted, with the
volatile columns dropped. 1,358 facts across 16 relations.

**Do not hand-edit anything in `_golden/`.** The parser proposes and the golden
records; a hand-written expectation only tests whether its author and the
implementer read the spec the same way. `--bless` re-runs the CPython oracle
first and refuses to freeze output it disagrees with, so a fix cannot be pinned
in place as a bug.

Package structure is preserved. Flattening `core/base.py` to one name would break
`from .base import ...`, and the corpus would keep passing its own goldens while
testing different code.

Files came from `python-work/staging/native` and `src/test-data/python/closed-world`;
`MANIFEST.json` records each origin. The `flow` corpus contributed nothing, and
correctly so — it exists to exercise deliberately unresolvable constructs, which
makes it a good behavioural test and a useless tripwire.
