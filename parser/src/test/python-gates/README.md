# python-gates — validation against frozen expectations

Four gates. **None runs an interpreter, an oracle, or the network.** Each runs the
parser and compares the result with expectations checked into
`src/test-data/python`, so the suite works anywhere the project builds.

| gate | expectation it checks against |
|---|---|
| `golden-gate` | `verified/_golden/` — 4,127 facts across 17 relations |
| `closed-world-gate` | every call links or is a builtin; ceiling is exactly 100% |
| `open-edges-gate` | `edge-cases/EXPECTED_UNRESOLVED.json` — may fall, never rise |
| `pep695-gate` | `verified-py312/EXPECTED_TYPE_PARAMETERS.json` — frozen CPython 3.12 truth |

    npx tsx src/test/python-tests.ts

## When a gate fails

It names the fact that moved, not a percentage. Two cases:

**The change is wrong** — fix the parser. The gate has done its job.

**The change is right** — the expectations need regenerating, and that happens in
`../parser-oracle/python`, not here:

    cd ../parser-oracle/python && npx tsx bless.ts

## Why blessing is not in this repository

It has to run CPython over every fixture and refuse to record facts CPython
disagrees with. If it lived here, the quickest way past a red gate would be to
re-bless, and a bug present at that moment would become permanent — every later
fix would then read as a regression, and the natural response would be to bless
again over it.

Keeping the two apart means this repository can *detect* drift and cannot
*authorise* it.
