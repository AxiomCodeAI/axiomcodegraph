# staging/mined — corpus mining and differential sweeps (A4)

Owner: **A4**. Nothing here ships. A5 promotes from here into
`src/test-data/python/`.

Method: run every `.py` file in a corpus through A3's `PythonParser` and
through CPython 3.10.4, then compare. Disagreements are **found, not judged** —
each is classified (implementation bug / CPython artifact / modeling divergence)
and filed in `coordination/findings-audit.jsonl` with file, line and both
verdicts. Modeling divergences are escalated, not decided.

## Layout

| Path | What |
|---|---|
| `corpus/` | 11 verbatim CPython 3.10.4 stdlib files — the greedy set-cover of node types. `PROVENANCE.jsonl` carries origin, sha256, license, node types. |
| `reductions/` | 20 minimised repros, A4-authored, one per finding. Each header states the mined site, CPython's verdict and tree-sitter's. `MANIFEST.jsonl` records which four are EXPECTED to have `hasError == true`. |
| `reports/` | Sweep output and the coverage baseline. Large intermediates are gzipped; the position dumps are regenerable and not kept. |
| `tools/` | The sweep and differential scripts. |

**Run everything from the repo root.** `tsx` resolves the `@/…` path alias from
the `tsconfig.json` it finds in the *current working directory*; run a tool from
`/tmp` and the alias silently fails to resolve.

## The corpora — 70,223 files

| Corpus | Files | CPython-3.10.4-valid & tree-sitter-clean | tree-sitter `hasError` |
|---|---|---|---|
| `stdlib310` — CPython 3.10.4 standard library | 1,713 | 1,700 | 2 |
| `sitepkgs310` — that interpreter's site-packages | 11,873 | 11,871 | 2 |
| `repos` — black, django, fastapi, flask, httpx, poetry, pydantic, rich, scrapy, sqlalchemy, textual | 7,784 | 7,747 | 16 |
| `anaconda312` — Anaconda 3.12 site-packages (torch, sympy, matplotlib, conda…) | 48,853 | 48,836 | 8 |
| **total** | **70,223** | **70,154** | **28** |

Files CPython 3.10.4 rejects (56) are excluded from every number: they are
inputs outside the target language, not divergences. 8.1% of files exceed
tree-sitter's 32,767-character ceiling and go through `PythonParser`'s callback
path; the largest that parses cleanly is 1,406,108 characters.

## Node-type coverage (Gate 3)

Against the **declared** ceiling of 115:

```
  mining alone                    113/115  (98.3%)
  mining + A4 reductions          114/115  (99.1%)
  residual: parenthesized_list_splat — unreachable from ANY valid Python
```

Against the **evidence-based** ceiling of 117 in `reports/ceiling-evidence.json`
(add `as_pattern_target`, `type_parameter`, `constrained_type`; remove
`parenthesized_list_splat`):

```
  mining alone                    115/117
  mining + A4 reductions          117/117
```

The ceiling is a human decision; A4 reports both and does not change the metric.

**Mining is saturated.** Adding 48,853 files (a 2.3× corpus) bought **zero** new
node types — and scored *lower* on its own (111/115) than the 1,713-file stdlib
(113/115), because coverage tracks what a corpus *contains*, not how big it is.

### What mining can and cannot reach

| Class | Types | Verdict |
|---|---|---|
| Reached densely | 104 types, ≥50 files each | corpus adequate |
| Reached thinly | `match` family (9): 50 of 70,154 files (0.07%); `complex_pattern` in **2** | reachable, but inside the stdlib it is ONE file, `test/test_patma.py`. A2's authored fixtures stay the robust source; mining corroborates them. |
| Reachable, never written | `member_type` (`x: list[int].a`), `constrained_type` (`x: dict[str:int]`) | 0 occurrences in 70,223 files. Authored fixture only — supplied in `reductions/`. |
| Not reachable at all | `parenthesized_list_splat` | every input producing it is a CPython `SyntaxError`. A ceiling error, not a corpus gap. |

