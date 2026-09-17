#!/usr/bin/env python3
"""fromtext.py [--set dev|holdout] [--top N] [-j N] — is the target chosen FROM THE REPORT as good as the one a human picks?

#764's measurement, on the arena: each case carries the report the bug came with (the failing test's stack trace). For each
fix, `impact --from-text` ranks candidates from that text; the top N are used as one change set and the answer is scored
against the declarations the fix actually changed — the same truth `cochange.py` uses, read by `axiomcode changed`.

Three rows, so the cost of choosing badly is separated from the cost of the rules:

  from the report   the top-N candidates the text ranks            — what a caller gets with no knowledge of the fix
  perfect target    one declaration the fix changed, chosen for it — the upper bound (it uses the answer)
  first frame       the innermost client frame of the trace        — the obvious baseline a human would try
"""
import collections, json, os, re, subprocess, sys, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cochange import changed_decls, split, SCR, ARENA

def impact_of(ax, targets, kinds=None):
    if not targets: return None
    r = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), *targets, ax, '--json', '--depth', '12'], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except Exception: return None

def covered(j, truth):
    if not j: return set()
    names = {x['display'] for x in j.get('contract', [])} | {x['display'] for x in j.get('direct', [])} | {x['display'] for x in j.get('reached', [])}
    simple = lambda d: d.split('.')[-1]
    hit = set()
    for t in truth:
        if t[0] in names or any(simple(n) == simple(t[0]) and n.split('.')[-2:] == t[0].split('.')[-2:] for n in names): hit.add(t[0])
    return hit

def run(args):
    case, top = args
    d = os.path.join(ARENA, case); c = json.load(open(os.path.join(d, 'case.json')))
    trace = c.get('trace') or ''
    if not trace.strip(): return None
    ax, decls = changed_decls(case)
    if not decls: return None
    truth = [x for x in decls]
    txt = os.path.join('/tmp', f'ft-{case}.txt'); open(txt, 'w').write(trace)
    r = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), '--from-text', txt, ax, '--top', str(top)], capture_output=True, text=True)
    chosen = re.findall(r'^\s+\d+\s+(.+?)\s+\[(\w+)\]', r.stdout, re.M)[:top]
    cands = re.findall(r'— `([^`]+)` in ', r.stdout)[:top]
    os.unlink(txt)
    from_report = covered(impact_of(ax, cands), truth) if cands else set()
    perfect = covered(impact_of(ax, [truth[0][3]]), truth[1:]) if len(truth) > 1 else set()
    frame = re.search(r'\bat\s+([\w$.]+)\.([\w$<>]+)\s*\(([\w$.]+)\.java:(\d+)\)', trace)
    first = covered(impact_of(ax, [f"{frame.group(3)}.java:{frame.group(4)}"]), truth) if frame else set()
    return dict(case=case, truth=len(truth), from_report=len(from_report), perfect=len(perfect), first_frame=len(first),
                truth_minus_one=max(len(truth) - 1, 0), chosen=[x[0] for x in chosen])

if __name__ == '__main__':
    a = sys.argv[1:]; which = 'dev'; top = 3; jobs = 2
    for f, conv in (('--set', str), ('--top', int), ('-j', int)):
        if f in a:
            i = a.index(f); v = conv(a[i + 1]); del a[i:i + 2]
            which = v if f == '--set' else which; top = v if f == '--top' else top; jobs = v if f == '-j' else jobs
    dev, hold = split(); cases = a or (dev if which == 'dev' else hold)
    rows = []
    with cf.ThreadPoolExecutor(jobs) as ex:
        for r in ex.map(run, [(c, top) for c in cases]):
            if r: rows.append(r)
    T = sum(r['truth'] for r in rows); T1 = sum(r['truth_minus_one'] for r in rows)
    print(f"{which}: {len(rows)} fixes with a report attached, top {top}")
    print(f"  from the report   {sum(r['from_report'] for r in rows)}/{T} = {sum(r['from_report'] for r in rows) / max(T, 1):.3f}  of the declarations the fix changed")
    print(f"  first frame only  {sum(r['first_frame'] for r in rows)}/{T} = {sum(r['first_frame'] for r in rows) / max(T, 1):.3f}")
    print(f"  perfect target    {sum(r['perfect'] for r in rows)}/{T1} = {sum(r['perfect'] for r in rows) / max(T1, 1):.3f}  (upper bound: seeded from a declaration the fix changed)")
    json.dump(rows, open(os.path.join(HERE, f'fromtext-{which}.json'), 'w'), indent=1)
