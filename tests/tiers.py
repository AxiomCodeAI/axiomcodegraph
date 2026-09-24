#!/usr/bin/env python3
"""tests/tiers.py — every tier the schema documents is one the frontend knows how to rank and label.

`ax_edges.py` ranks a tier it has not been taught LAST and labels it `registered`, which is the honest default
for an edge it cannot name — and the wrong answer for a resolved one. C#'s `known_implicit_ctor` and
`known_builtin_operator` and TypeScript's `intrinsic_terminal` were documented in the schema and missing here,
so nothing failed while every answer that met them read them as the weakest claim. This compares the two
lists, so a tier added to graph/bundle/schema.ts fails here until the frontend is taught it.

    python3 tests/tiers.py
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts'))
import ax_edges

schema = open(os.path.join(ROOT, 'graph', 'bundle', 'schema.ts')).read()
tiers = sorted(set(re.findall(r"table: 'call_edges', column: 'tier', value: '([a-z_]+)'", schema)))
bad = []
if len(tiers) < 4: bad.append(f"read only {len(tiers)} tiers from schema.ts — the pattern no longer matches it")
for t in tiers:
    if t not in ax_edges.TIER_RANK: bad.append(f"{t}: no rank (it would sort below every real call)")
    if t not in ax_edges.TIER_NOTE: bad.append(f"{t}: no note (the legend would call it unknown)")
    if t not in ax_edges.DIRECT_CERT and not t.startswith('ambiguous_'):
        bad.append(f"{t}: no certainty (a dependent through it would be labelled `{ax_edges.DIRECT_CERT_DEFAULT}`)")
for b in bad: print("FAIL", b)
print(f"{len(tiers)} tier(s) in the schema; " + ("ok" if not bad else f"{len(bad)} problem(s)"))
sys.exit(1 if bad else 0)
