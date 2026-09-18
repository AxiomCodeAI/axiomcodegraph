#!/usr/bin/env python3
"""Put the run beside the engine, per call site.

    join.py <work-dir> <graph.sqlite>

The engine answers "which declarations CAN run here". The trace answers "which
ones DID, in this workload". Neither is ground truth for the other, and the
buckets below are written so that no bucket silently claims it is.

  AGREE_EXACT        engine named one target, the run hit exactly that one
  NARROWABLE         engine named SEVERAL, the run only ever hit one of them.
                     The engine is SOUND here and imprecise. This is the bucket
                     the question "where can a static engine close the gap"
                     is asking about: dispatch that is deterministic in fact.
  MISSED             engine resolved nothing (ambiguous_*), the run hit something.
                     A demonstrable recall gap, with a witness.
  OUTSIDE            the run hit a declaration the engine did not name at all,
                     while naming others. UNSOUNDNESS IF REAL -- and the three
                     ways it can be an artefact instead are excluded first:
                     a callback the site passes (recorded by the instrumenter),
                     a site flagged `unwrapped_chain_link`, and a target the
                     engine named in call_runs_method rather than in call_edges.
                     What is left is reported as a candidate, never as a proven
                     engine error, because the tracer cannot see inside a
                     library frame.

TWO RELATIONS, BECAUSE THE ENGINE ANSWERS TWO QUESTIONS. `call_edges` records
what the compiler SELECTED, which for an overload set is the bodiless SIGNATURE.
`call_runs_method` re-points that to the IMPLEMENTATION row of the same group,
and it is the one that answers the question this harness asks, because a run can
only enter a body. Reading call_edges alone charged the engine with missing an
edge it had: 7 of immer's 17 OUTSIDE rows were `each`'s signature at
common.ts:84 named while common.ts:89 ran, with the implementation sitting in
call_runs_method the whole time.
  LIB_BOUNDARY       engine says the call leaves the client. The run agrees if
                     what it saw at the site was only a callback.
  NOT_EXECUTED       the workload never reached the site. NO INFORMATION -- it is
                     counted and then set aside, never scored as agreement.

A site the trace saw and the bundle has no row for is a CONSERVATION failure of
the join itself, and is reported separately: an unjoinable site must never be
silently dropped into "missed".
"""
import collections
import csv
import json
import os
import sqlite3
import sys

work, db_path = sys.argv[1], sys.argv[2]
production_only = "--production" in sys.argv

# THE SAME production filter the scorer uses, imported rather than restated: a
# second copy of this regex is a second definition of what "production" means, and
# the two would drift. zustand without it reads as 702 disagreements, 680 of which
# are sites in its own test files -- the manifest calls zustand a 218-production-site
# project for exactly this reason.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ground-truth"))
try:
    from score import is_test_path
except Exception:  # pragma: no cover - the scorer moved; say so rather than guess
    def is_test_path(_p):
        raise SystemExit("cannot import is_test_path from ground-truth/score.py")

# ── the run ─────────────────────────────────────────────────────────────────
runtime = {}
with open(os.path.join(work, "runtime-sites.tsv")) as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        tg = [t for t in r["targets"].split(",") if t]
        cb = [t for t in r["callbacks"].split(",") if t]

        def parse(items):
            out = {}
            for it in items:
                head, n = it.rsplit("|", 1)
                name, loc = head.rsplit("@", 1)
                f, line = loc.rsplit(":", 1)
                out[(f, int(line))] = out.get((f, int(line)), 0) + int(n)
            return out

        runtime[(r["file"], int(r["line"]), int(r["col"]), int(r["end_line"]), int(r["end_col"]))] = {
            "col": int(r["col"]),
            "callee_text": r["callee_text"],
            "targets": parse(tg),
            "callbacks": parse(cb),
            "note": r["note"],
        }

# every instrumented site, so "never executed" is countable
instrumented = set()
with open(os.path.join(work, "tables", "sites.tsv")) as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        # THE KEY IS THE WHOLE SPAN, not the start. `a.b().c()` and `a.b()` begin at
        # the same character, so a start-only key silently merges every method chain --
        # 881 of zustand's 4209 sites, whose engine answers then pooled into one. The
        # bundle has 4209 distinct full spans and only 3328 distinct starts.
        instrumented.add(
            (r["file"], int(r["start_line"]), int(r["start_col"]),
             int(r["end_line"]), int(r["end_col"]))
        )

# ── the engine ──────────────────────────────────────────────────────────────
con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row
engine = collections.defaultdict(lambda: {"tiers": set(), "targets": {}, "names": set()})
for row in con.execute(
    """
    SELECT s.file_path, s.start_line, s.start_column, s.end_line, s.end_column,
           s.callee_name, e.tier,
           m.file_path AS tf, m.start_line AS tl, m.qualified_name AS tq,
           m.provenance AS tp
    FROM call_edges e
    JOIN call_sites s ON s.id = e.call_site_id
    LEFT JOIN methods m ON m.id = e.callee_method_id
    WHERE s.file_path IS NOT NULL AND s.start_line IS NOT NULL
      AND s.start_column IS NOT NULL AND s.end_line IS NOT NULL
    """
):
    k = (row["file_path"], row["start_line"], row["start_column"],
         row["end_line"], row["end_column"])
    slot = engine[k]
    slot["tiers"].add(row["tier"])
    if row["callee_name"]:
        slot["names"].add(row["callee_name"])
    if row["tf"] is not None:
        slot["targets"][(row["tf"], row["tl"])] = (row["tq"], row["tp"])

