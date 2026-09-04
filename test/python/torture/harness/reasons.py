"""The unresolved-REASON distribution, as a pinned artifact.

WHY THIS EXISTS. Every other golden in this suite is an EDGE list, so a change that
alters no edge is invisible to all of them — and the diagnosis a blind spot carries
is exactly that kind of change. `no_rule` is defined in
call-edge-generation/call_chain.dl as a site that could not be resolved AND could not
be explained, and site_reason's own comment says the difference it makes: "a blind
spot you can name is a work item; one you cannot is a mystery."

Nothing was checking the mysteries. `no_rule` could grow by a hundred sites, or a
reason could stop firing entirely, and all thirteen checks would stay green. This is
the counterpart of test/java's previous-vs-present scorer (#158) for the one axis this
front end reports on and did not pin.

The artifact is a COUNT PER REASON, not a per-site list, because the per-site set
churns with every fixture added while the distribution is what a reader interprets.
A new reason appearing, an old one vanishing, or a count moving all show up as a diff.
"""
import collections
import os
import sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, 'out')

by_reason = collections.Counter()
by_kind = collections.Counter()
total = 0
with open(os.path.join(OUT, 'call-site-unresolved.csv'), encoding='utf-8') as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) < 4:
            continue
        total += 1
        by_reason[f[2]] += 1
        by_kind[f[3]] += 1

print(f'unresolved sites: {total}')
print('\n--- by reason ---')
for reason, n in sorted(by_reason.items()):
    print(f'  {n:5d}  {reason}')
print('\n--- by call kind ---')
for kind, n in sorted(by_kind.items()):
    print(f'  {n:5d}  {kind}')
print('\n--- the mysteries ---')
print(f'  no_rule = {by_reason.get("no_rule", 0)} of {total}'
      f'  ({100.0 * by_reason.get("no_rule", 0) / total:.1f}%)' if total else '  n/a')
