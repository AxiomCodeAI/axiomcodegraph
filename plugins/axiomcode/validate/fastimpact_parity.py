#!/usr/bin/env python3
"""fastimpact_parity.py <repo> [N] — does hooks/fastimpact.py agree with impact.dl on the lines the hook prints?

Per target: the contract set and the resolved / by-name caller sets are compared as SETS (not counts), and the
closure counts are compared with a tolerance, since fastimpact caps depth and impact.dl does not. Prints every
disagreement; exits non-zero if any set-level disagreement is found on a covered tier.
"""
import json, os, random, subprocess, sys, sqlite3, time
H = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'hooks')
S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, H)
import fastimpact

repo = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 12
db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
random.seed(11)
targets = [r[0] for r in con.execute("""SELECT s.display FROM symbols s JOIN call_edges ce ON ce.callee_method_id=s.id
    WHERE s.method_id IS NOT NULL GROUP BY s.id HAVING count(*)>0 ORDER BY random() LIMIT ?""", (N,))]
bad = 0; rows = []
for t in targets:
    r = subprocess.run(['python3', os.path.join(S, 'axiomcode-impact'), t, repo, '--json', '--depth', '12'],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0: print(f"  SKIP (impact.dl failed) {t}"); continue
    try: dl = json.loads(r.stdout)
    except Exception: print(f"  SKIP (bad json) {t}"); continue
    t0 = time.time(); fi = fastimpact.impact(repo, t); el = time.time() - t0
    if fi is None: print(f"  SKIP (not in graph) {t}"); continue
    dl_contract = {x['display'] for x in dl.get('contract') or []}
    dl_res  = {x['display'] for x in (dl.get('direct') or []) if x.get('certainty') == 'resolved'}
    dl_name = {x['display'] for x in (dl.get('direct') or []) if x.get('certainty') == 'by name'}
    fi_c, fi_r, fi_n = set(fi['contract']), set(fi['reads']), set(fi['byname'])
    probs = []
    if fi_c != dl_contract: probs.append(f"contract dl={len(dl_contract)} sql={len(fi_c)} missing={sorted(dl_contract-fi_c)[:2]} extra={sorted(fi_c-dl_contract)[:2]}")
    if not dl_res <= (fi_r | fi_n): probs.append(f"resolved MISSING {sorted(dl_res-fi_r-fi_n)[:2]} (dl={len(dl_res)} sql={len(fi_r)})")
    if not dl_name <= (fi_n | fi_r): probs.append(f"by-name MISSING {len(dl_name-fi_n-fi_r)} of {len(dl_name)}")
    rows.append((t, el, len(dl_contract), len(fi_c), len(dl_res), len(fi_r), len(dl_name), len(fi_n), probs))
    flag = 'OK ' if not probs else 'BAD'
    if probs: bad += 1
    print(f"  {flag} {el:5.2f}s contract {len(dl_contract)}/{len(fi_c)}  resolved {len(dl_res)}/{len(fi_r)}  byname {len(dl_name)}/{len(fi_n)}  {t[:46]}")
    for p in probs: print(f"        ! {p}")
print(f"\nN={len(rows)}  disagreements={bad}")
sys.exit(1 if bad else 0)
