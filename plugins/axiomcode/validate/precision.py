#!/usr/bin/env python3
"""precision.py <repo> — WHY the upstream answer names more test files than actually fail.

Every predicted (method, test file) pair is placed twice:
  certainty  the worst hop on its best path — sound (every hop a single resolved target), one-of-a-set (a multi_inferred
             hop), dispatch (an override reached through its base), by-name (an unresolved site written with the name),
             inherited / import-time (the two file-level rules)
  hops       the shortest distance from the test to the changed method
and compared with the behavioural truth. A pair that is REACHABLE but did not fail is not a graph error: the test runs
the method and does not observe the change. A pair reachable only through an uncertain hop may not be reachable at all.
"""
import json, os, sys, sqlite3, collections
repo = os.path.abspath(sys.argv[1]); con = sqlite3.connect(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')); con.row_factory = sqlite3.Row
q = lambda s, *p: con.execute(s, p).fetchall()
RANK = {'sound': 0, 'one-of-a-set': 1, 'dispatch': 2, 'by-name': 3}
rev = collections.defaultdict(list)                       # callee_method → [(caller_method, certainty)]
TIER = {'known_edge': 'sound', 'library': 'sound', 'written': 'sound', 'multi_inferred': 'one-of-a-set'}
for r in q("SELECT e.callee_method_id c, s.method_id m, e.tier t FROM call_edges e JOIN symbols s ON s.id = e.caller_id WHERE s.method_id IS NOT NULL"):
    rev[r['c']].append((r['m'], TIER.get(r['t'], 'one-of-a-set')))
for r in q("SELECT dc.base_method_id b, dc.candidate_method_id c FROM dispatch_candidates dc WHERE dc.base_method_id <> dc.candidate_method_id"):
    rev[r['c']].append((r['b'], 'dispatch'))              # the base's callers may land on this override
sym = {r['method_id']: r for r in q("SELECT method_id, file, is_test, display, name, kind FROM symbols WHERE method_id IS NOT NULL")}
byname = collections.defaultdict(set)
for r in q("SELECT cs.callee_name n, s.method_id m FROM unresolved_sites u JOIN call_sites cs ON cs.id = u.call_site_id JOIN symbols s ON s.id = u.caller_id WHERE s.method_id IS NOT NULL"): byname[r['n']].add(r['m'])
by_display = collections.defaultdict(set)
for m, r in sym.items(): by_display[r['display']].add(m)
subs = collections.defaultdict(set)
for r in q("SELECT type_id t, ancestor_type_id a FROM type_ancestors"): subs[r['a']].add(r['t'])
rel = lambda f: os.path.relpath(f, repo) if os.path.isabs(f) else f
file_of_type = {r['id']: rel(r['file_path']) for r in q("SELECT id, file_path FROM types WHERE file_path IS NOT NULL")}
types_in_file = collections.defaultdict(set)
for t, f in file_of_type.items(): types_in_file[f].add(t)
def best(starts, tname):
    """(certainty, hops) per reached method, minimising certainty first then hops."""
    best = {}; frontier = [(m, 'sound', 0) for m in starts]
    for m in byname.get(tname, ()): frontier.append((m, 'by-name', 1))
    while frontier:
        nxt = []
        for m, cert, d in frontier:
            cur = best.get(m)
            if cur and (RANK[cur[0]], cur[1]) <= (RANK[cert], d): continue
            best[m] = (cert, d)
            for a, t in rev.get(m, ()):
                nxt.append((a, cert if RANK[cert] >= RANK[t] else t, d + 1))
        frontier = nxt
    return best
mut = [x for x in json.load(open(os.path.join(repo, '.axiomcode', 'mutation.json')))if x.get('truth')]
cell = collections.Counter(); hopcell = collections.Counter(); per = []
for x in mut:
    tr = x['truth']; truth = set(tr) if isinstance(tr, list) else {f for f, ds in tr.items() if not (len(ds) == 1 and ds[0].startswith('tsc'))}
    starts = by_display.get(x['method'], set())
    if not starts: continue
    b = best(starts, sym[next(iter(starts))]['name'])
    files = {}                                            # test file → (certainty, hops)
    for m, (cert, d) in b.items():
        s = sym[m]
        if s['is_test']:
            f = s['file']
            if f not in files or (RANK[cert], d) < (RANK[files[f][0]], files[f][1]): files[f] = (cert, d)
    for f, (cert, d) in list(files.items()):              # the two file-level rules, marked as such
        for t in types_in_file.get(f, ()):
            for sb in subs.get(t, ()):
                g = file_of_type.get(sb)
                if g and g not in files: files[g] = ('inherited', d)
    for f, (cert, d) in files.items():
        hit = f in truth; cell[(cert, hit)] += 1; hopcell[(min(d, 6), hit)] += 1
    per.append((x['method'], len(truth), len(files), len(truth & set(files))))
print(f"{'certainty':14} {'failed':>7} {'did not':>8} {'precision':>10}")
for c in ('sound', 'one-of-a-set', 'dispatch', 'by-name', 'inherited'):
    h, m = cell[(c, True)], cell[(c, False)]
    if h + m: print(f"{c:14} {h:7} {m:8} {h/(h+m):10.3f}")
print(f"\n{'hops':14} {'failed':>7} {'did not':>8} {'precision':>10}")
for d in range(0, 7):
    h, m = hopcell[(d, True)], hopcell[(d, False)]
    if h + m: print(f"{'≥6' if d == 6 else d:<14} {h:7} {m:8} {h/(h+m):10.3f}")
H = sum(v for (c, k), v in cell.items() if k); M = sum(v for (c, k), v in cell.items() if not k)
print(f"\noverall {H}/{H+M} = {H/(H+M):.3f}")
