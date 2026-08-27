#!/usr/bin/env python3
"""PER-SITE accuracy: how many call sites did the engine mark right, wrong, or too wide.

The oracle score in run-tests.sh counts EDGES. This counts SITES, which is a stricter and
more useful question: an engine can have excellent edge recall while being wrong at many
individual sites, and a dispatch set of 12 where 1 target runs scores as 1 agreed + 11
over-approximations per-edge but is one site the reader cannot trust.

GRANULARITY, STATED. On the pinned 3.10 `dis` carries no column information
(`co_positions` arrives in 3.11), so tier 4 can only attribute an executed edge to a caller
LINE. Where several call sites share a line -- `a.f() + b.f()` -- no ground truth can say
which ran which target. Sites are therefore grouped by (caller, line); the report says how
many groups hold more than one site so the reader can discount them.

Per group, against what CPython actually executed:

  EXACT            engine's target set == executed set
  SOUND SUPERSET   engine covers every executed target; extras are all inside the oracle's
                   sound envelope, i.e. genuinely reachable, just not on this input
  WRONG TARGET     engine emitted a target outside EVERY envelope -- a fabrication
  MISSED           an executed target the engine did not emit
  NOT EXERCISED    nothing ran here; correctness is not decidable, and saying so beats
                   counting it as a pass
  UNRESOLVED-OK    engine declared it unknown and nothing client-side ran -- the honest
                   answer was the right one
  UNRESOLVED-BAD   engine declared it unknown but something client-side DID run

usage: site_accuracy.py <src> <ir-dir> <out-dir>
"""
import collections
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle_path import harness_root                                   # noqa: E402

harness_root()
from callchain_oracle import build                                     # noqa: E402
from callchain_oracle.build import sound_envelope                      # noqa: E402
from callchain_oracle.normalize import Anchor, Normalizer, ir_anchor_line  # noqa: E402

SRC, IR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        r = list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r:
        return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]]


meth = rows(f'{IR}/all-python-methods.csv')
norm = Normalizer(SRC)
anchor, label = {}, {}
for m in meth:
    h = m.get('pyMethodUniqueHash')
    if not h:
        continue
    rel = (m.get('filePath') or '').replace(os.sep, '/')
    try:
        line = int(m.get('startLine') or 0)
    except ValueError:
        line = 0
    anchor[h] = Anchor(rel, ir_anchor_line(norm.index(os.path.join(SRC, rel)), line,
                                           m.get('methodKind', '')))
    label[h] = m.get('qualifiedName') or h

# site key -> (caller anchor key, source line, a readable description)
site_of = {}
for c in rows(f'{IR}/all-python-call-sites.csv'):
    a = anchor.get(c.get('pyMethodLinkHash'))
    if not a:
        continue
    try:
        line = int(c.get('startLine') or 0)
    except ValueError:
        continue
    d = f"{c.get('callKind')} .{c.get('calleeName') or '<expr>'}"
    for k in ('pyCallSiteUniqueHash', 'pyExpressionLinkHash'):
        if c.get(k):
            site_of[c[k]] = (a.key(), line, d)
type_file = {t['pyTypeUniqueHash']: (t.get('filePath') or '').replace(os.sep, '/')
             for t in rows(f'{IR}/all-python-types.csv') if t.get('pyTypeUniqueHash')}
for d in rows(f'{IR}/all-python-decorators.csv'):
    a = anchor.get(d.get('pyMethodLinkHash'))
    rel = a.file if a else type_file.get(d.get('pyTypeLinkHash'), '')
    try:
        line = int(d.get('startLine') or 0)
    except ValueError:
        continue
    caller = a.key() if a else f'{rel}:0'
    for k in ('pyDecoratorUniqueHash', 'pyExpressionLinkHash'):
        if d.get(k):
            site_of.setdefault(d[k], (caller, line, f"DECORATOR @{d.get('decoratorName')}"))

# engine: per site, the client targets and the tier
targets = collections.defaultdict(set)
tier, seen_site = {}, set()
for l in open(f'{OUT}/call-chain-edges.csv'):
    f = l.rstrip('\n').split('\t')
    if len(f) < 7:
        continue
    seen_site.add(f[0])
    tier[f[0]] = f[5]
    if f[4] == 'client' and f[3] in anchor:
        targets[f[0]].add(anchor[f[3]].key())

# PROPERTY READS AND METACLASS CREATIONS ARE EDGES WITHOUT CALL SITES. The engine keys
# them on the attribute-access expression (or the created type), because CPython's compiler
# emits no CALL for either -- so they are absent from py_call_site and a site inventory
# built from that relation alone cannot see them. Left out, the engine's own answer is
# invisible and the site reports as MISSED: measured as 2 false misses of Record.label on
# the two-service project, both of which the engine had emitted.
expr_line = {}
for e in rows(f'{IR}/all-python-expressions.csv'):
    h = e.get('pyExpressionUniqueHash')
    if h:
        try:
            expr_line[h] = int(e.get('startLine') or 0)
        except ValueError:
            pass
type_line = {}
for t in rows(f'{IR}/all-python-types.csv'):
    h = t.get('pyTypeUniqueHash')
    if h:
        try:
            type_line[h] = (int(t.get('startLine') or 0),
                            (t.get('filePath') or '').replace(os.sep, '/'))
        except ValueError:
            pass

