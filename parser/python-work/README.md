# Python support — working area

Coordination and staging for the Python parser effort. **Nothing here ships.**
Parser source lives in `src/parsers/python/`; the canonical fixture corpus lives in
`src/test-data/python/`.

## Why this exists

Several agents work the Python effort concurrently. This directory is how they
coordinate without stepping on each other, and how a human reads progress without
attending every session.

## The one rule

**CPython is the arbiter of correctness.** `ast` and `symtable` give ground truth for
any Python file. No agent hand-writes expected facts — expected values are generated
by the oracle harness (`src/test/python-oracle/`) and regenerated whenever a fixture
moves. Hand-written expectations become the spec, and a wrong-but-plausible
expectation locks in the bug it was meant to catch.

Fixture authors write Python **source** only.

## Ownership — one writer per path, no exceptions

| Path | Sole writer |
|---|---|
| `src/test/python-oracle/` | A0 oracle |
| `staging/flow/` | A1 flow fixtures |
| `staging/native/` | A2 native fixtures |
| `src/parsers/python/`, `src/analysis-types/python/` | A3 implementation |
| `staging/mined/` | A4 corpus miner |
| `src/test-data/python/` | A5 consolidator |

Read anything. Write only what you own. Disjoint ownership is what lets most agents
share one checkout — only A3 needs a worktree, because it alone leaves the tree
broken mid-edit.

## Coordination channel

`coordination/*.jsonl` — append-only, **one file per writer** so concurrent appends
never conflict. Everyone reads all five.

| File | Writer | Carries |
|---|---|---|
| `manifest-flow.jsonl` | A1 | fixtures added, constructs covered |
| `manifest-native.jsonl` | A2 | same |
| `requests-impl.jsonl` | A3 | "need fixtures for X", modeling questions for the human |
| `findings-audit.jsonl` | A4 | oracle disagreements, with file/line and both verdicts |
| `coverage-report.jsonl` | A5 | node-type coverage, oracle agreement rate, promotions, prunes |

Suggested row shape (keep it flat and greppable):

```json
{"ts":"2026-08-20T21:00:00Z","agent":"A4","kind":"disagreement","construct":"match_statement","file":"...","line":42,"ours":"...","cpython":"...","status":"open"}
```

Live nudges between sessions are fine (`ListAgents` / `SendMessage`), but a finding
that exists only in a chat message does not exist. Write it here too.

## Stopping condition

Three gates. They answer different questions, and the earlier single condition
("two consecutive sweeps, zero new disagreements") conflated them — it measured corpus
churn, not correctness, so it passed automatically once mining plateaued whether the
parser was right or not.

### Gate 1 — Exact (symtable-adjudicated)

`py_scope` and `py_binding` set-equality at **100%**, all 11 predicates, over the named
corpus. Binary, no partial credit.

This is the only gate where CPython adjudicates exactly, so it is the primary gate.
It is necessary but **not sufficient**: it covers 2 of the 10 frozen spine relations. A
parser with flawless scopes and a garbage `py_expression` tree, mis-ordered
`py_type_base`, or mis-attributed `py_call_site` callers passes Gate 1 — and those carry
data-flow paths ③ and ④ and the MRO. symtable structurally cannot see them.

`.0` (CPython's internal comprehension iterator parameter) is handled by **positive
assertion**, not whitelist: assert it appears in symtable output and never in ours. A
whitelist silently absorbs a regression; an assertion surfaces it if CPython changes.

### Gate 2 — Structural (ast cross-check)

The six spine relations symtable cannot see: `py_expression` tree shape, `py_method`,
`py_type`, `py_type_base` ordering, `py_import`, `py_call_site`.

**This is a cross-check, not an oracle, and the distinction is load-bearing.** `ast`
yields a tree; `py_expression` is a flattened relation carrying parent, depth, and
edge-role. Comparing them requires an ast→relational mapping that we also author — so
Gate 2 is two implementations by the same author agreeing, which is not ground truth.
They can share a blind spot.

Gate 2's guarantee is therefore explicitly weaker than Gate 1's: **it detects
disagreement requiring adjudication, not correctness.** A green Gate 2 does not license
the claim "the IR is right." Do not let that nuance erode — it is the first thing to go.

**Open:** two of the ten spine relations are covered by neither gate. A0 to name them
and state whether that is deliberate. If they carry no data-flow path, record that as a
decision; if they do, they need a gate.

### Gate 3 — Corpus adequacy (not parser quality)

Node-type coverage against the reachable ceiling. This gates whether we are *entitled*
to run Gates 1–2 at all. It is a property of the inputs, never of the parser.

The ceiling is **not** 129. Measured against tree-sitter-python:

| | count |
|---|---|
| named types | 129 |
| − 6 supertypes (abstract; never in a concrete tree) | 123 |
| − 3 Python 2 (`print_statement`, `exec_statement`, `chevron`) — must never appear | 120 |
| − PEP 695 — deferred to freeze 2 | see below |
| − 1 `except_group_clause` (`except*`, 3.11, above target) | **115** |

115 is the freeze-1 ceiling on 3.10.4. **Open:** the PEP 695 deduction is recorded as 4;
an independent count finds 2 (`type_alias_statement`, `type_parameter`). A0 to enumerate
the four, since the ceiling is 115 or 118 depending on the answer.

Mining reached 106 and **saturates** — 917 files across six projects, where the last 417
bought exactly one node type:

```
  1 file  :  80/123 (65.0%)     100 files : 101/123 (82.1%)
 25 files :  95/123 (77.2%)     500 files : 105/123 (85.4%)
                                917 files : 106/123 (86.2%)
```

So mining cannot finish. The 9-type residual is **entirely `match`** — legal in 3.10.4,
absent because the mined libraries target ≤3.9. That is a fixture request, not a mining
problem, and it makes Gate 3 a **blocking prerequisite on A2**: `case_clause`,
`case_pattern`, `class_pattern`, `complex_pattern`, `dict_pattern`, `keyword_pattern`,
`match_statement`, `union_pattern`, `splat_pattern`.

Threshold: **115/115** (or 118/118, pending the PEP 695 count).

### Independent invariants

Hold regardless of all three gates:

- **Referential integrity** — every foreign key resolves; no primary-key collisions.
- **Determinism** — byte-identical output across repeated runs of the same parser
  version. This is run-to-run stability, not stability across versions; improving the
  parser is expected to change output.

## Escalate to the human

Do not resolve these among yourselves:

- **Schema changes** after A0's is approved — invalidates every golden file.
- **Modeling divergences** where the parser and CPython disagree and both are
  defensible (star-import expansion, `nonlocal` bindings). This is a question about
  what the reasoning engine needs, not about correctness.
- **A5 pruning vs A4 discovery** conflicts.
- **"Is this done"** — always a human call.
