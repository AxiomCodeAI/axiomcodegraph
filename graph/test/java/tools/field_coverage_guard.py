#!/usr/bin/env python3
"""FIELD-ACCESS COVERAGE GUARD — the conservation ledger for field_access.

Two assertions, and the second is the one that catches a silent drop:

 1. Every row of the engine's own site universe (field-access-site.csv) appears as a site in
    field-access.csv. A site the rules recognised and then resolved to nothing must arrive as a
    declared unknown, never as an absence. This is the same invariant coverage_guard.py enforces
    for call sites, and it exists for the same reason: an absence is the one failure a golden
    diff cannot see.

 2. Every FIELD-SHAPED EXPRESSION in the IR is accounted for — either it became a site, or it
    falls in one of the categories the rules exclude ON PURPOSE. Each category is counted and
    PRINTED, so an exclusion is visible rather than assumed, and anything left over is reported
    as UNACCOUNTED and fails the run.

The deliberate exclusions are NOT re-derived here. The rules publish their own ledger,
field-site-excluded.csv (site, reason), so this guard compares the IR against the engine's
decisions instead of a Python imitation of them. Three reasons exist:
  * `switch_case_label` — an enum constant in a case label is recorded TYPE for some arms and
    FIELD for others (#760), and javac compiles the switch through a $SwitchMap array, so there
    is no field access in the bytecode either.
  * `names_a_type` — a dotted name that names a TYPE (`java.net.Proxy.Type`, `Map.Entry`): the
    parser emits the package segments as FIELD_ACCESS nodes.
  * `type_qualifier` — a FIELD-stamped identifier the engine decided is a type qualifier
    (`URI.create(...)`, expr-type.dl FIX-13).
Anything in the IR that is neither a site nor an exclusion is UNACCOUNTED and fails the run.

usage: field_coverage_guard.py <IR-dir> <RAW-dir>
"""
import csv, sys, collections
csv.field_size_limit(10**9)

ir, raw = sys.argv[1], sys.argv[2]
rows = list(csv.reader(open(f'{ir}/all-expressions.csv'), delimiter='\t'))
H = {k: i for i, k in enumerate(rows[0])}
kids = collections.defaultdict(set)
for r in rows[1:]:
    if len(r) > H['parentExpressionHash'] and r[H['parentExpressionHash']]:
        kids[r[H['parentExpressionHash']]].add(r[H['edgeRole']])

candidates = {}
for r in rows[1:]:
    if len(r) < len(rows[0]):
        continue
    kind, refkind = r[H['kind']], r[H['referencedEntityKind']]
    h = r[H['expressionUniqueHash']]
    qualified = 'QUALIFIER' in kids[h]
    if kind == 'FIELD_ACCESS' and qualified:
        pass
    elif kind in ('FIELD_ACCESS', 'IDENTIFIER_REFERENCE') and refkind == 'FIELD' and not qualified:
        pass
    else:
        continue
    candidates[h] = (kind, r[H['rootContext']], r[H['literalValue']], r[H['startLine']])

def column(path, n=1):
    out = collections.defaultdict(set)
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            f = line.rstrip('\n').split('\t')
            if f and f[0]:
                out[f[0]].add(f[1] if n > 1 and len(f) > 1 else '')
    except FileNotFoundError:
        pass
    return out

declared_sites = set(column(f'{raw}/field-access-site.csv'))
emitted_sites = set(column(f'{raw}/field-access.csv'))
excluded = column(f'{raw}/field-site-excluded.csv', 2)

dropped = sorted(declared_sites - emitted_sites)
unaccounted = sorted(h for h in candidates if h not in declared_sites and h not in excluded)
by_reason = collections.Counter(r for h in candidates if h in excluded for r in excluded[h])

print(f"field sites: {len(declared_sites)}   absent from output: {len(dropped)}")
print("IR candidates: %d   excluded by design: %s" % (len(candidates),
      ", ".join(f"{n} {r}" for r, n in sorted(by_reason.items())) or "none"))
for h in dropped[:20]:
    k, ctx, name, ln = candidates.get(h, ('?', '?', '?', '?'))
    print(f"   SILENT DROP  {k} `{name}` at line {ln}  {h}")
for h in unaccounted[:20]:
    k, ctx, name, ln = unsited[h]
    print(f"   UNACCOUNTED  {k} `{name}` ctx={ctx} at line {ln}  {h}")
if unaccounted:
    print(f"   ... {len(unaccounted)} unaccounted in total")
sys.exit(1 if dropped or unaccounted else 0)
