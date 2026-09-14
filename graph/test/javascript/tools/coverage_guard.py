#!/usr/bin/env python3
"""
COVERAGE GUARD — every row of all-javascript-call-sites.csv must appear as the FromExpr
of at least one call-chain edge, resolved or explicitly unresolved. A site that appears
nowhere was dropped silently, and you cannot notice an absence you never recorded.

Usage: coverage_guard.py <ir-dir> <engine-out-dir>   -> exit 0 ok, 1 on any silent drop
"""
import csv
csv.field_size_limit(10**9)
import os
import sys

ir, out = sys.argv[1], sys.argv[2]
sites = {}
p = os.path.join(ir, 'all-javascript-call-sites.csv')
if os.path.exists(p) and os.path.getsize(p) > 0:
    with open(p, newline='') as fh:
        rows = list(csv.reader(fh, delimiter='\t'))
    h = rows[0]
    ie, ik, il = h.index('expressionLinkHash'), h.index('callKind'), h.index('startLine')
    for r in rows[1:]:
        if len(r) == len(h):
            sites[r[ie]] = (r[ik], r[il], r[h.index('calleeText')])
seen = set()
p = os.path.join(out, 'call-chain-edges.csv')
if os.path.exists(p):
    with open(p) as fh:
        for line in fh:
            f = line.rstrip('\n').split('\t')
            if f:
                seen.add(f[0])
missing = [k for k in sites if k not in seen]
print('sites=%d covered=%d silently-dropped=%d' % (len(sites), len(sites) - len(missing), len(missing)))
for k in missing[:20]:
    print('  DROPPED %s %s line %s %s' % (k, *sites[k]))
sys.exit(1 if missing else 0)
