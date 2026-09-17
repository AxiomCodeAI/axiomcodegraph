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
                     while naming others. UNSOUNDNESS IF REAL -- and the two
                     ways it can be an artefact instead are excluded first:
                     a callback the site passes (recorded by the instrumenter)
                     and a site flagged `unwrapped_chain_link`. What is left is
                     reported as a candidate, never as a proven engine error,
                     because the tracer cannot see inside a library frame.
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

        runtime[(r["file"], int(r["line"]), int(r["col"]))] = {
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
        instrumented.add((r["file"], int(r["start_line"]), int(r["start_col"])))

# ── the engine ──────────────────────────────────────────────────────────────
con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row
engine = collections.defaultdict(lambda: {"tiers": set(), "targets": {}, "names": set()})
for row in con.execute(
    """
    SELECT s.file_path, s.start_line, s.start_column, s.callee_name, e.tier,
           m.file_path AS tf, m.start_line AS tl, m.qualified_name AS tq,
           m.provenance AS tp
    FROM call_edges e
    JOIN call_sites s ON s.id = e.call_site_id
    LEFT JOIN methods m ON m.id = e.callee_method_id
    WHERE s.file_path IS NOT NULL AND s.start_line IS NOT NULL
      AND s.start_column IS NOT NULL
    """
):
    k = (row["file_path"], row["start_line"], row["start_column"])
    slot = engine[k]
    slot["tiers"].add(row["tier"])
    if row["callee_name"]:
        slot["names"].add(row["callee_name"])
    if row["tf"] is not None:
        slot["targets"][(row["tf"], row["tl"])] = (row["tq"], row["tp"])

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

for key, rt in sorted(runtime.items()):
    eng = engine.get(key)
    if eng is None:
        unjoinable.append(key)
        continue
    tiers = eng["tiers"]
    et = eng["targets"]
    client_targets = {k: v for k, v in et.items() if v[1] == "client"}
    rts = rt["targets"]
    inside = [k for k in rts if target_in(et, k)]
    outside = [k for k in rts if k not in inside]

    if not rts:
        b = "NOT_EXECUTED"
    elif tiers <= {"boundary_lib", "ambient_terminal", "intrinsic_terminal"} and not outside:
        b = "LIB_BOUNDARY"
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
                "site": "%s:%d:%d" % key,
                "written": rt["callee_text"][:50],
                "tiers": sorted(tiers),
                "engine_targets": len(et),
                "engine_client_targets": len(client_targets),
                "runtime_targets": ["%s:%d x%d" % (f, l, n) for (f, l), n in rts.items()],
                "engine_named": ["%s:%d" % k for k in list(et)[:8]],
            }
        )

never = len(instrumented - set(runtime))
summary = {
    "sites_instrumented": len(instrumented),
    "sites_executed": len(runtime),
    "sites_never_executed": never,
    "sites_executed_and_joined": sum(buckets.values()),
    "sites_executed_not_in_bundle": len(unjoinable),
    "buckets": dict(buckets),
    "declaration_line_fuzz": {str(k): v for k, v in sorted(fuzz_used.items())},
}
with open(os.path.join(work, "join-summary.json"), "w") as fh:
    json.dump({"summary": summary, "examples": {k: v for k, v in examples.items()}}, fh, indent=2)

print(json.dumps(summary, indent=2))
print("\nwrote %s" % os.path.join(work, "join-summary.json"))
