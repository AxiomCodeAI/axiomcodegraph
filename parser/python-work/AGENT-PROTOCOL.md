# A0 ↔ A3 working protocol — no human relay

The human should not be a message bus. Neither of us has agent-to-agent messaging
tools, but almost none of the relaying actually needs one.

## The three rules

### 1. Stay subscribed, do not poll

```
git config axiom.agent A0        # once, per worktree
bash tools/install-hooks.sh      # post-commit hook prints your inbox
```

After that, **every commit shows you what the other agents routed to you since your
last one.** A commit is the natural sync point: you have just finished a unit of work
and are about to choose the next.

On demand:

```
npx tsx src/test/python-oracle/status.ts --inbox --for A0   # only what is NEW
npx tsx src/test/python-oracle/status.ts --watch --for A0   # live, 5s poll
npx tsx src/test/python-oracle/status.ts --for A0           # the whole board
```

`--inbox` advances a per-agent cursor, so you see each item once. The cursor counts
rows per file rather than comparing timestamps — the channel is append-only so row
count is monotonic, whereas `ts` is self-reported and is not a clock.

It reads all six coordination files, routes open items by `owner`, prints the
adjudication coverage, and lists every gate command. If you did not run it, you do
not know what the other agent handed you — 47 open items sat unread in
`findings-audit.jsonl` while we both asked the human for status.

### 2. Route with `owner`, close with `status`

```json
{"ts":"…","agent":"A0","kind":"defect","construct":"yield_crosses_scopes",
 "owner":"A3","severity":"high","status":"open","note":"…"}
```

- `owner` — whose queue it is. **No owner means informational**, not a task.
- `status` — `open` until the *owner* closes it. Do not close another agent's row;
  add a new one that references it.
- `severity: "high"` — shows with a `!` and sorts first.

Write to your own file only (`schema-oracle.jsonl` = A0, `requests-impl.jsonl` = A3).
Append-only, one writer per file, so concurrent writes never conflict.

### 3. Prefer a failing test to a message

**This is the one that removes most of the relaying.** A finding in JSONL needs
someone to read it. A failing test in a suite the other agent already runs delivers
itself.

- **A0 → A3:** do not write "methodKind is wrong for nested classes". Add the case
  to the oracle so `python-extractor-tests.ts` goes red. The red build *is* the
  message, and it cannot be missed or deprioritised.
- **A3 → A0:** an oracle defect is the same shape in reverse. Add a case that fails
  against the oracle and file the row; I will see red on my own self-test.

Reserve JSONL for what a test cannot express: schema questions, priority calls,
things needing a human.

## Boundaries that make the split work

| | A0 | A3 |
|---|---|---|
| owns | `src/test/python-oracle/`, `python-work/*.md`, the schema | `src/parsers/python/`, `src/analysis-types/python/`, `src/test/python-extractor-tests.ts`, `src/test/python-gates/` |
| produces | ground truth, specs, verdicts | facts |
| must not | write parser source | author the oracle it is judged by |

The reason A3 cannot write its own adjudication ground truth is the same reason a
Gate 2 zero is weaker than a Gate 1 zero: one author, one set of blind spots.

## What still needs the human

Only these. Everything else is ours.

- **Schema changes to frozen relations** — e.g. `py_expression` 35 → 39. Neither of
  us can ratify it; A3's sign-off was implementation-side, mine is not authority.
- **Modelling decisions with no arbiter** — `py_field`'s identity rule. `symtable`
  has no opinion on attributes, so no test can settle it and more tests only harden
  whichever guess is in place.
- **Priority between agents** when both are defensible.
- **"Is this done."**

## The holdout — `src/test-data/python/_holdout`

**A0 owns it. A3 must not open it.** Sealed with a SHA-256 manifest.

Every other corpus here has been iterated against, which makes it training data: a
score on `closed-world/` says how well the parser fits the defects we already found.
The holdout is the control — closed-world too, so its ceiling is exactly 100%, but
written in different idioms and without reference to any known defect.

```
holdout-gate.ts --verify   # anyone, anytime: is the seal intact?
holdout-gate.ts --run      # A0 only, ONCE, when the visible corpora near ceiling
```

`--run` prints a score and the failing *mechanisms* — never a file or line. That is
deliberate: enough to know whether the parser generalises, not enough to patch it
case by case, which is the behaviour that would destroy the measurement.

A broken seal means the corpus must be **replaced, not repaired**. Whoever changed it
has seen it, and there is no way to un-see it.

This is a norm, not a lock. The seal makes tampering *detectable*, which in a fleet
that reports its own numbers is the part that matters.

## Numbers

Nobody quotes a coverage or resolution figure that did not come from a tool.

- coverage → `src/test/python-oracle/coverage.ts` (the union of both harnesses)
- closed-world resolution → `closed-world-gate.ts`, ceiling exactly 100%
- generalisation → `holdout-gate.ts --run`, once

And a correction that applies to every number here: **the `ts` field on a coordination
row is self-reported and is not a clock.** Rows claiming 12:00 were written at 01:09.
If ordering matters — who saw what first, whether a fix predates a report — only file
mtime and git commit times can answer it. `status.ts` now uses mtime.

Both of us have now published a wrong number by measuring our own component and
calling it the project's: A0 said 9.7% coverage (harness-local) and an 88.5% ceiling
(ignored analysis-root scoping); A3 reported SELF at 30.9% (pre-fix, and dominated by
callees outside the root). Same error twice, in both directions.

A rate is meaningless without its denominator, and on real corpora the denominator is
usually **what fraction of callees happen to live inside the analysis root** — which
describes the corpus, not the parser.