## The five lenses

1. **Construct-count differential** — 57 construct classes counted on both
   sides, mapping validated on a 64-file probe set before being trusted at
   scale. Found a4-001, a4-002, a4-008.
2. **Scope-count differential** — tree-sitter's scope-bearing node count against
   `symtable`'s block count. 21,315 files, **1** disagreement (PEP 563).
3. **Position differential** — the (row, column) multiset of 20 node types.
   Counts cannot see a misparse that preserves cardinality and only moves the
   parent/child edges; positions can. Found a4-018, which counts had missed.
   Residual after classification: **zero unexplained** across 65,463 files.
4. **Parse-failure classification** — every `hasError` file re-parsed by
   CPython. 13 files CPython accepts and tree-sitter rejects; the rest are
   genuinely outside 3.10.4.
5. **Gate 1 — py_scope / py_binding vs `symtable`**, in a detached worktree at
   the last *pushed* commit. A4's mapping is deliberately its own, not A0's
   `emit_oracle.py`, so a shared blind spot cannot hide a disagreement.
6. **py_method / py_method_parameter vs `ast`** — one of the eight relations
   Gate 1 cannot see. Added when A3 touched the parameter code in `bdcfa3c`;
   it found a4-034 on its first run.

## Correctness by relation — A3 @ `7946eb7` (last pushed)

The mapping every number below depends on is written out in `MAPPING.md`, and
`reports/MAPPING-PROOF.txt` prints every row beside the CPython value it is
compared to. Each lens carries a negative control, so a `0` means the lens ran
and passed, not that it silently did nothing.

