#!/usr/bin/env python3.10
"""Greedy minimum set-cover over mined files: the smallest set of real files
that between them exercise every node type the corpus reaches.

Ties break on file size, so the cover favours small files -- a 200KB module
that adds one node type is a bad golden.  Files tree-sitter fails on are
excluded: they cannot be promoted as fixtures.
"""
import json, sys, os, collections
R = "/Users/swapnilpaliwal/Documents/AxiomCode/Parser"
inscope = set(json.load(open(R + "/python-work/staging/mined/tools/inscope-node-types.json"))["inScope"])

recs = []
for p in sys.argv[1:]:
    for l in open(p):
        r = json.loads(l)
        if r.get("hasError") or r.get("threw") or r.get("empty"): continue
        ts = set(r.get("types") or {}) & inscope
        if ts: recs.append((r["file"], r.get("bytes", 0), ts, r.get("firstAt") or {}))

universe = set().union(*[t for _, _, t, _ in recs])
remaining = set(universe)
chosen = []
while remaining:
    best = max(recs, key=lambda r: (len(r[2] & remaining), -r[1]))
    gained = best[2] & remaining
    if not gained: break
    chosen.append((best[0], best[1], sorted(gained)))
    remaining -= gained
    recs = [r for r in recs if r[0] != best[0]]

print(f"universe={len(universe)}/{len(inscope)} coverfiles={len(chosen)}")
tot = 0
for f, b, g in chosen:
    tot += b
    print(f"  {b:>8}  {len(g):>3}  {f}")
print("total bytes:", tot)
print("uncovered:", sorted(inscope - universe))
out = R + "/python-work/staging/mined/reports/cover.json"
json.dump([{"file": f, "bytes": b, "typesGained": g} for f, b, g in chosen], open(out, "w"), indent=1)
