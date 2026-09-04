#!/usr/bin/env python3
"""Aggregate per-project score.txt into a dev / held-out report, and diff two runs.

WHY A SEPARATE AGGREGATOR. score.py adjudicates ONE project and is right to. But a
rule is not judged on one project: it is judged on whether it generalises, and that
question only has an answer when the development set and the DESIGN-BLIND held-out set
are read side by side. Reading one project at a time is how a rule that buys 277 exact
sites on the set it was designed against, at the cost of 13 wrong answers on the set it
was not, gets shipped as a win.

WHAT IT REFUSES TO DO. A project whose conservation loss is >= 2% is reported and then
EXCLUDED from its set's totals, marked UNSOUND. Every rate is computed over sites the IR
contains, so a project short 98% of the compiler's sites contributes a rate describing
2% of itself. Folding that into a set total produces a number that is not wrong so much
as meaningless, and issue #143 is exactly what happens when it is folded in anyway.

Usage:
  aggregate.py <work-root>                     one run
  aggregate.py <work-root> --baseline <root>   this run vs a previous one
"""
import os
import re
import sys

CONSERVATION_CEILING = 0.02


def parse(path):
    """score.txt -> dict. Absent/short keys stay None; a partial file is not a zero."""
    if not os.path.exists(path):
        return None
    t = open(path, encoding='utf-8', errors='replace').read()

    def g(pat, cast=int):
        m = re.search(pat, t, re.M)
        return None if m is None else cast(m.group(1))

    d = {
        'oracle':      g(r'^call sites \(oracle\)\s+(\d+)'),
        'joined':      g(r'^joined on position\s+(\d+)'),
        'exact':       g(r'^EXACT\s+(\d+)') or 0,
        'superset':    g(r'^SOUND_SUPERSET\s+(\d+)') or 0,
        'missed':      g(r'^MISSED\s+(\d+)') or 0,
        'wrong':       g(r'^WRONG\s+(\d+)') or 0,
        'decidable':   g(r'^decidable\s+(\d+)'),
        'answered':    g(r'answered / decidable\)\s+(\d+)'),
        'committed_wrong': g(r'committed and WRONG\s+(\d+)') or 0,
        'loss_pct':    g(r'^CONSERVATION LOSS\s+\d+\s+([\d.]+)% ', float),
        'refused':     'REFUSING TO REPORT' in t,
    }
    d['loss_pct'] = 0.0 if d['loss_pct'] is None else d['loss_pct'] / 100.0
    d['unsound'] = d['refused'] or d['loss_pct'] >= CONSERVATION_CEILING \
        or d['decidable'] in (None, 0)
    return d


