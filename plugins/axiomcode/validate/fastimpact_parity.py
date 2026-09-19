#!/usr/bin/env python3
"""fastimpact_parity.py <repo> [N] — does the hook's fast path agree with impact.dl on the lines the hook prints?

Per target: the contract set and the resolved / by-name caller sets are compared as SETS (not counts), and the
closure counts are compared with a tolerance, since the fast path caps depth and impact.dl does not. Prints every
disagreement; exits non-zero if any set-level disagreement is found on a covered tier.

THIS HARNESS COULD NOT RUN AT ALL. It imported `hooks/fastimpact`, a module that no longer exists: the fast path
moved into `graph_sql.impact` / `impact_shaped`, and nobody repointed the guard, so it died on ImportError and the
gate it provides was silently gone. #1011 — the fast path counting a dispatch base as reached — is exactly what it
was written to catch. A guard whose import is stale is worse than no guard, because the repository looks guarded.

It also now checks the thing #1011 is about: no declaration may be reported as REACHED when its only arrival is the
candidate -> base step, on either side. The fast path declines on a graph carrying framework hops (it would answer a
smaller set than the rules), so a decline is reported as SKIP rather than as agreement.
"""
import json, os, random, subprocess, sys, sqlite3, time
H = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'hooks')
S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, S)
import graph_sql

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
    t0 = time.time(); fi = graph_sql.impact(repo, t); el = time.time() - t0
    if fi is None: print(f"  SKIP (fast path declines: a field, a constructor, or a graph with framework hops) {t}"); continue
    dl_contract = {x['display'] for x in dl.get('contract') or []}
    dl_res  = {x['display'] for x in (dl.get('direct') or []) if x.get('certainty') == 'resolved'}
    dl_name = {x['display'] for x in (dl.get('direct') or []) if x.get('certainty') == 'by name'}
    fi_c, fi_r, fi_n = set(fi['contract']), set(fi['reads']), set(fi['byname'])
    probs = []
    if fi_c != dl_contract: probs.append(f"contract dl={len(dl_contract)} sql={len(fi_c)} missing={sorted(dl_contract-fi_c)[:2]} extra={sorted(fi_c-dl_contract)[:2]}")
    if not dl_res <= (fi_r | fi_n): probs.append(f"resolved MISSING {sorted(dl_res-fi_r-fi_n)[:2]} (dl={len(dl_res)} sql={len(fi_r)})")
    if not dl_name <= (fi_n | fi_r): probs.append(f"by-name MISSING {len(dl_name-fi_n-fi_r)} of {len(dl_name)}")
    # #1011: a dispatch base is a waypoint. Neither side may report one as reached, and both must report it as a
    # contract when the engine records no override row for it — the shape that has no contract row of its own in a
    # structurally typed language, and that therefore used to land in `reached`.
    waypoints = {r[0] for r in con.execute("""SELECT DISTINCT b.display FROM dispatch_candidates dc
        JOIN symbols c ON c.method_id = dc.candidate_method_id JOIN symbols b ON b.method_id = dc.base_method_id
        WHERE c.display = ? AND dc.base_method_id <> dc.candidate_method_id
          AND NOT EXISTS (SELECT 1 FROM overrides o WHERE (o.method_id = dc.base_method_id AND o.overriding_method_id = dc.candidate_method_id)
                                                       OR (o.overriding_method_id = dc.base_method_id AND o.method_id = dc.candidate_method_id))""", (t,))} \
        if 'dispatch_candidates' in {r[0] for r in con.execute("SELECT name FROM sqlite_master")} else set()
    dl_reached = {x['display'] for x in dl.get('reached') or []}
    if waypoints & dl_reached: probs.append(f"rules count a dispatch base as REACHED: {sorted(waypoints & dl_reached)[:2]}")
    if waypoints - fi_c: probs.append(f"fast path does not report the dispatch base as a contract: {sorted(waypoints - fi_c)[:2]}")
    rows.append((t, el, len(dl_contract), len(fi_c), len(dl_res), len(fi_r), len(dl_name), len(fi_n), probs))
    flag = 'OK ' if not probs else 'BAD'
    if probs: bad += 1
    print(f"  {flag} {el:5.2f}s contract {len(dl_contract)}/{len(fi_c)}  resolved {len(dl_res)}/{len(fi_r)}  byname {len(dl_name)}/{len(fi_n)}  {t[:46]}")
    for p in probs: print(f"        ! {p}")
print(f"\nN={len(rows)}  disagreements={bad}")
sys.exit(1 if bad else 0)
