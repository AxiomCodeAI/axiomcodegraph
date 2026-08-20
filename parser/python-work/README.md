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

## Progress signal

`coverage-report.jsonl` is the number that matters: **node-type coverage** against
tree-sitter-python's 129 named node types, plus oracle agreement rate. Fixture *count*
is not progress — a corpus can triple in size while covering nothing new.

Stopping condition: two consecutive full corpus sweeps producing zero new
disagreements, at the coverage bar the human sets.

## Escalate to the human

Do not resolve these among yourselves:

- **Schema changes** after A0's is approved — invalidates every golden file.
- **Modeling divergences** where the parser and CPython disagree and both are
  defensible (star-import expansion, `nonlocal` bindings). This is a question about
  what the reasoning engine needs, not about correctness.
- **A5 pruning vs A4 discovery** conflicts.
- **"Is this done"** — always a human call.
