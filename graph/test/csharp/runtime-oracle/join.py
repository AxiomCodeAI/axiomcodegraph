#!/usr/bin/env python3
"""
Put the run beside the engine, per method-to-method edge.

    join.py <trace-work-dir> <engine-raw-dir> <engine-ir-dir> [--json out.json]
            [--facts out.facts] [--verbose N]

The engine answers "which declarations CAN be called from here". The trace answers
"which ones WERE, in this workload". NEITHER IS GROUND TRUTH FOR THE OTHER, and the
buckets below are written so that no bucket silently claims it is:

  CONFIRMED     the engine named this edge and the run took it. The strongest
                evidence a static edge is real.
  NARROWABLE    the engine named several targets at a caller/name and the run only
                ever took one. The engine is SOUND here and imprecise. This is the
                bucket that answers "where could a static engine be tightened", and
                it is the one a runtime signal can act on.
  MISSED        the run took an edge the engine did not name. A demonstrable recall
                gap WITH A WITNESS, which is the most valuable output of this whole
                harness: unlike an oracle disagreement it cannot be argued away.
  NOT_EXECUTED  the engine named it and the workload never reached it. NO
                INFORMATION. Counted and then set aside -- never scored as an
                engine error, because a suite that does not exercise a path says
                nothing about whether the path exists.
  UNJOINABLE    a trace edge whose endpoint has no method in the IR. A conservation
                failure OF THE JOIN, reported separately so it can never be quietly
                absorbed into MISSED.

WHY NOT_EXECUTED IS NOT A PRECISION NUMBER. It is tempting to read "the engine
named 900 edges and the run took 300" as 33% precision. It is not: FluentValidation's
suite covers 554 of 604 methods, and the uncovered ones are uncovered, not
unreachable. A trace is a LOWER BOUND on behaviour and this file never treats it as
an upper one.

THE CALLER-ATTRIBUTION CAVEAT, STATED RATHER THAN BURIED. The tracer reads the
caller off a per-thread shadow stack that is pushed on entry and popped in a
`finally`. That is exact for ordinary control flow. It is NOT exact across an
`await` continuation resumed on a different thread, or inside an iterator's
MoveNext: the frame that resumes may see a different stack. Those edges are real
but their CALLER may be attributed to whatever the resuming thread was doing, so an
async-heavy subject will show MISSED edges that are artefacts of resumption rather
than engine gaps. The count of async methods in the id table is printed so the
reader can size that.

--facts writes runtime_observed_edge tuples the engine can read back. See
graph/csharp/engine/resolution/runtime-observed.dl for what it is allowed to do
with them, which is to ADD and never to subtract.
"""
import argparse
import collections
import csv
import json
import os
import sys


def read_ids(path):
    """id -> (key, file, line, kind)."""
    out = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            out[int(r["id"])] = (r["key"], r["filePath"], int(r["line"]), r["kind"])
    return out


def read_trace(trace_dir):
    """(caller_id, callee_id) -> count, and callee_id -> entry count."""
    edges = collections.Counter()
    entries = collections.Counter()
    meta = collections.Counter()
    files = 0
    for name in sorted(os.listdir(trace_dir)):
        if not name.endswith(".tsv"):
            continue
        files += 1
        with open(os.path.join(trace_dir, name), encoding="utf-8") as fh:
            for line in fh:
                p = line.rstrip("\n").split("\t")
                if len(p) < 3:
                    continue
                if p[0] == "E":
                    edges[(int(p[1]), int(p[2]))] += int(p[3]) if len(p) > 3 else 1
                elif p[0] == "N":
                    entries[int(p[1])] += int(p[2])
                elif p[0] == "M":
                    meta[p[1]] += int(p[2])
    return edges, entries, meta, files


