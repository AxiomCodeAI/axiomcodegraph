#!/usr/bin/env python3
"""path_sql_parity.py <repo> [N] — path.dl, path-opt.dl and path-every.dl against their SQL port.

Runs `axiomcode path` twice per pair: once as shipped (Soufflé), once with AXIOMCODE_SQL=1, and compares the
printed answer, which is what a user and the MCP tool see. A rule ported wrongly shows up as a changed answer
rather than as a passing unit test.

Three shapes are sampled, because they exercise different rules:
  A -> B        hit / parent, and path-opt.dl when nothing resolved connects them
  '*' -> B      dist_up   (everything that reaches B)
  A -> '*'      dist      (everything A reaches)
and a quarter of the A -> B pairs are re-run with --every, which is the only caller of path-every.dl.

Exits non-zero on any difference.
"""
import os, random, sqlite3, subprocess, sys, time
S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
repo = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 12
con = sqlite3.connect(f"file:{os.path.join(repo,'.axiomcode','out','graph.sqlite')}?mode=ro", uri=True)
random.seed(5)
names = [r[0] for r in con.execute("""SELECT s.display FROM symbols s JOIN call_edges ce ON ce.callee_method_id=s.id
    WHERE s.method_id IS NOT NULL GROUP BY s.id ORDER BY random() LIMIT ?""", (N * 2,))]
if len(names) < 2: print('not enough methods in this graph'); sys.exit(0)
cases = []
for i in range(0, min(len(names) - 1, N), 2):
    cases.append((names[i], names[i + 1], []))
    if i % 4 == 0: cases.append((names[i], names[i + 1], ['--every']))
for n in names[:max(2, N // 3)]:
    cases.append(('*', n, [])); cases.append((n, '*', []))

def run(a, b, extra, sql):
    env = dict(os.environ); env['AXIOMCODE_SQL'] = '1' if sql else ''
    t0 = time.time()
    r = subprocess.run(['python3', os.path.join(S, 'axiomcode-path'), a, b, repo] + extra,
                       capture_output=True, text=True, timeout=600, env=env)
    return time.time() - t0, (r.stdout or '') + (r.stderr or '')

bad = tot_s = tot_q = 0
print(f"{'case':58} {'souffle':>8} {'sql':>7} {'speedup':>8}  verdict")
print('-' * 98)
for a, b, extra in cases:
    ds, o1 = run(a, b, extra, False); dq, o2 = run(a, b, extra, True)
    tot_s += ds; tot_q += dq
    label = f"{a[:24]} -> {b[:24]}{' --every' if extra else ''}"
    if o1 == o2:
        print(f"{label:58} {ds:7.2f}s {dq:6.2f}s {ds/max(dq,1e-6):7.1f}x  identical")
    else:
        bad += 1
        d1 = [l for l in o1.splitlines() if l not in o2.splitlines()][:2]
        d2 = [l for l in o2.splitlines() if l not in o1.splitlines()][:2]
        print(f"{label:58} {ds:7.2f}s {dq:6.2f}s {ds/max(dq,1e-6):7.1f}x  DIFFERS")
        for l in d1: print(f"      souffle only: {l[:110]}")
        for l in d2: print(f"      sql only    : {l[:110]}")
print(f"\nN={len(cases)}  differing={bad}  total souffle={tot_s:.1f}s  total sql={tot_q:.1f}s  overall={tot_s/max(tot_q,1e-6):.1f}x")
sys.exit(1 if bad else 0)
