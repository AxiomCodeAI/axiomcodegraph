#!/usr/bin/env python3
"""Suite-wide coverage and scoring summary, generated from the FROZEN locks.

Two tables, and the second is the one that matters while the rule set is empty:

  1. WHAT THE SUITE PINS -- per case and per construct group, how many call
     sites and how many must-have edges the ground truth contains. This is the
     denominator every future score is measured against, and it is a fact about
     the fixtures, not about any engine.

  2. WHAT THE ENGINE SCORES -- run only when engine output exists. Per construct
     group, never aggregated: an aggregate hides which mechanism broke.

usage: suite_report.py [--work DIR] [--markdown]
"""
import argparse
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle_path import harness_root, locks_dir            # noqa: E402

harness_root()
from callchain_oracle import lock as locklib               # noqa: E402
from callchain_oracle.score import GROUPS, group_of, score  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = os.path.join(HERE, 'cases')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default=os.path.join(HERE, '.work'))
    ap.add_argument('--markdown', action='store_true')
    args = ap.parse_args()
    locks = locks_dir()

    names = sorted(d for d in os.listdir(CASES)
                   if os.path.isdir(os.path.join(CASES, d, 'src')))
    rows = []
    group_sites = Counter()
    total_sites = total_expected = total_real = 0
    tier4_cov = tier4_tot = 0
    status_counts = Counter()

    for name in names:
        lock = locklib.load(locks, name)
        if lock is None:
            rows.append((name, '-', '-', '-', '-', 'NO LOCK'))
            continue
        sites = len(lock['tier1Sites'])
        # Rule 10: `class X:` and a comprehension's own invocation are calls the
        # compiler synthesised, not calls anyone wrote. Inventoried, but not part
        # of the conservation denominator.
        real = sum(1 for s in lock['tier1Sites'] if not s.get('implicit'))
        exp = len(lock['expected'])
        cov, tot = lock['tier4Coverage']
        c = lock['tier3Counts']
        for r in lock['tier3Resolutions']:
            g = group_of(r)
            group_sites[g] += 1
            status_counts[r['status']] += 1
        total_sites += sites
        total_real += real
        total_expected += exp
        tier4_cov += cov
        tier4_tot += tot
        rows.append((name, f'{real}+{sites - real}', exp, f'{cov}/{tot}',
                     f"{c['resolved']}/{c['dispatch_set']}/{c['native']}/{c['unresolved']}",
                     'ok'))

    print('WHAT THE SUITE PINS')
    print('=' * 86)
    print(f'{"case":<26}{"real+impl":>11}{"must-have":>11}{"tier4 cov":>12}'
          f'{"res/disp/nat/unres":>22}')
    print('-' * 86)
    for name, s, e, cov, counts, note in rows:
        print(f'{name:<26}{str(s):>11}{str(e):>11}{cov:>12}{counts:>22}')
    print('-' * 86)
    print(f'{"TOTAL":<26}{f"{total_real}+{total_sites - total_real}":>11}'
          f'{total_expected:>11}{f"{tier4_cov}/{tier4_tot}":>12}')
    print(f'\n  {total_real} sites are the CONSERVATION denominator; the other '
          f'{total_sites - total_real} are\n  compiler-synthesised (`class X:`, a comprehension '
          f'invoking itself) and have no\n  counterpart in the IR — counting them would invent '
          f'dropped sites.')
    print()
    print('tier-3 status across the whole suite: ' +
          ', '.join(f'{k}={v}' for k, v in sorted(status_counts.items())))
    print(f'tier-4 exercised {tier4_cov}/{tier4_tot} sites '
          f'({100.0 * tier4_cov / tier4_tot:.0f}%) — recall against tier 4 is '
          f'recall over exercised code, not over the corpus')
    print()
    print('CALL SITES BY CONSTRUCT GROUP (the mechanism that decides dispatch)')
    print('-' * 86)
    native = group_sites['native_boundary']
    for g in GROUPS:
        if group_sites[g]:
            print(f'  {g:<24}{group_sites[g]:>5} sites')
    print(f'\n  client-to-client sites (excluding native_boundary): '
          f'{sum(group_sites.values()) - native}')
    print('  native_boundary is scoped OUT of this suite by design — library linking')
    print('  is python-library-linking\'s problem, kept separate so a regression here')
    print('  is never ambiguous about which layer broke.')
    print()

    # ── engine scoring, if any engine output exists ─────────────────────────
    scored = [n for n in names if os.path.exists(os.path.join(args.work, n, 'engine.pairs'))]
    if not scored:
        print('WHAT THE ENGINE SCORES')
        print('=' * 86)
        print('  No engine output found under .work/. The Python rule set is empty, so')
        print('  there is nothing to score yet. Every must-have edge above is currently')
        print('  MISSING and every site above is currently DROPPED — precision is')
        print('  undefined (no edges emitted), recall is 0.000, conservation FAILS.')
        print()
        print('  Baseline to beat, from the deleted prototype:')
        print('    34 of 49 sites known, all 49 accounted for.')
        print('  Note that "all accounted for" is the part that must hold from the first')
        print('  rule onwards; the 34 is what the rules have to improve on.')
        return 0

    print('WHAT THE ENGINE SCORES  (per construct group; never aggregated)')
    print('=' * 86)
    from callchain_oracle import build
    agg = defaultdict(lambda: Counter())
    for name in scored:
        src = os.path.join(CASES, name, 'src')
        oracle = build(src, entry=os.path.join(src, 'main.py'))
        pairs = []
        with open(os.path.join(args.work, name, 'engine.pairs')) as fh:
            for line in fh:
                a, _, b = line.rstrip('\n').partition('\t')
                if b:
                    pairs.append((a, b))
        sfile = os.path.join(args.work, name, 'engine.sites')
        sites = [l.strip() for l in open(sfile)] if os.path.exists(sfile) else None
        rep = score(oracle, pairs, sites)
        print(f'\n{name}')
        print(rep.text())
        for g, gs in rep.groups.items():
            for k in ('sites', 'expected', 'emitted', 'agreed', 'missing',
                      'over_approx', 'fabricated', 'dropped_sites'):
                agg[g][k] += getattr(gs, k)

    print('\n' + '=' * 86)
    print('SUITE TOTAL, PER GROUP')
    print(f'{"group":<24}{"exp":>5}{"agree":>7}{"miss":>6}{"over":>6}{"fabr":>6}'
          f'{"drop":>6}{"P":>8}{"R":>8}')
    for g in GROUPS:
        c = agg.get(g)
        if not c or not (c['expected'] or c['emitted']):
            continue
        d = c['agreed'] + c['over_approx'] + c['fabricated']
        p = f'{c["agreed"] / d:.3f}' if d else '  -  '
        r = f'{c["agreed"] / c["expected"]:.3f}' if c['expected'] else '  -  '
        print(f'{g:<24}{c["expected"]:>5}{c["agreed"]:>7}{c["missing"]:>6}'
              f'{c["over_approx"]:>6}{c["fabricated"]:>6}{c["dropped_sites"]:>6}{p:>8}{r:>8}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
