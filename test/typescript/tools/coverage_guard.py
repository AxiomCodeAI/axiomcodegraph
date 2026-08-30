#!/usr/bin/env python3
"""COVERAGE GUARD — the invariant a golden-file diff cannot see.

Every row in all-typescript-call-sites.csv must appear as the FromExpr column of
call-chain-edges.csv: resolved, or explicitly flagged unresolved. A site that appears
NOWHERE was dropped silently, and you cannot notice an absence you never recorded.

The parser emits call sites as their own relation here rather than leaving them to be
inferred from expression kinds, so this guard reads the parser's own list — which makes
it a conservation check between two independent artifacts instead of a restatement of
one of them.

usage: coverage_guard.py <IR-dir> <OUT-dir>
"""
import csv, sys, os
from collections import Counter

ir, out = sys.argv[1], sys.argv[2]

with open(f'{ir}/all-typescript-call-sites.csv', newline='', encoding='utf-8',
          errors='replace') as fh:
    r = list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))
if not r:
    print('call sites: 0   absent from output: 0')
    sys.exit(0)
H = {k: i for i, k in enumerate(r[0])}

sites = {}
for row in r[1:]:
    if len(row) < len(r[0]):
        continue
    sites[row[H['tsExpressionLinkHash']]] = (
        row[H['callKind']], row[H['calleeName']], row[H['receiverKind']],
        row[H['startLine']])

present = set()
p = f'{out}/call-chain-edges.csv'
if os.path.exists(p):
    for line in open(p, encoding='utf-8', errors='replace'):
        present.add(line.split('\t', 1)[0])

absent = [(k, nm, rk, ln, h) for h, (k, nm, rk, ln) in sites.items() if h not in present]
print(f"call sites: {len(sites)}   absent from output: {len(absent)}")
if absent:
    by_kind = Counter(a[0] for a in absent)
    print('   by kind: ' + ', '.join(f'{k}={v}' for k, v in sorted(by_kind.items())))
for k, nm, rk, ln, h in sorted(absent, key=lambda x: int(x[3] or 0)):
    print(f"   SILENT DROP  {k} {nm}() receiver={rk} at line {ln}  {h}")
sys.exit(1 if absent else 0)
