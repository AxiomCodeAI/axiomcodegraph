#!/usr/bin/env python3.10
import json, sys, collections
TS_SCOPE = ["function_definition","class_definition","lambda","list_comprehension",
            "set_comprehension","dictionary_comprehension","generator_expression"]
ts = {}
for l in open(sys.argv[1]):
    r = json.loads(l); ts[r["file"]] = r
show = int(sys.argv[3]) if len(sys.argv) > 3 else 20
bad = []; skipped = collections.Counter(); n = 0
for l in open(sys.argv[2]):
    a = json.loads(l)
    if "symtableError" in a: skipped["symtable-error"] += 1; continue
    t = ts.get(a["file"])
    if not t or t.get("hasError") or t.get("threw"): skipped["ts-unusable"] += 1; continue
    tc = t.get("types") or {}
    mine = 1 + sum(tc.get(k, 0) for k in TS_SCOPE)
    n += 1
    if mine != a["scopes"]: bad.append((a["file"], mine, a["scopes"]))
print(f"compared={n} skipped={dict(skipped)} scope-count disagreements={len(bad)}")
for b in bad[:show]: print("   ours=%d cpython=%d  %s" % (b[1], b[2], b[0]))
