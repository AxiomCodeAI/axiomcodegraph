#!/usr/bin/env python3
"""The per-case TIER and REASON census — the axis a .edges golden cannot see.

WHAT .edges ALREADY PINS: a normalized, deduplicated SET of
(tier, callKind, caller -> callee) triples. That is the right shape for reviewing
which edges exist, and it is blind to three things by construction:

  * SITE COUNTS. Two call sites on one line, or two sites resolving to the same
    target, collapse to one row. A rule that halves the number of sites the engine
    emits leaves the set identical.
  * THE REASON on a declared unknown. Every ambiguous_unknown normalizes to
    `-> -`, so `no_rule` and `untyped_receiver:parameter` are the same row. The
    engine's own header says naming a blind spot is the difference between a work
    item and a mystery, and per case nothing pinned which it was.
  * THE TIER MIX as counts rather than as membership. Three sites moving from
    known_edge to multi_inferred while one moves the other way is a precision
    change the deduplicated set can absorb.

ROWS AND SITES ARE BOTH REPORTED, and conflating them is the trap this tool fell
into on its first version. call-chain-edges.csv holds one row PER TARGET, so a
multi_inferred site with three targets contributes three rows: on the
two-service-fastapi fixture that is 61 rows across 23 sites. Reading the row count
as a site count made a stable number look like a 2.7x drift. The engine derives
its own per-tier SITE counts in call_chain_summary, so both are printed and the
gap between them is explained below rather than left to the reader.

Java pins a per-case artifact for 32 of its 34 cases (expected/<case>.oracle). Python
pinned one, for the torture corpus, and nothing for the twelve cases. This is the
counterpart, and it deliberately needs NO external oracle checkout: it reads the
engine's own output, so it runs on a clean clone where --oracle cannot.

Counts only, never per-site lists: a per-site artifact churns whenever a fixture line
moves, and the distribution is what a reader interprets.

  usage: tier_report.py <out-dir>
"""
from __future__ import annotations
import collections
import os
import sys


# Kinds the engine emits as an EDGE with no written call site. Listed rather than
# inferred, so a new one shows up as a diff in every case's artifact.
NON_SITE_KINDS = {'PROPERTY_READ', 'METACLASS_CREATION', 'CONTEXT_MANAGER',
                  'ITERATION_PROTOCOL'}


def read_col(path, col):
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            f = line.rstrip('\n').split('\t')
            if len(f) > col:
                yield f


def main(out):
    tiers = collections.Counter()
    kinds = collections.Counter()
    reasons = collections.Counter()
    sites = set()
    tier_sites = collections.defaultdict(set)

    for f in read_col(os.path.join(out, 'call-chain-edges.csv'), 6):
        tiers[f[5]] += 1
        kinds[f[6]] += 1
        sites.add(f[0])
        tier_sites[f[5]].add(f[0])
    for f in read_col(os.path.join(out, 'call-site-unresolved.csv'), 3):
        reasons[f[2]] += 1

    # The conservation ledger the engine derives for itself, echoed here so the two
    # cannot drift apart unnoticed.
    summary = {}
    for f in read_col(os.path.join(out, 'call-chain-summary.csv'), 1):
        summary[f[0]] = f[1]

    print(f'distinct call sites emitted: {len(sites)}')
    print('\n--- by tier: edge ROWS, and the distinct SITES they cover ---')
    for k in sorted(tiers):
        print(f'  {tiers[k]:5d} rows  {len(tier_sites[k]):5d} sites  {k}')
    print('\n--- edge rows by call kind ---')
    for k, n in sorted(kinds.items()):
        print(f'  {n:5d}  {k}')
    print('\n--- unresolved reasons ---')
    if reasons:
        for k, n in sorted(reasons.items()):
            print(f'  {n:5d}  {k}')
    else:
        print('  (none — every site resolved)')
    print('\n--- the engine\'s own conservation ledger ---')
    for k in sorted(summary):
        print(f'  {summary[k]:>5s}  {k}')
    # THE TWO TOTALS ARE ALLOWED TO DIFFER, and the difference is the point rather
    # than a discrepancy: graph/python/README.md decision 5 says a property read and a
    # metaclass class-creation are real method->method edges that CPython's compiler
    # emits no CALL for, so they enter the graph and NOT the conserved site universe.
    # Printing the gap and which kinds account for it keeps a reader from reading the
    # mismatch as a conservation failure, and makes it a diff if a FOURTH such kind
    # ever appears.
    non_site = sorted(k for k in kinds if k in NON_SITE_KINDS)
    edge_rows = sum(tiers.values())
    ledger = int(summary.get('_total_sites', 0))
    fan = sum(len(v) for v in tier_sites.values())
    print('\n--- reconciling rows against the conserved site count ---')
    print(f'  edge rows                                  {edge_rows}')
    print(f'  minus extra rows from multi-target sites    {edge_rows - fan}')
    print(f'  = tier/site pairs                          {fan}')
    print(f'  engine\'s conserved site total              {ledger}')
    for k in non_site:
        print(f'  of which {kinds[k]} are {k}, an edge with no call site (README decision 5)')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'out/raw')