o = build(SRC, entry=os.path.join(SRC, 'main.py'))
executed = collections.defaultdict(set)
for e in o['tier4']['edges']:
    # `definitional` is excluded for the same reason expected_edges excludes it
    # (normalisation Rule 10): it is a compiler-synthesised edge, not one the author wrote.
    if e.get('native') or e.get('definitional'):
        continue
    executed[(e['caller'], e['callerLine'])].add(e['callee'])
env = sound_envelope(o)

# attribute the site-less edge kinds to their real (caller, line)
for l in open(f'{OUT}/call-chain-edges.csv'):
    f = l.rstrip('\n').split('\t')
    if len(f) < 7 or f[0] in site_of:
        continue
    a = anchor.get(f[1])
    if not a:
        continue
    if f[6] == 'PROPERTY_READ' and f[0] in expr_line:
        site_of[f[0]] = (a.key(), expr_line[f[0]], 'PROPERTY_READ')
    elif f[6] == 'METACLASS_CREATION' and f[0] in type_line:
        site_of[f[0]] = (a.key(), type_line[f[0]][0], 'METACLASS_CREATION')

groups = collections.defaultdict(lambda: {'sites': [], 'eng': set(), 'tiers': set()})
for h, (caller, line, desc) in site_of.items():
    if h not in seen_site:
        continue
    g = groups[(caller, line)]
    g['sites'].append(desc)
    g['eng'] |= targets.get(h, set())
    g['tiers'].add(tier.get(h, '-'))

cat = collections.Counter()
width = collections.Counter()
width_single = collections.Counter()
multi_extra_in, multi_extra_out, multi_groups = 0, 0, 0
bad = []
for (caller, line), g in sorted(groups.items()):
    exp = executed.get((caller, line), set())
    eng, tiers = g['eng'], g['tiers']
    envelope = set(env.get(caller, ()))
    outside = {t for t in eng - exp if t not in envelope}
    missed = exp - eng
    if 'multi_inferred' in tiers:
        multi_groups += 1
        width[len(eng)] += 1
        if len(g['sites']) == 1:
            width_single[len(eng)] += 1
        multi_extra_in += len((eng - exp) & envelope)
        multi_extra_out += len(outside)
    if not eng:
        if exp:
            cat['UNRESOLVED-BAD'] += 1
            bad.append(('UNRESOLVED-BAD', caller, line, g['sites'], sorted(exp), []))
        else:
            cat['UNRESOLVED-OK'] += 1
        continue
    if not exp:
        cat['NOT EXERCISED'] += 1
        continue
    if missed:
        cat['MISSED'] += 1
        bad.append(('MISSED', caller, line, g['sites'], sorted(missed), sorted(eng)))
    elif outside:
        cat['WRONG TARGET'] += 1
        bad.append(('WRONG TARGET', caller, line, g['sites'], sorted(outside), sorted(eng)))
    elif eng == exp:
        cat['EXACT'] += 1
    else:
        cat['SOUND SUPERSET'] += 1

multi = len([1 for g in groups.values() if 'multi_inferred' in g['tiers']])
n = len(groups)
shared = len([1 for g in groups.values() if len(g['sites']) > 1])
print(f"{SRC}")
print(f"  {len(site_of)} site keys · {n} (caller,line) groups · {shared} group(s) hold >1 site")
print(f"  {'-'*66}")
order = ['EXACT', 'SOUND SUPERSET', 'WRONG TARGET', 'MISSED',
         'UNRESOLVED-OK', 'UNRESOLVED-BAD', 'NOT EXERCISED']
judged = sum(cat[k] for k in ('EXACT', 'SOUND SUPERSET', 'WRONG TARGET', 'MISSED',
                              'UNRESOLVED-OK', 'UNRESOLVED-BAD'))
for k in order:
    pct = f"{100*cat[k]/n:5.1f}%" if n else ''
    print(f"  {k:<16} {cat[k]:>5}  {pct}")
right = cat['EXACT'] + cat['SOUND SUPERSET'] + cat['UNRESOLVED-OK']
wrong = cat['WRONG TARGET'] + cat['MISSED'] + cat['UNRESOLVED-BAD']
print(f"  {'-'*66}")
print(f"  decidable groups: {judged}   RIGHT {right}   WRONG {wrong}"
      f"   accuracy {100*right/judged:.1f}%" if judged else "")
if multi_groups:
    print(f"\n  multi_inferred groups: {multi_groups}")
    # Width is per GROUP, and a group holding three sites unions their sets -- so the wide
    # tail is mostly grouping, not one site fanning. The single-site subset is the honest
    # "how wide is ONE dispatch set" number.
    print(f"    width, all groups:   " +
          ", ".join(f"{w}:{c}" for w, c in sorted(width.items())))
    print(f"    width, 1-site groups:" +
          ", ".join(f" {w}:{c}" for w, c in sorted(width_single.items())))
    print(f"    extra members INSIDE the sound envelope (reachable, not run): {multi_extra_in}")
    print(f"    extra members OUTSIDE every envelope (WRONG):                {multi_extra_out}")
print(f"MACHINE {os.path.basename(SRC)} {cat['EXACT']} {cat['SOUND SUPERSET']} "
      f"{cat['WRONG TARGET']} {cat['MISSED']} {cat['UNRESOLVED-OK']} {cat['UNRESOLVED-BAD']} "
      f"{cat['NOT EXERCISED']} {multi_groups} {multi_extra_in} {multi_extra_out}")
for kind, caller, line, sites, focus, eng in bad[:20]:
    print(f"\n  {kind} at {caller} line {line}  [{'; '.join(sites)}]")
    print(f"      engine: {eng}")
    print(f"      {'missing' if kind=='MISSED' else 'offending'}: {focus}")
