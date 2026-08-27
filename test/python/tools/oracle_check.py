#!/usr/bin/env python3
"""Validate a case against the FROZEN CPython ground truth, and score the engine.

FOUR THINGS HAPPEN HERE, in this order, and each can fail independently:

  1. MANIFEST -- every lock matches its recorded digest. Editing a lock in place
     to turn a red check green breaks this, and this repo cannot rewrite the
     manifest: only `bin/freeze.py` in the harness can.
  2. FRESHNESS -- the fixture on disk is the fixture the lock was frozen from.
     Editing a case without re-freezing scores new code against an old answer,
     which is worse than no test.
  3. DRIFT -- rebuild the oracle from CPython right now and compare with the
     lock. A difference means the INTERPRETER or the HARNESS changed, not the
     engine. Reporting it as an engine failure would send someone hunting a bug
     that is not there.
  4. SCORE -- if engine edges were supplied, score them. Per construct group,
     with conservation, and with fabrication kept separate from
     over-approximation.

Steps 1-3 need no engine at all, which is what makes the ground truth
independently checkable while the rule set is still being written.

usage: oracle_check.py <case> <src> [--pairs FILE] [--sites FILE] [--json OUT]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle_path import harness_root, locks_dir           # noqa: E402

harness_root()
from callchain_oracle import build                         # noqa: E402
from callchain_oracle import lock as locklib               # noqa: E402
from callchain_oracle.score import score                   # noqa: E402


def _cmp(label, old, new, problems, limit=12):
    o, n = {json.dumps(x, sort_keys=True) for x in old}, {json.dumps(x, sort_keys=True) for x in new}
    for missing in sorted(o - n)[:limit]:
        problems.append(f'{label}: in lock, gone now   {missing}')
    for extra in sorted(n - o)[:limit]:
        problems.append(f'{label}: new, not in lock    {extra}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('case')
    ap.add_argument('src')
    ap.add_argument('--pairs', default=None, help='engine caller<TAB>callee anchors')
    ap.add_argument('--sites', default=None, help='engine-accounted file:line list')
    ap.add_argument('--json', default=None)
    args = ap.parse_args()

    locks = locks_dir()

    # 1. manifest integrity
    problems = locklib.verify_manifest(locks)
    if problems:
        print('LOCK MANIFEST FAILED -- the frozen expectations are not trustworthy:')
        for p in problems:
            print(f'   {p}')
        return 2

    lock = locklib.load(locks, args.case)
    if lock is None:
        print(f'NO LOCK for {args.case}.')
        print(f'   This repo cannot create one. Freeze it from the harness:')
        print(f'   {os.path.join(harness_root(), "bin/freeze.py")} {args.case} {args.src}')
        return 3

    # 2. freshness
    stale = locklib.check_fresh(lock, args.src)
    if stale:
        print(f'LOCK STALE for {args.case} -- the fixture changed since it was frozen:')
        for p in stale:
            print(f'   {p}')
        print('   Re-freeze from the harness (a deliberate act), then review the diff.')
        return 4

    # 3. drift: does CPython still say the same thing?
    oracle = build(args.src, entry=os.path.join(args.src, 'main.py'))
    drift = []
    if oracle['crossCheck']['tier3VsTier4Conflicts']:
        drift.append(f'ORACLE SELF-CHECK: {len(oracle["crossCheck"]["tier3VsTier4Conflicts"])} '
                     f'tier3/tier4 conflicts (an oracle bug, not an engine bug)')
    rebuilt = locklib.to_lock(args.case, args.src, oracle)
    if rebuilt['tier3Counts'] != lock['tier3Counts']:
        drift.append(f'tier3 counts {lock["tier3Counts"]} -> {rebuilt["tier3Counts"]}')
    _cmp('expected edge', lock['expected'], rebuilt['expected'], drift)
    _cmp('tier1 site', lock['tier1Sites'], rebuilt['tier1Sites'], drift)
    if drift:
        print(f'GROUND TRUTH DRIFT for {args.case} -- CPython no longer agrees with the lock.')
        print(f'   interpreter now {oracle["interpreter"]}, lock frozen on {lock["interpreter"]}')
        for d in drift[:20]:
            print(f'   {d}')
        return 5

    # 4. score the engine, if there is one
    if not args.pairs:
        print(f'{args.case}: lock verified '
              f'({len(lock["expected"])} expected edges, {len(lock["tier1Sites"])} sites, '
              f'tier4 coverage {lock["tier4Coverage"][0]}/{lock["tier4Coverage"][1]}). '
              f'No engine edges supplied -- ground truth checked, engine not scored.')
        return 0

    pairs = []
    with open(args.pairs) as fh:
        for line in fh:
            a, _, b = line.rstrip('\n').partition('\t')
            if b:
                pairs.append((a, b))
    sites = None
    if args.sites and os.path.exists(args.sites):
        with open(args.sites) as fh:
            sites = {l.strip() for l in fh if l.strip()}

    report = score(oracle, pairs, sites)
    print(report.text())
    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(report.to_json(), fh, indent=1, sort_keys=True)

    failed = (not report.conservation_ok
              or any(g.fabricated for g in report.groups.values())
              or any(g.missing for g in report.groups.values()))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
