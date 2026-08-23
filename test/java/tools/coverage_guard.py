#!/usr/bin/env python3
"""COVERAGE GUARD — the invariant that catches silent drops.

Every invocation-shaped expression in the IR (METHOD_INVOCATION, OBJECT_CREATION,
ANONYMOUS_CLASS_CREATION, METHOD_REFERENCE, CONSTRUCTOR_INVOCATION) must appear as FromExpr in
call-chain-edges.csv — resolved, or explicitly flagged ambiguous. A site that appears NOWHERE was
dropped silently, which is the one failure mode a golden-file diff cannot see (you cannot notice an
absence you never recorded). Exit 1 if any site is missing.

usage: coverage_guard.py <IR-dir> <OUT-dir>
"""
import csv, sys, collections

ir, out = sys.argv[1], sys.argv[2]
KINDS = {'METHOD_INVOCATION', 'OBJECT_CREATION', 'ANONYMOUS_CLASS_CREATION',
         'METHOD_REFERENCE', 'CONSTRUCTOR_INVOCATION'}
rows = list(csv.reader(open(f'{ir}/all-expressions.csv'), delimiter='\t'))
H = {k: i for i, k in enumerate(rows[0])}
kids = collections.defaultdict(set)
for r in rows[1:]:
    if len(r) > H['parentExpressionHash'] and r[H['parentExpressionHash']]:
        kids[r[H['parentExpressionHash']]].add(r[H['edgeRole']])
sites = {}
for r in rows[1:]:
    if len(r) < len(rows[0]): continue
    if r[H['kind']] in KINDS:
        h = r[H['expressionUniqueHash']]
        q = bool(kids[h] & {'RECEIVER', 'QUALIFIER'})
        sites[h] = (r[H['kind']], 'qualified' if q else 'unqualified', r[H['startLine']])
present = {l.split('\t', 1)[0] for l in open(f'{out}/call-chain-edges.csv')}
absent = [(k, q, ln, h) for h, (k, q, ln) in sites.items() if h not in present]
print(f"call sites: {len(sites)}   absent from output: {len(absent)}")
for k, q, ln, h in sorted(absent, key=lambda x: int(x[2] or 0)):
    print(f"   SILENT DROP  {k} ({q}) at line {ln}  {h}")
sys.exit(1 if absent else 0)
