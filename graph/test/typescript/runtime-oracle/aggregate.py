#!/usr/bin/env python3
"""Merge the per-worker traces into one per-site answer.

Reads <work>/tables and <work>/trace, writes <work>/runtime-sites.tsv:

    file  line  col  callee_text  n_targets  invocations  targets  note

`targets` is `name@file:line|count`, most-invoked first. `n_targets` is the
number the RUN saw, which is the whole point of the measurement: a site with
n_targets == 1 is deterministic in this workload no matter how wide the
type-directed answer for it is.

A pair whose target is a function expression written at that same site is a
CALLBACK, not the site's callee -- `arr.map(x => ...)` calls `Array.map` and
`Array.map` calls the arrow. The instrumenter records which declarations are a
site's callback arguments, and those pairs are separated out here rather than
counted as targets, because scoring them against the engine's answer for the
site would compare two different questions.
"""
import csv
import collections
import glob
import json
import os
import sys

work = sys.argv[1]
tables = os.path.join(work, "tables")
trace = os.path.join(work, "trace")


def rows(name):
    with open(os.path.join(tables, name)) as f:
        return list(csv.DictReader(f, delimiter="\t"))


sites = {r["site_id"]: r for r in rows("sites.tsv")}
decls = {r["decl_id"]: r for r in rows("decls.tsv")}
callback_of = collections.defaultdict(set)
for r in rows("callbacks.tsv"):
    callback_of[r["site_id"]].add(r["decl_id"])

pairs = collections.Counter()
unlinked = collections.Counter()
files_read = 0
for f in glob.glob(os.path.join(trace, "*.tsv")):
    files_read += 1
    for line in open(f):
        p = line.rstrip("\n").split("\t")
        if p[0] == "pair":
            pairs[(p[1], p[2])] += int(p[3])
        elif p[0] == "unlinked":
            unlinked[p[2]] += int(p[3])

def last_identifier(text):
    ident = ""
    for ch in text:
        ident = ident + ch if (ch.isalnum() or ch in "_$") else ""
    return ident


direct = collections.defaultdict(list)
callbacks = collections.defaultdict(list)
implicit = collections.defaultdict(list)
for (s, d), n in pairs.items():
    if d in callback_of.get(s, ()):
        callbacks[s].append((d, n))
        continue
    # toString / valueOf / toJSON / then are invoked by a protocol as often as by
    # name -- string concatenation, JSON.stringify, awaiting a thenable -- so the
    # pair counts as this site's target only if the site actually WROTE the name.
    if decls[d]["kind"].endswith("_implicit") and last_identifier(
        sites[s]["callee_text"]
    ) != decls[d]["name"]:
        implicit[s].append((d, n))
        continue
    direct[s].append((d, n))

out = os.path.join(work, "runtime-sites.tsv")
with open(out, "w") as fh:
    fh.write(
        "file\tline\tcol\tend_line\tend_col\tcallee_text\tn_targets\tinvocations"
        "\ttargets\tcallbacks\timplicit\tnote\n"
    )
    for s in sorted(direct, key=lambda x: int(x)):
        si = sites[s]
        ts = sorted(direct[s], key=lambda t: -t[1])
        cbs = sorted(callbacks.get(s, []), key=lambda t: -t[1])

        def fmt(lst):
            return ",".join(
                "%s@%s:%s|%d" % (decls[d]["name"], decls[d]["file"], decls[d]["start_line"], n)
                for d, n in lst
            )

        fh.write(
            "\t".join(
                [
                    si["file"],
                    si["start_line"],
                    si["start_col"],
                    si["end_line"],
                    si["end_col"],
                    si["callee_text"],
                    str(len(ts)),
                    str(sum(n for _, n in ts)),
                    fmt(ts),
                    fmt(cbs),
                    fmt(sorted(implicit.get(s, []), key=lambda t: -t[1])),
                    si.get("note", "") or "",
                ]
            )
            + "\n"
        )

n_sites = len(sites)
observed = len(direct)
det = sum(1 for s in direct if len(direct[s]) == 1)
poly = observed - det
stats = {
    "trace_files": files_read,
    "sites_instrumented": n_sites,
    "sites_observed": observed,
    "sites_never_executed": n_sites - observed,
    "sites_one_target_at_runtime": det,
    "sites_several_targets_at_runtime": poly,
    "callback_only_sites": len([s for s in callbacks if s not in direct]),
    "implicit_protocol_pairs_excluded": sum(len(v) for v in implicit.values()),
    "total_invocations": sum(pairs.values()),
    "declarations": len(decls),
    "declarations_entered_without_a_site": len(unlinked),
    "invocations_without_a_site": sum(unlinked.values()),
}
with open(os.path.join(work, "runtime-stats.json"), "w") as fh:
    json.dump(stats, fh, indent=2)
for k, v in stats.items():
    print("%-38s %s" % (k, v))
print("\nwrote %s" % out)
