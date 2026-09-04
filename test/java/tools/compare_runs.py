#!/usr/bin/env python3
"""Previous vs present, on two engine runs over the SAME IR — did the change make anything worse?

A scale number that only moves in aggregate hides the two failures that matter most, because both
can happen while every headline figure improves:

  * a call site that had an answer and now has none;
  * a call site that had ONE answer and now has several, which is a precision loss even though the
    edge is still there.

Neither shows up in "unresolved fell by 700". This reads both runs site by site and reports them
separately, and it exits non-zero when a site was LOST or UNRESOLVED, because those are regressions
whatever else improved.

Both runs must be over the same client IR: the comparison is keyed on the expression hash, and two
IRs from different parser revisions do not share them.

usage: compare_runs.py <before-OUT> <after-OUT> [--top N]
"""
import collections, sys

STATUS_ORDER = ['known_edge', 'multi_inferred', 'boundary_lib', 'ambiguous_unknown', 'ambiguous_anon']
RESOLVED = {'known_edge', 'multi_inferred', 'boundary_lib'}


def read(out):
    """expression -> (set of statuses, set of callees)."""
    st, tg = collections.defaultdict(set), collections.defaultdict(set)
    with open(f'{out}/call-chain-edges.csv', encoding='utf-8', errors='replace') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            if len(c) < 7: continue
            st[c[0]].add(c[5]); tg[c[0]].add(c[3])
    return st, tg


def main():
    before, after = sys.argv[1], sys.argv[2]
    top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 10
    sb, tb = read(before)
    sa, ta = read(after)

    lost_sites = sorted(set(sb) - set(sa))
    new_sites = sorted(set(sa) - set(sb))
    unresolved_now, resolved_now, widened, narrowed, retargeted = [], [], [], [], []
    for e in set(sb) & set(sa):
        rb = bool(sb[e] & RESOLVED); ra = bool(sa[e] & RESOLVED)
        if rb and not ra: unresolved_now.append(e)
        elif ra and not rb: resolved_now.append(e)
        if not (rb and ra): continue
        if len(tb[e]) < len(ta[e]): widened.append(e)
        elif len(tb[e]) > len(ta[e]): narrowed.append(e)
        elif tb[e] != ta[e]: retargeted.append(e)

    def counts(st):
        c = collections.Counter()
        for v in st.values():
            for s in v: c[s] += 1
        return c
    cb, ca = counts(sb), counts(sa)

    print(f"call sites            {len(sb):>8,} -> {len(sa):>8,}")
    for s in STATUS_ORDER:
        if cb[s] or ca[s]:
            d = ca[s] - cb[s]
            print(f"  sites with {s:<18} {cb[s]:>8,} -> {ca[s]:>8,}   {d:+,}")
    print()
    print(f"REGRESSIONS")
    print(f"  call sites lost                 {len(lost_sites):>6,}")
    print(f"  had an answer, now has none     {len(unresolved_now):>6,}")
    print(f"  target set WIDENED              {len(widened):>6,}   (precision: one answer became several)")
    print(f"IMPROVEMENTS")
    print(f"  call sites gained               {len(new_sites):>6,}")
    print(f"  had no answer, now has one      {len(resolved_now):>6,}")
    print(f"  target set NARROWED             {len(narrowed):>6,}")
    print(f"  same width, different targets   {len(retargeted):>6,}")
    for label, xs in (('lost', lost_sites), ('now unresolved', unresolved_now), ('widened', widened)):
        for e in xs[:top]:
            print(f"    {label}: {e}  {sorted(sb.get(e, ()))} -> {sorted(sa.get(e, ()))}")

    return 1 if (lost_sites or unresolved_now) else 0


if __name__ == '__main__':
    sys.exit(main())
