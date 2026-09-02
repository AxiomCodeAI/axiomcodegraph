#!/usr/bin/env python3
"""COVERAGE GUARD — the invariant that catches silent drops.

Every invocation-shaped expression in the IR (METHOD_INVOCATION, OBJECT_CREATION,
ANONYMOUS_CLASS_CREATION, METHOD_REFERENCE, CONSTRUCTOR_INVOCATION) must appear as FromExpr in
call-chain-edges.csv — resolved, or explicitly flagged ambiguous. A site that appears NOWHERE was
dropped silently, which is the one failure mode a golden-file diff cannot see (you cannot notice an
absence you never recorded). Exit 1 if any site is missing.

ONE KIND IS EXCLUDED, DELIBERATELY AND VISIBLY: an ARRAY_CONSTRUCTOR method reference (`T[]::new`)
allocates an array and calls nothing, so call-edge-generation/call_chain.dl leaves it out of
invocation_site on purpose — "they resolve as array creation, not a call". Counting it here made
the guard report a drop for a construct the rules had decided is not a site, on every project that
writes `toArray(T[]::new)`, which is most of them. The count is PRINTED rather than silently
dropped: an exclusion nobody can see is one nobody can check, and this guard exists because one
was invisible. Every other method-reference kind is still required to appear.

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
excluded_array_ctor = 0
for r in rows[1:]:
    if len(r) < len(rows[0]): continue
    if r[H['kind']] in KINDS:
        if r[H['kind']] == 'METHOD_REFERENCE' and r[H['methodReferenceKind']] == 'ARRAY_CONSTRUCTOR':
            excluded_array_ctor += 1                     # see the module docstring
            continue
        h = r[H['expressionUniqueHash']]
        q = bool(kids[h] & {'RECEIVER', 'QUALIFIER'})
        sites[h] = (r[H['kind']], 'qualified' if q else 'unqualified', r[H['startLine']])
present = {l.split('\t', 1)[0] for l in open(f'{out}/call-chain-edges.csv')}
absent = [(k, q, ln, h) for h, (k, q, ln) in sites.items() if h not in present]
print(f"call sites: {len(sites)}   absent from output: {len(absent)}"
      + (f"   (excluded by design: {excluded_array_ctor} T[]::new)" if excluded_array_ctor else ""))
for k, q, ln, h in sorted(absent, key=lambda x: int(x[2] or 0)):
    print(f"   SILENT DROP  {k} ({q}) at line {ln}  {h}")
sys.exit(1 if absent else 0)
