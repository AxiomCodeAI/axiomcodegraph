#!/usr/bin/env python3.10
"""A4 aggregation: node-type coverage from raw sweep JSONL."""
import json, sys, collections
R="/Users/swapnilpaliwal/Documents/AxiomCode/Parser"
INSCOPE=json.load(open(R+"/python-work/staging/mined/tools/inscope-node-types.json"))
inscope=set(INSCOPE["inScope"])
def load(paths):
    recs=[]
    for p in paths:
        with open(p) as f:
            for line in f:
                if line.strip(): recs.append(json.loads(line))
    return recs
def main():
    recs=load(sys.argv[1:])
    seen=collections.Counter(); firsts={}; per_corpus=collections.defaultdict(set)
    err=[]; thrown=[]
    for r in recs:
        if r.get("threw"): thrown.append(r)
        if r.get("hasError"): err.append(r)
        for t,c in (r.get("types") or {}).items():
            seen[t]+=c
            per_corpus[r["corpus"]].add(t)
            if t not in firsts: firsts[t]=(r["file"], (r.get("firstAt") or {}).get(t))
    covered=sorted(set(seen)&inscope)
    missing=sorted(inscope-set(seen))
    extra=sorted(set(seen)-inscope)
    print(f"files={len(recs)} hasError={len(err)} threw={len(thrown)}")
    print(f"COVERAGE {len(covered)}/{len(inscope)} ({100*len(covered)/len(inscope):.1f}%)")
    print("MISSING (%d): %s"%(len(missing),", ".join(missing)))
    print("OUT-OF-SCOPE types observed: %s"%(", ".join("%s=%d"%(t,seen[t]) for t in extra)))
    for c in sorted(per_corpus): print(f"  corpus {c}: {len(per_corpus[c]&inscope)}/{len(inscope)}")
    if err:
        print("hasError files (first 20):")
        for r in err[:20]: print("   ", r["file"], r.get("errors"))
    if thrown:
        print("threw files (first 20):")
        for r in thrown[:20]: print("   ", r["file"], r.get("threw"))
main()