# ── what the engine says RUNS at the site ───────────────────────────────────
# call_runs_method is per call site; call_runs_edge is the same thing rolled up to
# the caller METHOD and cannot be asked "at this site", which is why this join could
# not use it before it was exported.
runs = collections.defaultdict(dict)
try:
    for row in con.execute(
        """
        SELECT s.file_path, s.start_line, s.start_column, s.end_line, s.end_column,
               m.file_path AS tf, m.start_line AS tl, m.qualified_name AS tq,
               m.provenance AS tp
        FROM ext_call_runs_method r
        JOIN call_sites s ON s.id = r.c0
        JOIN methods m ON m.id = r.c1
        WHERE s.file_path IS NOT NULL AND s.start_line IS NOT NULL
        """
    ):
        runs[(row["file_path"], row["start_line"], row["start_column"],
              row["end_line"], row["end_column"])][(row["tf"], row["tl"])] = (
                  row["tq"], row["tp"])
except sqlite3.OperationalError:
    # A bundle built before the relation was exported. Say so rather than scoring a
    # site against a table that is not there and reporting the difference as engine
    # behaviour.
    print("NOTE: this bundle has no ext_call_runs_method; OUTSIDE will overcount "
          "overload signatures re-pointed to their implementation.", file=sys.stderr)

# A declaration's line in the bundle need not be the line the instrumenter gave
# it: for `const f = () => {}` one may record the variable statement and the other
# the arrow. Allow a small window, and REPORT how often it was needed, so a silent
# systematic offset cannot be mistaken for agreement.
fuzz_used = collections.Counter()


def target_in(engine_targets, rt_key):
    f, line = rt_key
    for d in (0, -1, 1, -2, 2):
        if (f, line + d) in engine_targets:
            fuzz_used[d] += 1
            return True
    return False


buckets = collections.Counter()
examples = collections.defaultdict(list)
unjoinable = []
# Sites that would have scored OUTSIDE against call_edges alone, and do not once
# call_runs_method is read. Reported rather than absorbed: it is the size of the
# correction, and a reader comparing against an older run needs to see it.
recovered_by_runs = collections.Counter()

for key, rt in sorted(runtime.items()):
    if production_only and is_test_path(key[0]):
        continue
    eng = engine.get(key)
    if eng is None:
        unjoinable.append(key)
        continue
    tiers = eng["tiers"]
    et = eng["targets"]
    rn = runs.get(key, {})
    client_targets = {k: v for k, v in et.items() if v[1] == "client"}
    rts = rt["targets"]
    # NAMED = selected, or re-pointed to the body that the selection implies. A
    # declaration the engine reached either way is one the engine named. Each
    # target is tested against call_edges once and against call_runs_method only
    # if that missed, so the fuzz counter stays a count of targets and not of
    # lookups.
    inside = [k for k in rts if target_in(et, k)]
    extra = [k for k in rts if k not in inside and target_in(rn, k)]
    inside = inside + extra
    outside = [k for k in rts if k not in inside]
    if extra and not outside:
        recovered_by_runs[1] += 1

    if not rts:
        b = "NOT_EXECUTED"
    elif tiers <= {"boundary_lib", "ambient_terminal", "intrinsic_terminal"}:
        # The engine says this call LEAVES THE CLIENT -- `Object.fromEntries(...)`,
        # `new Error(...)`. A project declaration seen running at such a site cannot
        # be the site's callee; it is a function the library called back into, and
        # the tracer cannot see the library frame in between. Scoring it as a
        # disagreement would accuse the engine of missing an edge that is not there.
        b = "LIB_BOUNDARY" if not outside else "LIB_CALLBACK"
    elif all(t.startswith("ambiguous") for t in tiers):
        b = "MISSED"
    elif outside:
        b = "OUTSIDE" if not rt["note"] else "OUTSIDE_UNATTRIBUTABLE"
    elif len(client_targets) > 1 and len(rts) == 1:
        b = "NARROWABLE"
    elif len(client_targets) <= 1 and len(rts) == 1:
        b = "AGREE_EXACT"
    else:
        b = "AGREE_MULTI"
    buckets[b] += 1
    if len(examples[b]) < 12:
        examples[b].append(
            {
                "site": "%s:%d:%d-%d:%d" % key,
                "written": rt["callee_text"][:50],
                "tiers": sorted(tiers),
                "engine_targets": len(et),
                "engine_client_targets": len(client_targets),
                "runtime_targets": ["%s:%d x%d" % (f, l, n) for (f, l), n in rts.items()],
                "engine_named": ["%s:%d" % k for k in list(et)[:8]],
            }
        )

scope = {k for k in instrumented if not (production_only and is_test_path(k[0]))}
never = len(scope - set(runtime))
summary = {
    "scope": "production only" if production_only else "every instrumented site",
    "sites_instrumented": len(scope),
    "sites_executed": len([k for k in runtime if k in scope]),
    "sites_never_executed": never,
    "sites_executed_and_joined": sum(buckets.values()),
    "sites_executed_not_in_bundle": len(unjoinable),
    "buckets": dict(buckets),
    "outside_recovered_by_call_runs_method": recovered_by_runs[1],
    "declaration_line_fuzz": {str(k): v for k, v in sorted(fuzz_used.items())},
}
with open(os.path.join(work, "join-summary.json"), "w") as fh:
    json.dump({"summary": summary, "examples": {k: v for k, v in examples.items()}}, fh, indent=2)

print(json.dumps(summary, indent=2))
print("\nwrote %s" % os.path.join(work, "join-summary.json"))