def manifest():
    here = os.path.dirname(os.path.abspath(__file__))
    out = []
    for line in open(os.path.join(here, 'corpus.tsv'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        f = line.split()
        out.append((f[0], f[1]))
    return out


def collect(root):
    got = {}
    for name, st in manifest():
        got[name] = (st, parse(os.path.join(root, name, 'score.txt')))
    return got


def rate(n, d):
    return (n / d) if d else 0.0


def table(rows, base=None):
    hdr = (f"{'project':<12} {'sites':>7} {'exact':>7} {'exact%':>7} "
           f"{'inset%':>7} {'wrong':>6} {'wrong%':>7} {'missed':>7} {'loss':>6}")
    print(hdr)
    print('-' * len(hdr))
    tot = dict(sites=0, exact=0, inset=0, wrong=0, missed=0)
    btot = dict(sites=0, exact=0, inset=0, wrong=0, missed=0)
    for name, d in rows:
        if d is None:
            print(f'{name:<12} {"— NOT RUN":>7}')
            continue
        dec = d['decidable'] or 0
        inset = d['exact'] + d['superset']
        mark = '  UNSOUND' if d['unsound'] else ''
        print(f'{name:<12} {dec:>7} {d["exact"]:>7} {rate(d["exact"], dec):>7.3f} '
              f'{rate(inset, dec):>7.3f} {d["committed_wrong"]:>6} '
              f'{rate(d["committed_wrong"], dec):>7.3f} {d["missed"]:>7} '
              f'{d["loss_pct"]:>5.1%}{mark}')
        if d['unsound']:
            continue
        tot['sites'] += dec; tot['exact'] += d['exact']; tot['inset'] += inset
        tot['wrong'] += d['committed_wrong']; tot['missed'] += d['missed']
        if base is not None:
            b = base.get(name, (None, None))[1]
            if b is not None and not b['unsound']:
                bd = b['decidable'] or 0
                btot['sites'] += bd; btot['exact'] += b['exact']
                btot['inset'] += b['exact'] + b['superset']
                btot['wrong'] += b['committed_wrong']; btot['missed'] += b['missed']
    print('-' * len(hdr))
    print(f'{"TOTAL":<12} {tot["sites"]:>7} {tot["exact"]:>7} '
          f'{rate(tot["exact"], tot["sites"]):>7.3f} '
          f'{rate(tot["inset"], tot["sites"]):>7.3f} {tot["wrong"]:>6} '
          f'{rate(tot["wrong"], tot["sites"]):>7.3f} {tot["missed"]:>7}')
    if base is not None and btot['sites']:
        if btot['sites'] != tot['sites']:
            print(f'  ! site counts differ ({btot["sites"]} -> {tot["sites"]}); '
                  f'the two runs are not over the same population')
        print(f'{"Δ vs base":<12} {tot["sites"]-btot["sites"]:>+7} '
              f'{tot["exact"]-btot["exact"]:>+7} '
              f'{rate(tot["exact"],tot["sites"])-rate(btot["exact"],btot["sites"]):>+7.3f} '
              f'{rate(tot["inset"],tot["sites"])-rate(btot["inset"],btot["sites"]):>+7.3f} '
              f'{tot["wrong"]-btot["wrong"]:>+6} '
              f'{rate(tot["wrong"],tot["sites"])-rate(btot["wrong"],btot["sites"]):>+7.3f} '
              f'{tot["missed"]-btot["missed"]:>+7}')
    return tot, (btot if base is not None else None)


def main():
    root = sys.argv[1]
    base_root = None
    if '--baseline' in sys.argv:
        base_root = sys.argv[sys.argv.index('--baseline') + 1]
    got = collect(root)
    base = collect(base_root) if base_root else None

    results = {}
    for st in ('dev', 'holdout'):
        rows = [(n, d) for n, (s, d) in got.items() if s == st]
        if not rows:
            continue
        label = 'DEVELOPMENT SET — designed against' if st == 'dev' \
            else 'HELD-OUT SET — design-blind, measured only'
        print()
        print(f'══ {label} ══')
        b = {n: v for n, v in base.items() if v[0] == st} if base else None
        results[st] = table(rows, b)

    dev, ho = results.get('dev'), results.get('holdout')
    # A set with no sound project has no rate, and subtracting zero from the development
    # rate produces a "gap" that looks like a result. That is the exact failure issue #143
    # describes one level down, so say what is missing instead of printing a number.
    if dev and ho and not (dev[0]['sites'] and ho[0]['sites']):
        print()
        print('══ GENERALISATION — UNAVAILABLE ══')
        for st, r in (('development', dev), ('held-out', ho)):
            if not r[0]['sites']:
                print(f'  {st} set has NO sound project: every member either failed to '
                      f'produce ground')
                print(f'  truth or lost >={CONSERVATION_CEILING:.0%} of the compiler\'s '
                      f'sites. There is nothing to compare.')
        print('  Overfitting CANNOT be checked in this state. Fix the corpus before '
              'reading any rate above.')
    elif dev and ho:
        print()
        print('══ GENERALISATION ══')
        de, he = rate(dev[0]['exact'], dev[0]['sites']), rate(ho[0]['exact'], ho[0]['sites'])
        dw, hw = rate(dev[0]['wrong'], dev[0]['sites']), rate(ho[0]['wrong'], ho[0]['sites'])
        print(f'  exact   dev {de:.3f}  held-out {he:.3f}   gap {de-he:+.3f}')
        print(f'  wrong   dev {dw:.3f}  held-out {hw:.3f}   ratio '
              f'{(hw/dw if dw else float("inf")):.1f}x')
        print('  The gap IS the generalisation cost. A change that closes it is suspicious')
        print('  until the mechanism that closed it is named.')
        if base and dev[1] and ho[1] and ho[1]['sites']:
            hwb = rate(ho[1]['wrong'], ho[1]['sites'])
            if hw > hwb:
                print()
                print(f'  ✗ HELD-OUT WRONG RATE ROSE  {hwb:.4f} -> {hw:.4f} '
                      f'({ho[0]["wrong"]-ho[1]["wrong"]:+d} sites)')
                print('    This engine trades recall for correctness, never the reverse.')
                print('    A site with no answer is better than a site with a wrong one.')
                sys.exit(3)
    print()


if __name__ == '__main__':
    main()
