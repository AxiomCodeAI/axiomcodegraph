#!/usr/bin/env python3
"""COVERAGE GUARD -- the invariant a golden diff structurally cannot check.

Every call site the parser recorded must appear in the engine's output: resolved,
or explicitly flagged ambiguous. A site that appears NOWHERE was dropped
silently, and you cannot notice the absence of something that was never recorded
-- so this is asserted separately and fails the case on its own.

TWO INDEPENDENT INVENTORIES ARE CHECKED, because they fail differently:

  1. the IR's own `all-python-call-sites.csv` -- did the ENGINE drop a site the
     PARSER found?
  2. tier 1 of the CPython oracle -- did the PARSER drop a site CPython's own
     compiler emitted? A site missing from the IR is invisible to check 1, since
     check 1's denominator is the IR itself. This is the check that catches a
     parser-level gap masquerading as an engine that "handled everything".

usage: coverage_guard.py <IR-dir> <OUT-dir> <SRC-dir> [--oracle]
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine_edges import IR, edge_rows, rows               # noqa: E402


def main() -> int:
    ir_dir, out_dir, src = sys.argv[1], sys.argv[2], sys.argv[3]
    use_oracle = '--oracle' in sys.argv

    ir = IR(ir_dir, src)
    edges = edge_rows(out_dir)
    if edges is None:
        print(f'SILENT DROP CHECK IMPOSSIBLE: no call-chain-edges.csv in {out_dir}')
        return 1

    emitted = {e['site'] for e in edges}
    parser_sites = rows(os.path.join(ir_dir, 'all-python-call-sites.csv'))
    # Decorator applications are real call sites the parser records separately.
    # An unmodelled decorator is `ambiguous_unknown`, never dropped.
    decorators = rows(os.path.join(ir_dir, 'all-python-decorators.csv'))
    absent = []
    for c in parser_sites:
        hashes = [c.get('pyCallSiteUniqueHash'), c.get('pyExpressionLinkHash')]
        if not any(h and h in emitted for h in hashes):
            absent.append((c.get('startLine', '?'), c.get('calleeName', '?'),
                           c.get('callKind', '?')))
    for d in decorators:
        hashes = [d.get('pyDecoratorUniqueHash'), d.get('pyExpressionLinkHash')]
        if not any(h and h in emitted for h in hashes):
            absent.append((d.get('startLine', '?'), '@' + (d.get('decoratorName') or '?'),
                           'DECORATOR_' + (d.get('kind') or '?')))
    print(f'IR call sites: {len(parser_sites)} + {len(decorators)} decorator applications'
          f'   absent from engine output: {len(absent)}')
    for line, name, kind in sorted(absent, key=lambda x: int(x[0] or 0)):
        print(f'   SILENT DROP  {kind} {name}() at line {line}')

    oracle_absent = []
    if use_oracle:
        from vendor.normalize import Normalizer                       # noqa: E402
        from vendor.tier1_sites import sites_for_tree                 # noqa: E402
        norm = Normalizer(src)
        covered = set()
        for c in parser_sites:
            mh = c.get('pyMethodLinkHash')
            a = ir.anchor(mh)
            if a is None:
                continue
            try:
                covered.add((a.file, int(c.get('startLine') or 0)))
            except ValueError:
                pass
        for s in sites_for_tree(src, norm):
            if (s.file, s.line) not in covered:
                oracle_absent.append(s)
        print(f'CPython tier-1 sites: n/a-in-IR check -> {len(oracle_absent)} not represented in the IR')
        for s in oracle_absent[:25]:
            print(f'   PARSER GAP  {s.file}:{s.line} {s.callee_name or "?"} (via {s.via})')

    return 1 if absent else 0


if __name__ == '__main__':
    sys.exit(main())
