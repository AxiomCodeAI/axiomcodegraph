#!/usr/bin/env python3
"""Compare the engine's client->client edges against the JDK-derived bytecode oracle.

CONTRACT
  * MISSING (the oracle has it, the engine does not) is a FAILURE. Bytecode's declared targets are
    facts; the graph must contain all of them.
  * EXTRA is REPORTED, not failed. Where dispatch is ambiguous the engine emits the sound set of
    possible targets, so it is expected to be a superset. Review them; they should be dispatch
    possibilities, not inventions.

Caller signatures are compared at NAME level, because a lambda body's bytecode caller
(`lambda$m$N`) folds into the enclosing method and cannot carry that method's descriptor.

A CONSTRUCTOR callee is compared at name level too, and for the same kind of reason: javac gives a
constructor parameters the source never writes. An inner class's constructor takes the enclosing
instance first; a local or anonymous class's also takes every captured variable. `new Inner()` in
source is `Inner(Outer)` in bytecode, and no normalisation recovers the captured ones at all. The
exact parameter list is still pinned — it is in the `.edges` golden, which is compared in full —
so overload precision is not lost here, only the comparison that cannot be made.

usage: oracle_diff.py <engine-client-pairs> <oracle-edges>
"""
import re, sys

def norm(line):
    line = line.strip()
    if '->' not in line: return None
    a, b = [x.strip() for x in line.split('->', 1)]
    a = re.sub(r'\([^)]*\)$', '', a)          # caller: name level
    if '#<init>(' in b: b = re.sub(r'\([^)]*\)$', '', b)   # constructor callee: name level
    return f"{a} -> {b}"

import os
eng = {norm(l) for l in open(sys.argv[1]) if norm(l)}
orc = {norm(l) for l in open(sys.argv[2]) if norm(l)}
# KNOWN-MISSING: gaps we have decided to carry (e.g. a construct the extractor does not emit at
# all, so no rule can reach it). Listed explicitly so the debt is visible and reviewable — a NEW
# missing edge still fails, and a known one that starts working also fails, so the list cannot rot.
known = set()
kfile = sys.argv[3] if len(sys.argv) > 3 else None
if kfile and os.path.exists(kfile):
    for l in open(kfile):
        l = l.strip()
        if l and not l.startswith('#'):
            n = norm(l)
            if n: known.add(n)
missing = sorted(orc - eng); extra = sorted(eng - orc)
new_missing = [m for m in missing if m not in known]
fixed = sorted(known - (orc - eng))
print(f"oracle={len(orc)} engine={len(eng)} agree={len(orc & eng)} missing={len(missing)} "
      f"(known {len(missing) - len(new_missing)}, NEW {len(new_missing)}) extra={len(extra)}")
for m in missing: print(f"  {'MISSING' if m not in known else 'known-missing'}  {m}")
for e in extra:   print(f"  extra    {e}")
for f in fixed:   print(f"  NOW-FIXED (remove from known-missing)  {f}")
sys.exit(1 if (new_missing or fixed) else 0)
