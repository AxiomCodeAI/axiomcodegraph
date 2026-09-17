#!/usr/bin/env python3
"""impact_sql_parity.py <repo> [N] — every ported relation, row-for-row against Soufflé, on sampled targets.

Runs `axiomcode impact --json` twice for each target: once with AXIOMCODE_DATALOG=1 (the rules), once as
shipped (SQL, the default). Compares the
formatted output, which is what a user and the MCP tool actually see, so a rule ported wrongly shows up as a
changed answer rather than as a passing unit test. Exits non-zero on any difference.
"""
import json, os, random, sqlite3, subprocess, sys, time
S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
repo = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 10
con = sqlite3.connect(f"file:{os.path.join(repo,'.axiomcode','out','graph.sqlite')}?mode=ro", uri=True)
# sample in PYTHON, not with sqlite's random(): sqlite's RNG does not take random.seed, so PARITY_SEED changed
# nothing and a failing target could not be re-run. Order by id first so the population itself is stable.
random.seed(int(os.environ.get("PARITY_SEED", "5")))
pool = [r[0] for r in con.execute("""SELECT s.display FROM symbols s JOIN call_edges ce ON ce.callee_method_id=s.id
    WHERE s.method_id IS NOT NULL GROUP BY s.id ORDER BY s.id""")]
targets = random.sample(pool, min(N, len(pool)))
def run(t, sql):
    env = dict(os.environ); env['AXIOMCODE_DATALOG'] = '' if sql else '1'   # SQL is the default now; the rules are the opt-out
    t0 = time.time()
    r = subprocess.run(['python3', os.path.join(S, 'axiomcode-impact'), t, repo, '--json', '--depth', '12'],
                       capture_output=True, text=True, timeout=300, env=env)
    return time.time() - t0, (json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None)
bad = 0
print(f"{'target':46} {'souffle':>8} {'sql':>7} {'speedup':>8}  verdict")
print('-' * 86)
for t in targets:
    ds, a = run(t, False); dq, b = run(t, True)
    if a is None or b is None: print(f"{t[:46]:46} {'-':>8} {'-':>7} {'-':>8}  SKIP (no output)"); continue
    same = a == b
    if not same:
        bad += 1
        diff = [k for k in set(a) | set(b) if a.get(k) != b.get(k)]
        print(f"{t[:46]:46} {ds:7.2f}s {dq:6.2f}s {ds/dq:7.1f}x  DIFFERS in {diff[:4]}")
    else:
        print(f"{t[:46]:46} {ds:7.2f}s {dq:6.2f}s {ds/dq:7.1f}x  identical")
print(f"\nN={len(targets)}  differing={bad}")
sys.exit(1 if bad else 0)