def read_raw(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return [r for r in csv.reader(fh, delimiter="\t") if r]


def engine_method_keys(ir_dir):
    """engine method hash -> `Type.Name/paramCount`, the instrumenter's key shape."""
    out = {}
    with open(os.path.join(ir_dir, "all-csharp-methods.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            out[r["csMethodUniqueHash"]] = f'{r["qualifiedName"]}/{r["parameterCount"]}'
    return out


def norm(k):
    """
    Reduce both sides to one spelling.

    The instrumenter builds its key SYNTACTICALLY, from the namespace and type nest,
    because it runs over a mirror with nothing resolved. So a generic type arrives as
    `LocaliserRegistry` from one side and `LocaliserRegistry<TLocaliser>` from the
    other. Generic argument lists are stripped from both; `<constructor>` is parked
    behind a sentinel first, because it is a name and not an argument list.
    """
    if not k:
        return ""
    k = k.replace("<constructor>", "\x00c\x00")
    out, depth = [], 0
    for ch in k:
        if ch == "<":
            depth += 1
            continue
        if ch == ">":
            if depth:
                depth -= 1
            continue
        if depth:
            continue
        out.append(ch)
    return "".join(out).replace("\x00c\x00", "<constructor>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trace_work")
    ap.add_argument("engine_raw")
    ap.add_argument("engine_ir")
    ap.add_argument("--json")
    ap.add_argument("--facts", help="write runtime_observed_edge tuples for the engine")
    ap.add_argument("--label", default="")
    ap.add_argument("--verbose", type=int, default=0)
    a = ap.parse_args()

    ids = read_ids(os.path.join(a.trace_work, "ids.tsv"))
    edges, entries, meta, nfiles = read_trace(os.path.join(a.trace_work, "trace"))
    if not edges:
        sys.exit("join: the trace holds no edges")

    mkeys = engine_method_keys(a.engine_ir)

    # ── the engine's method-to-method edges ──────────────────────────────────
    # From call_chain_edge, which is the one relation every front end exports in the
    # same shape: FromExpr, FromMethod, ToExpr, ToMethod, Prov, Status, Kind.
    static = set()
    static_by_caller = collections.defaultdict(set)
    tier_of = {}
    for row in read_raw(os.path.join(a.engine_raw, "call-chain-edges.csv")):
        if len(row) < 7:
            continue
        _fe, fm, _te, tm, prov, status, _kind = row[:7]
        if prov != "client" or tm == "-":
            continue
        ck, dk = norm(mkeys.get(fm, "")), norm(mkeys.get(tm, ""))
        if not ck or not dk:
            continue
        static.add((ck, dk))
        static_by_caller[ck].add(dk)
        tier_of[(ck, dk)] = status

    # ── the run's edges, in the same key space ───────────────────────────────
    runtime = collections.Counter()
    unjoinable = collections.Counter()
    for (cid, eid), n in edges.items():
        callee = ids.get(eid)
        if callee is None:
            unjoinable[("unknown_callee_id", eid)] += n
            continue
        dk = norm(callee[0])
        if cid == -1:
            # An entry with nothing below it on the stack: the workload called in
            # from outside the instrumented subtree (a test method, the runtime, a
            # framework callback). That is an ENTRY POINT observation, not an edge,
            # and it is counted as such rather than joined against a caller.
            runtime[("<external>", dk)] += n
            continue
        caller = ids.get(cid)
        if caller is None:
            unjoinable[("unknown_caller_id", cid)] += n
            continue
        runtime[(norm(caller[0]), dk)] += n

    observed_pairs = {(c, d) for (c, d) in runtime if c != "<external>"}
    entry_observed = {d for (c, d) in runtime if c == "<external>"}

    b = collections.Counter()
    examples = collections.defaultdict(list)

    for pair in observed_pairs:
        if pair in static:
            b["CONFIRMED"] += 1
        else:
            b["MISSED"] += 1
            examples["MISSED"].append((pair[0], pair[1], runtime[pair]))

    for pair in static:
        if pair not in observed_pairs:
            b["NOT_EXECUTED"] += 1

    # NARROWABLE: the engine named several targets from one caller with the same
    # callee NAME, and the run took exactly one of them. Grouped on the callee's
    # simple name, because that is what "several candidates for one call" means at
    # method granularity -- two different methods called from one caller are not a
    # fan, they are two calls.
    def simple(dk):
        head = dk.rsplit("/", 1)[0]
        return head.rsplit(".", 1)[-1]

    for ck, dks in static_by_caller.items():
        by_name = collections.defaultdict(set)
        for dk in dks:
            by_name[simple(dk)].add(dk)
        for nm, group in by_name.items():
            if len(group) < 2:
                continue
            took = {dk for dk in group if (ck, dk) in observed_pairs}
            if len(took) == 1:
                b["NARROWABLE"] += 1
                examples["NARROWABLE"].append((ck, nm, len(group), sorted(took)[0]))
            elif len(took) > 1:
                b["FAN_CONFIRMED_WIDE"] += 1
            else:
                b["FAN_NOT_EXECUTED"] += 1

    total_methods = len(ids)
    entered = len([i for i in entries if entries[i] > 0])
    async_like = len([1 for _i, v in ids.items() if v[3] == "iterator"])

    label = f" [{a.label}]" if a.label else ""
    print(f"== C# engine vs runtime trace{label} ==")
    print(f"  trace files                {nfiles}")
    print(f"  instrumented methods       {total_methods}, entered {entered} "
          f"({100.0*entered/total_methods:.1f}% covered by the suite)")
    print(f"  probe failures             {meta.get('probeFailures', 0)}")
    print(f"  stack overflows            {meta.get('stackOverflows', 0)}   (a non-zero count invalidates callers)")
    print(f"  iterator-bodied methods    {async_like}   (probe fires on first MoveNext)")
    print()
    print(f"  engine method edges        {len(static)}")
    print(f"  observed method edges      {len(observed_pairs)}")
    print(f"  observed entry points      {len(entry_observed)}   (called from outside the subtree)")
    print()
    print(f"  CONFIRMED                  {b['CONFIRMED']}   the engine named it and the run took it")
    print(f"  MISSED                     {b['MISSED']}   the run took it and the engine did not name it")
    print(f"  NOT_EXECUTED               {b['NOT_EXECUTED']}   named, never reached -- NO INFORMATION")
    print()
    print(f"  fans the engine emitted:")
    print(f"    NARROWABLE               {b['NARROWABLE']}   several named, exactly one ever taken")
    print(f"    confirmed wide           {b['FAN_CONFIRMED_WIDE']}   several named, several taken")
    print(f"    not executed             {b['FAN_NOT_EXECUTED']}")
    if unjoinable:
        print()
        print(f"  UNJOINABLE                 {sum(unjoinable.values())} trace edge(s) with an unknown endpoint")
        for k, v in unjoinable.most_common(5):
            print(f"    {k}  x{v}")

    if a.verbose:
        for cls in ("MISSED", "NARROWABLE"):
            if not examples[cls]:
                continue
            print(f"\n  -- {cls} ({len(examples[cls])}) --")
            for ex in sorted(examples[cls], key=lambda e: -e[-1] if isinstance(e[-1], int) else 0)[: a.verbose]:
                print(f"     {ex}")

    if a.facts:
        # THE FEEDBACK FILE. One tuple per observed edge, in the engine's own
        # key space. The engine reads these as a relation and is allowed to ADD
        # edges from them, never to remove one: a workload is a lower bound.
        os.makedirs(os.path.dirname(os.path.abspath(a.facts)), exist_ok=True)
        with open(a.facts, "w", encoding="utf-8") as fh:
            for (ck, dk), n in sorted(runtime.items()):
                fh.write(f"{ck}\t{dk}\t{n}\n")
        print(f"\n  wrote {len(runtime)} runtime_observed_edge tuple(s) to {a.facts}")

    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({
                "label": a.label,
                "buckets": dict(b),
                "instrumented": total_methods,
                "entered": entered,
                "staticEdges": len(static),
                "observedEdges": len(observed_pairs),
                "entryPoints": len(entry_observed),
                "probeFailures": meta.get("probeFailures", 0),
                "stackOverflows": meta.get("stackOverflows", 0),
                "unjoinable": sum(unjoinable.values()),
            }, fh, indent=1, sort_keys=True)

    # A stack overflow makes every caller in the trace suspect, and an unjoinable
    # edge is a conservation failure. Both are harness defects rather than engine
    # results, so they fail the run; MISSED does not, because it is a finding.
    if meta.get("stackOverflows", 0) or sum(unjoinable.values()):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