| Relation | Corpus | Result |
|---|---|---|
| `py_scope` | 67,193 files | 0 missing, 0 spurious (the only 4+4 were A4's own mapping bug, a4-031) |
| `py_binding` | 67,193 files | 11/11 predicates exact except 6 filed bugs; **plus 17,990 files carrying `.0`** (a4-026) |
| `py_method` | 21,370 files | 0 spurious, **15,725 missing — every one a lambda** (a4-034) |
| `py_method_parameter` | 21,370 files | **0 mismatches** — names, kinds, order, posonly/kwonly boundaries all exact |
| `py_type` | 21,370 files | **0 missing, 0 spurious, 0 name diffs** |
| `py_type_base` | 21,370 files | 19 base lists wrong in 6 files — all a4-037, comments taking an MRO position |
| `py_expression`, `py_import`, `py_call_site`, `py_module`, `py_field`, `py_decorator` | — | **not yet tested by A4** |

## Re-sweep against `bdcfa3c` and `7946eb7` (A3's heads after `b800789`)

| | |
|---|---|
| **Fixed** | a4-019 — columns are now UTF-8 bytes, verified in both directions |
| **Unchanged** | Gate 1 on the stdlib is *byte-identical* to the `b800789` run — same 10 files, same counts, same 2,455 `.0` rows. a4-026…a4-033 all still open; nothing regressed. |
| **New** | a4-034 (no `py_method` row for any lambda — 15,725 missing rows across 21,370 files, invisible to Gate 1), a4-035 (`member_type`'s trailing name becomes a spurious binding), a4-037 (a comment inside a **base list** becomes a base and takes an MRO position) |

Gate 1 on the stdlib is byte-identical across `b800789`, `bdcfa3c` and
`7946eb7` — same 10 files, same counts, same 2,455 `.0` rows.

`py_method` / `py_method_parameter` over 21,370 files: **0** spurious methods,
**0** parameter mismatches — including the comment-in-a-parameter-list shape
`bdcfa3c` had just fixed — and 15,725 missing methods, every sampled one a
lambda. The `def`/`async def` path is exact; the entire signal is lambdas.

Each new relation brought under a differential has produced a finding on its
first run. The eight relations still untested are the live risk, not the two
that are green.

## Gate 1 result

| Corpus | Files | Exactly clean | Differ only by `.0` | Differ on anything else |
|---|---|---|---|---|
| stdlib | 1,689 | 1,145 | 527 | **10** (+1 falsely rejected as Python 2) |
| site-packages | 11,297 | 7,768 | 3,529 | **0** |
| repos + anaconda | 54,207 | 40,228 | 13,934 | **97** (+2 falsely rejected) |
| **total** | **67,193** | **49,141** | **17,990** | **107** |

Every one of the 107 maps to an already-filed finding — a4-033 (aliased future
import, by far the largest), a4-001, a4-029, a4-028/032, a4-030 and a4-003's
ERROR fallout. The largest sweep produced **no new Gate 1 finding**, which is
the convergence signal for this lens. The three falsely rejected files
(a4-006) cost 34 + 102 + 44 = 180 scopes that emit no facts at all.

`py_scope` and `py_binding` agree with `symtable` on essentially all ordinary
library code, across all eleven `Symbol` predicates. Every Gate 1 bug found so
far comes from CPython's own test suite or black's adversarial test data —
together ~0.3% of the corpus by file count and 100% of the yield. That is the
single most useful corpus fact in this report: **library code does not exercise
the scope edge cases, test suites do.**

## Regenerating

```sh
# from the repo root
./node_modules/.bin/tsx python-work/staging/mined/tools/mine.ts \
    --corpus stdlib310 --root <lib/python3.10> --exclude __pycache__,site-packages \
    --out python-work/staging/mined/reports/raw-stdlib310.jsonl

python3.10 tools/ast_counts.py      < files.txt > reports/ast-<c>.jsonl
python3.10 tools/symtable_scopes.py < files.txt > reports/sym-<c>.jsonl
python3.10 tools/diffcounts.py  reports/raw-<c>.jsonl reports/ast-<c>.jsonl
python3.10 tools/diffscopes.py  reports/raw-<c>.jsonl reports/sym-<c>.jsonl
./node_modules/.bin/tsx tools/positions.ts --files files.txt --out reports/pos-<c>.jsonl
python3.10 tools/ast_positions.py   < files.txt > reports/astpos-<c>.jsonl
python3.10 tools/classify_positions.py reports/pos-<c>.jsonl reports/astpos-<c>.jsonl
./node_modules/.bin/tsx tools/shapescan.ts --files files.txt --out reports/shape-<c>.jsonl
python3.10 tools/cover.py reports/raw-<c>.jsonl     # greedy set cover
python3.10 tools/agg.py   reports/raw-*.jsonl       # coverage summary

# Gate 1 needs a detached worktree at the last PUSHED commit:
git worktree add --detach /tmp/a4-wt origin/main && ln -s $PWD/node_modules /tmp/a4-wt/
cp tools/gate1.ts tools/symtable_dump.py /tmp/a4-wt/a4tools/
cd /tmp/a4-wt && ./node_modules/.bin/tsx a4tools/gate1.ts --files files.txt --out g1.jsonl
```

Everything parses through `PythonParser`, never tree-sitter directly: the
32,767-character ceiling lives there, and bypassing it silently drops the
largest file in every package. Repeated runs are byte-identical.

## Caveats

- Files in `corpus/` are CPython 3.10.4 stdlib, PSF-2.0, copied verbatim with
  sha256 in `PROVENANCE.jsonl`. Two contain relative imports that do not resolve
  out of context — they are parse/scope fixtures, not import-resolution
  fixtures.
- Four files in `reductions/` are expected to have `rootNode.hasError == true`;
  `MANIFEST.jsonl` marks them. They must not be promoted into a corpus that
  asserts clean parses.
- Lenses 1–4 are **grammar-level**: they compare tree-sitter's tree with
  CPython. A3's output inherits those divergences, but that is not the same as
  testing A3's extraction — lens 5 is.
- Gate 1 covers `py_scope` and `py_binding` only. The other eight spine
  relations are untested by A4 so far.
