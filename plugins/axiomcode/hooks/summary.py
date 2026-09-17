#!/usr/bin/env python3
"""summary.py <repo> — the closure a hook cannot afford per call, computed once per graph in Datalog and stored as rows:
for every method, how many tests and how many entry points can reach it. Started in the background by the first Read hook
on a graph without it; the Read hook reads a row afterwards. All-pairs reach is not computed (quadratic); sources are tests ∪
entry points only."""
import os, sqlite3, subprocess, sys, tempfile, shutil
repo = os.path.abspath(sys.argv[1]); out = os.path.join(repo, '.axiomcode', 'out'); db = os.path.join(out, 'graph.sqlite'); SUM = os.path.join(out, 'summary.sqlite')
DL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'summary.dl')
# the compiled binary when there is one — `axiomcode index` warms it. Interpreted, this closure exceeded the 600 s
# below on jackson-databind (1,373 files): the reach counts then never exist at all.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'skills', 'axiomcode', 'scripts')))
import dl_program
try:
    con = sqlite3.connect(db); q = lambda s: con.execute(s).fetchall()
    F = tempfile.mkdtemp(prefix='axsum-'); O = tempfile.mkdtemp(prefix='axsum-out-')
    edges = [(r[0], r[1]) for r in q("SELECT caller_id, callee_method_id FROM call_edges WHERE callee_method_id IS NOT NULL AND callee_provenance='client'")]
    if q("SELECT 1 FROM sqlite_master WHERE name='dispatch_candidates'"):
        edges += [(r[0], r[1]) for r in q("SELECT DISTINCT dc.base_method_id, dc.candidate_method_id FROM dispatch_candidates dc JOIN methods m ON m.id=dc.candidate_method_id WHERE m.provenance='client' AND dc.base_method_id<>dc.candidate_method_id AND (m.owner_type_id IS NULL OR m.owner_type_id IN (SELECT type_id FROM type_instantiated) OR NOT EXISTS (SELECT 1 FROM type_instantiated))")]
    open(os.path.join(F, 'edge.facts'), 'w').write(''.join(f"{a}\t{b}\n" for a, b in edges))
    tests = {r[0] for r in q("SELECT id FROM symbols WHERE is_test=1 AND method_id IS NOT NULL")}
    open(os.path.join(F, 'test.facts'), 'w').write(''.join(t + '\n' for t in tests))
    callees = {b for _, b in edges}; allm = {r[0] for r in q("SELECT id FROM symbols WHERE method_id IS NOT NULL AND kind<>'module'")}
    open(os.path.join(F, 'entry.facts'), 'w').write(''.join(m + '\n' for m in allm if m not in callees and m not in tests))
    r = subprocess.run(dl_program.program(DL) + ['-F', F, '-D', O], capture_output=True, text=True, timeout=600)
    if r.returncode: raise RuntimeError(r.stderr[-300:])
    rows = {}
    for name, col in (('tests_reaching', 0), ('entries_reaching', 1)):
        for l in open(os.path.join(O, name + '.csv')):
            m, n = l.rstrip('\n').split('\t'); rows.setdefault(m, [0, 0])[col] = int(n)
    sc = sqlite3.connect(SUM + '.tmp'); sc.execute("CREATE TABLE reach(method TEXT PRIMARY KEY, tests INT, entries INT)")
    sc.executemany("INSERT INTO reach VALUES (?,?,?)", ((m, t, e) for m, (t, e) in rows.items())); sc.commit(); sc.close()
    os.replace(SUM + '.tmp', SUM)
finally:
    shutil.rmtree(F, ignore_errors=True); shutil.rmtree(O, ignore_errors=True)
    try: os.remove(SUM + '.building')
    except OSError: pass
