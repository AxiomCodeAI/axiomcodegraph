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

usage: oracle_diff.py <engine-client-pairs> <oracle-edges>
"""
import re, sys

def norm(line):
    line = line.strip()
    if '->' not in line: return None
    a, b = [x.strip() for x in line.split('->', 1)]
    a = re.sub(r'\([^)]*\)$', '', a)          # caller: name level
    return f"{a} -> {b}"

eng = {norm(l) for l in open(sys.argv[1]) if norm(l)}
orc = {norm(l) for l in open(sys.argv[2]) if norm(l)}
missing = sorted(orc - eng); extra = sorted(eng - orc)
print(f"oracle={len(orc)} engine={len(eng)} agree={len(orc & eng)} missing={len(missing)} extra={len(extra)}")
for m in missing: print(f"  MISSING  {m}")
for e in extra:   print(f"  extra    {e}")
sys.exit(1 if missing else 0)
