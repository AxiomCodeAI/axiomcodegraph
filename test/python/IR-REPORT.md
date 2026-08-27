# Python IR report — findings from running the engine at stdlib scale

**Date:** 2026-08-27 · **Engine:** `src/python/engine` (35 rule files) ·
**Parser:** `Parser@7ed5111` (merged to `main` as #3) ·
**Library IR:** `~/Documents/AxiomCode/python/v3.10.4` (31 shards, 786 modules)

This is the hand-off list. Everything below is either **actionable by the parser / IR
owner**, or explicitly marked **verified-not-a-defect** so it does not get re-filed. Engine
problems found along the way were fixed rather than reported, and are listed at the end for
awareness only.

Reproduce anything here with:

```bash
python3.10 test/python/tools/ir_audit.py <src-dir> <ir-dir>          # IR completeness
bash src/pipeline/run-souffle.sh --language python \
  --client-ir <ir> --library ~/Documents/AxiomCode/python/v3.10.4 \
  --intermediate <scratch> --output <out>                            # call chains
```

---

## 1 · IR completeness: clean, and now measurable

`tools/ir_audit.py` is new and answers a question none of the other checks can. The
coverage guard asks whether the ENGINE dropped a site the parser found; the oracle score
asks whether the targets are right. Both use the IR as their denominator, so **a construct
the parser never emitted is invisible to them**. This one takes CPython as the denominator:
every code object `compile()` produces, every class, every `symtable` symbol, against
`py_method` / `py_type` / `py_binding`.

| corpus | code objects | classes | bindings | **not in IR** |
|---|---:|---:|---:|---:|
| 30 stdlib shards | 13,912 | 1,682 | 92,857 | **0** |
| `two-service-fastapi` | 107 | 32 | 767 | **0** |
| `name-collision` | 38 | 21 | 274 | **0** |
| 12 fixture cases | — | — | — | **0** |

Plus, from the parser's own records across the 786 stdlib modules: **0 skipped files**,
**2 parse gaps** (both the known `unittest/mock.py` soft-keyword misparse), **786/786
`grammarUsed=TS_PYTHON3`**.

**Nothing in this report is a missing-fact problem.** That is the headline, and it is worth
stating precisely because it took a wrong turn to establish: my first run of this audit
reported 5,585 missing constructs in `ctypes`, 14,173 in `unittest` and comparable numbers
in four more shards. Every single one was under a `test/` or `tests/` tree that
`build-stdlib-ir.sh` deliberately never feeds the parser. **The tool's denominator was
wrong, not the parser.** The audit now excludes the same directories the build does, and
the number is 0.

---

## 2 · ACTION: the stdlib library IR is stale

**What.** `~/Documents/AxiomCode/python/v3.10.4` was built before `Parser@7ed5111`, so the
whole library side of every analysis is working from facts that predate the five fixes that
landed in it.

**Evidence** — the `logging` shard, which is representative:

```
py_type_reference.pyExpressionLinkHash set: 0 / 191      # 7ed5111 fills this
bindingKind=BUILTIN rows:                   0            # 7ed5111 emits this
SUBSCRIPT_CALL sites: 2   DYNAMIC_CALL sites: 3          # mixed -- partially pre-fix
ASSIGNMENT expression nodes: 836                         # present, so not ancient
```

A freshly parsed project on the same parser has `pyExpressionLinkHash` populated and
`bindingKind=BUILTIN` present, so the difference is the IR's age and not the shard's
content.

**Cost.** Two of the three engine fixes I made this session exist only because the library
facts are stale in exactly this way — I could not tell "the parser does not emit X" from
"this IR predates X" without checking the freshly parsed corpora side by side. Any future
finding against the library side is unreliable until it is rebuilt.

**Action.** `./build-stdlib-ir.sh` — it skips shards that already exist, so the existing
tree must be moved aside first (`v3.10.4.prev` already exists, suggesting this is the
intended pattern).

---

## 3 · ACTION: the `idlelib` shard contains its own test tree

**What.** `build-stdlib-ir.sh`'s exclusion list is applied only to **top-level** shard
directories:

```bash
skip_shard(){ case "$1" in test|tests|idle_test|__pycache__|site-packages) return 0;; *) return 1;; esac; }
for d in "$LIB"/*/; do name="$(basename "$d")"; skip_shard "$name" && continue
```

`idlelib/idle_test/` is nested, so it is never tested against that list and the whole tree
is handed to the parser.

**Evidence.**

```
$ awk -F'\t' 'FNR>1 && ($5 ~ /(^|\/)(test|tests|idle_test)\//)' */all-python-methods.csv | wc -l
  idlelib   1357     # every other shard: 0
```

1,068 code objects and 222 classes from `idle_test/` are in the shard IR as library
surface, including `mock_idle.Func`, `mock_idle.Editor`, `mock_idle.UndoDelegator` and
`example_stub.Example`.

**Cost.** Library linking is name-based by necessity (`resolvedCalleeHash` cannot cross a
parser run), so a client that imports anything whose name collides with a test double can
link to the double. `idlelib` is the only affected shard, so the blast radius is small
today — but the *rule* is wrong, and any future package with a nested test tree inherits it.

**Action.** Prune the excluded names during the walk rather than only at the top level.

---

## 4 · ACTION: PD-11 — `from pkg.mod import mod` binds the MODULE, not the member

Still live on the current parser. Full write-up in `src/python/PARSER-DEFECTS.md`; the short
form:

```python
# shared/retry.py defines BOTH the module `shared.retry` and a function `retry` in it
from shared.retry import audited, retry
```
```
importedPath=shared.retry.audited   simpleName=audited   resolvedTargetKind=FUNCTION  ✓
importedPath=shared.retry.retry     simpleName=retry     resolvedTargetKind=MODULE    ✗
```

Two names on one statement; the second resolves to the module rather than to the function
inside it, with an empty `resolvedTargetHash`. It silently broke an entire `@retry`
decorator chain in both services of the test project. The shape is ordinary
(`from app.tasks import tasks`, `from pkg.logging import logging`).

The engine works around it by resolving members from `packageOrTypeName` +
`originalName`, which is exact and also survives a library boundary — so this is **low
urgency but not invalid**: the column still contradicts itself on its own row.

---

## 5 · Verified NOT defects

Listed so they are not re-filed. Each was checked against a fresh parse.

| claim | verdict |
|---|---|
| `py_binding.targetEntityKind/Hash` empty | **fixed** — 464/767 populated on a fresh parse |
| no `ASSIGNMENT` expression node | **fixed** — 78 nodes in a 19-file project |
| `all-python-decorators.csv` absent | **fixed** — present, exact row count |
| `py_field.pyExpressionLinkHash` empty | **fixed** — 29/29 populated |
| `py_type_base.pyExpressionLinkHash` empty | **by design, and the better design** — it carries `pyTypeReferenceLinkHash` on every row and reaches its expression through the reference; a second direct edge could disagree with the first. The engine now uses that path. |
| `resolvedTargetHash` empty for a module import | **by design** — a module has its own `resolvedModuleLinkHash`, populated all along |
| `example_stub.pyi` parsed as source | **correct** — `isStub=true`, `moduleKind=STUB`; consumers can filter |
| `MISPARSED_SILENTLY` on `type(x).a = v` | **open but correctly handled** — tree-sitter dynamic precedence, not tokenising; the parser records the gap instead of repairing it, which is the right call |

---

## 6 · Not a parser problem, but the biggest limit on library linking

These are architecture items, not defects. Recording them because they dominate the
unresolved count at stdlib scale and someone will otherwise re-diagnose them.

**6.1 — `LIB_BODY` is never filled for Python.** `run-souffle.sh`'s stage↔solve loop is
Java-shaped (`lib_method.facts`, `all-expressions.csv`, hardcoded column indices), so the
loop exits after one iteration for `--language python` and library expression facts are
always empty. Consequence: a local typed from a library call's *return value* is
unresolvable unless the library method declares `-> T`, and stdlib code mostly does not:

```python
line = self.fp.readline()      # http/client.py
line.split(...)                # -> no receiver type: 218 sites in the `http` shard
```

**6.2 — `os.path` is a runtime alias.** `sys.modules['os.path'] = posixpath`. No static
fact expresses it, so `os.path.normcase(...)` (44 sites in `logging`, 60 in `http`) cannot
resolve through `module_member_module`. Fixable with a small explicit alias catalog on the
engine side, in the same style as the builtin catalog — not a parser change.

**6.3 — C-implemented modules have no Python source.** `time`, `_thread`, `math`,
`select` and friends are in no IR and never will be. `time.time()` is correctly a named
external boundary, not a blind spot.

---

## 7 · Engine problems found here and already fixed

Not for action; listed so the numbers in this report are reproducible and so it is clear
what was mine.

1. **The LEGB walk resolved onto a reference-side binding.** A module scope carries a
   `bindingCount=0` `GLOBAL_IMPLICIT` row for every builtin the module mentions, and the
   walk matched it — so `binding_lookup` "succeeded" onto a row that declares nothing, the
   builtin catalog never got a chance, and `hasattr(...)`, `isinstance(...)`,
   `ValueError(...)` came out `ambiguous_unknown` instead of the named boundary they are.
   Fixed by requiring the target to actually bind something. **−25 unresolved sites on
   `logging` alone**; `isinstance` now has 29 edges, `ValueError` 40, `len` 34.
2. **A library construction whose class has no visible `__init__`** produced neither an
   edge nor a boundary. `pickle.PicklingError(msg)` — the class is resolved, its MRO ends at
   the C-level `Exception`, and the site read `no_rule` for a class the engine had named.
3. **A local or attribute holding a library instance was untyped.**
   `_lock = threading.RLock()` then `_lock.acquire()`. The construction resolved and the
   name that received it did not — the library twin of a rule that only ever tracked client
   classes.

Net effect on the `logging` shard: unresolved **354 → 326**, boundary_lib **271 → 299**,
library edges **40 → 56**, with conservation exact throughout.

---

## 8 · Where the engine stands after this pass

| corpus | sites | known | multi | boundary | unresolved | conservation |
|---|---:|---:|---:|---:|---:|---|
| `two-service-fastapi` | 227 | 124 | 22 | 76 | 5 | 227/227 |
| `name-collision` | 91 | 49 | 7 | 35 | 0 | 91/91 |
| stdlib `logging` | 931 | 303 | 3 | 299 | 326 | 931/931 |
| stdlib `http` | 1226 | 317 | 0 | 429 | 480 | 1226/1226 |
| stdlib `json` | 214 | 46 | 0 | 52 | 116 | 214/214 |

The two hand-built projects score **recall 1.000 with 0 fabricated edges** against live
CPython. The stdlib shards are not scored against a trace (they have no single entry point)
and their unresolved fraction is dominated by 6.1 and 6.2 above, not by missing IR.

**Conservation is exact on every corpus measured** — 2,689 sites in, 2,689 accounted for.
