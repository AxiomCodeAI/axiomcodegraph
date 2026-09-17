#!/usr/bin/env python3
"""impact_kinds_parity.py <repo> [N] — parity AND coverage, per target kind.

The plain parity harness samples methods, which is the one kind the SQL port answers. On every other kind the port
declines, Soufflé runs, and the two outputs match trivially: a green run that proves nothing. This one samples each
kind, and reports for each whether SQL ANSWERED or FELL BACK (via AXIOMCODE_SQL_COVER) alongside whether the answers
agree. A kind is only done when it is both answered and identical.
"""
import json, os, random, sqlite3, subprocess, sys, time, collections
S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
repo = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 6
con = sqlite3.connect(f"file:{os.path.join(repo,'.axiomcode','out','graph.sqlite')}?mode=ro", uri=True)
random.seed(7)
def sample(sql, n):
    return [r[0] for r in con.execute(sql + f" ORDER BY random() LIMIT {n}")]
groups = {
  'method': sample("SELECT s.display FROM symbols s JOIN call_edges ce ON ce.callee_method_id=s.id WHERE s.method_id IS NOT NULL GROUP BY s.id", N),
  'field':  sample("SELECT display FROM symbols WHERE kind='field' AND display IS NOT NULL GROUP BY id", N),
  'const':  sample("SELECT display FROM symbols WHERE kind IN ('const','enum_member') AND display IS NOT NULL GROUP BY id", N),
  'type':   sample("SELECT display FROM symbols WHERE kind IN ('class','interface','enum') AND display IS NOT NULL AND display NOT LIKE '%<anon%' GROUP BY id", N),
}
# which side answered comes from AXIOMCODE_BACKEND, the flag the skill already ships
def run(t, sql):
    env = dict(os.environ); env['AXIOMCODE_SQL'] = '1' if sql else ''
    env['AXIOMCODE_BACKEND'] = '1'
    t0 = time.time()
    r = subprocess.run(['python3', os.path.join(S, 'axiomcode-impact'), t, repo, '--json', '--depth', '12'],
                       capture_output=True, text=True, timeout=300, env=env)
    cov = 'sql' if 'backend=sql' in (r.stderr or '') else ('fallback' if 'backend=datalog' in (r.stderr or '') else '')
    out = r.stdout or ''
    try: payload = json.loads(out) if out.strip() else None
    except json.JSONDecodeError: payload = ('text', out)
    return time.time() - t0, payload, cov
print(f"{'kind':8} {'target':44} {'souffle':>8} {'sql':>7}  engine    verdict")
print('-' * 92)
tally = collections.defaultdict(lambda: [0, 0, 0])   # kind -> [n, answered_by_sql, identical]
for kind, targets in groups.items():
    for t in targets:
        ds, a, _ = run(t, False); dq, b, cov = run(t, True)
        g = tally[kind]; g[0] += 1
        if cov == 'sql': g[1] += 1
        same = (a == b)
        if same: g[2] += 1
        print(f"{kind:8} {t[:44]:44} {ds:7.2f}s {dq:6.2f}s  {cov or '-':9} {'identical' if same else 'DIFFERS'}")
print(f"\n{'kind':8} {'n':>3} {'answered by SQL':>16} {'identical':>10}")
for k, (n, ans, ident) in tally.items():
    print(f"{k:8} {n:3} {ans:12}/{n:<3} {ident:8}/{n}")
notdone = [k for k, (n, ans, _) in tally.items() if ans < n]
print(f"\nkinds still falling back to Soufflé: {', '.join(notdone) if notdone else 'none'}")
sys.exit(1 if any(ident < n for n, _, ident in tally.values()) else 0)
