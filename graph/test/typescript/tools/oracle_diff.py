#!/usr/bin/env python3
"""Score the engine's client->client pairs against the TypeScript compiler's.

MISSING is a defect: the compiler says the edge exists and the engine does not have
it. EXTRA is sound over-approximation — but it is pinned too, because a rule that
widens the dispatch set must show up as a reviewable diff rather than hide behind
"extras are expected".

<known-missing> lists accepted gaps, one `Caller -> Callee` per line, `#` comments
allowed. A NEW missing edge fails. A known-missing edge that STARTS working also
fails, so the debt list cannot silently rot.

usage: oracle_diff.py <engine.pairs> <oracle.pairs> [known-missing]
"""
import os, sys

def load(p):
    if not os.path.exists(p):
        return set()
    return {l.strip() for l in open(p, encoding='utf-8') if l.strip()
            and not l.lstrip().startswith('#')}

eng, orc = load(sys.argv[1]), load(sys.argv[2])
known = load(sys.argv[3]) if len(sys.argv) > 3 else set()

agree = eng & orc
missing = orc - eng
extra = eng - orc
new_missing = missing - known
fixed = known & agree

print(f"oracle={len(orc)} engine={len(eng)} agree={len(agree)} "
      f"missing={len(missing)} (known {len(missing & known)}, NEW {len(new_missing)}) "
      f"extra={len(extra)}")
for m in sorted(new_missing):
    print(f"  MISSING  {m}")
for m in sorted(missing & known):
    print(f"  known    {m}")
for m in sorted(fixed):
    print(f"  NOW-FIXED (remove from known-missing)  {m}")
for e in sorted(extra):
    print(f"  extra    {e}")

sys.exit(1 if (new_missing or fixed) else 0)
