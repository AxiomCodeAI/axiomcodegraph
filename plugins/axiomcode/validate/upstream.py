#!/usr/bin/env python3
"""upstream.py <repo> — the UPSTREAM question ("what reaches this method?") against behavioural truth.

For each mutant in <repo>/.axiomcode/mutation.json (a method broken, the test files that then failed are the truth),
`impact <method> --tests` is asked which test FILES reach it. Recall is what matters: a missing upstream edge means
an agent told "nothing reaches this" is wrong. Every miss is classified from the graph, not guessed:

  inherited-test   the truth file declares no test of its own that reaches it — it inherits them from a base class
  no-edge          the method has unresolved callers / no resolved in-edge at all (dispatch, callback, framework)
  reached-not-test the file IS in the reached set but was not counted as a test (is_test / naming)
  deeper           reached only beyond the depth bound
"""
import json, os, re, subprocess, sys, collections, sqlite3
repo = os.path.abspath(sys.argv[1]); AX = os.path.expanduser('~/Documents/AxiomCode/axiom-code-graph/plugins/axiomcode/skills/axiomcode/scripts/axiomcode')
con = sqlite3.connect(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')); con.row_factory = sqlite3.Row
q = lambda s, *p: con.execute(s, p).fetchall()
mut = [x for x in json.load(open(os.path.join(repo, '.axiomcode', 'mutation.json'))) if x.get('truth')]
rows = []
for x in mut:
    tr = x['truth']; truth = set(tr) if isinstance(tr, list) else {f for f, ds in tr.items() if not (len(ds) == 1 and ds[0].startswith('tsc --noEmit'))}
    r = subprocess.run(['bash', AX, 'impact', x['method'], repo, '--tests', '--json'], capture_output=True, text=True)
    if '--kind' in (r.stdout + r.stderr): r = subprocess.run(['bash', AX, 'impact', x['method'], repo, '--tests', '--json', '--kind', 'method'], capture_output=True, text=True)
    try: j = json.loads(r.stdout)
    except Exception: rows.append(dict(m=x['method'], err=(r.stdout + r.stderr)[-120:], truth=len(truth))); continue
    got = {t['at'].rsplit(':', 1)[0] for t in j.get('tests', [])} | {t['at'].rsplit(':', 1)[0] for t in j.get('inherited_tests', [])}
    reached = {t['at'].rsplit(':', 1)[0] for t in j.get('reached', [])} | {t['at'].rsplit(':', 1)[0] for t in j.get('direct', [])}
    miss = {}
    for f in truth - got:
        base = os.path.basename(f)
        decl = q("SELECT count(*) n FROM symbols WHERE file LIKE ? AND method_id IS NOT NULL", '%' + base)[0]['n']
        if f in reached: miss[f] = 'reached-not-test'
        elif decl == 0: miss[f] = 'not-in-graph'
        else:
            # does any callable declared in that file have a resolved out-edge at all?
            out = q("SELECT count(*) n FROM call_edges e JOIN symbols s ON s.id = e.caller_id WHERE s.file LIKE ?", '%' + base)[0]['n']
            miss[f] = 'inherited-test' if out == 0 else 'no-edge'
    rows.append(dict(m=x['method'], truth=len(truth), got=len(got), hit=len(truth & got), extra=len(got - truth), miss=miss,
                     byname=len(j.get('byname_callers', [])), inherited=len(j.get('inherited_tests', [])),
                     unresolved_inside=j.get('unresolved_inside'), verified=j.get('verified')))
tp = sum(r.get('hit', 0) for r in rows); T = sum(r.get('truth', 0) for r in rows); G = sum(r.get('got', 0) for r in rows)
cls = collections.Counter(v for r in rows for v in r.get('miss', {}).values())
for r in rows: print(json.dumps(r))
print(f"\n{len(rows)} mutants  recall {tp}/{T} = {tp / T:.3f}  precision {tp}/{G} = {tp / G:.3f}  misses by cause: {dict(cls)}")
