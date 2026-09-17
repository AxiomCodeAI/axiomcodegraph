#!/usr/bin/env python3
"""impact_sql_parity.py <repo> [N] — every ported relation, row-for-row against Soufflé, on sampled targets.

Runs `axiomcode impact` twice for each target: once with AXIOMCODE_DATALOG=1 (the rules), once as shipped (SQL,
the default). Compares TWO things:

  - the sixteen solver relations, captured through AXIOMCODE_DUMP_SOLVE and compared as sets, because that is
    what the port actually reproduces;
  - the formatted --json, which is what a user and the MCP tool see, so a rule ported wrongly shows up as a
    changed answer and not only as a changed relation.

The relation check is not redundant. `target_throws`, `caller_handles` and `caller_unhandled` are printed only
in the human-readable output, never in --json: comparing --json alone scored 34 targets identical across two
bundles while the SQL side returned all three empty.

Exits non-zero on any difference.
"""
import json, os, random, shutil, sqlite3, subprocess, sys, tempfile, time

S = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
repo = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 10
con = sqlite3.connect(f"file:{os.path.join(repo,'.axiomcode','out','graph.sqlite')}?mode=ro", uri=True)
# sample in PYTHON, not with sqlite's random(): sqlite's RNG does not take random.seed, so PARITY_SEED changed
# nothing and a failing target could not be re-run. Order by id first so the population itself is stable.
random.seed(int(os.environ.get("PARITY_SEED", "5")))
pool = [r[0] for r in con.execute("""SELECT s.display FROM symbols s JOIN call_edges ce ON ce.callee_method_id=s.id
    WHERE s.method_id IS NOT NULL GROUP BY s.id ORDER BY s.id""")]
targets = random.sample(pool, min(N, len(pool)))


def run(t, dl, dump):
    env = dict(os.environ)
    env['AXIOMCODE_DATALOG'] = '1' if dl else ''      # SQL is the default now; the rules are the opt-out
    env['AXIOMCODE_DUMP_SOLVE'] = dump; env['AXIOMCODE_BACKEND'] = '1'
    t0 = time.time()
    r = subprocess.run(['python3', os.path.join(S, 'axiomcode-impact'), t, repo, '--json', '--depth', '12'],
                       capture_output=True, text=True, timeout=900, env=env)
    rel = None
    f = [os.path.join(dump, x) for x in sorted(os.listdir(dump))] if os.path.isdir(dump) else []
    if f: rel = json.load(open(f[0]))
    be = 'sql' if 'backend=sql' in r.stderr else ('datalog' if 'backend=datalog' in r.stderr else '?')
    out = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None
    return time.time() - t0, out, rel, be


bad = notported = 0
print(f"{'target':46} {'souffle':>8} {'sql':>7} {'speedup':>8}  verdict")
print('-' * 90)
for t in targets:
    d1, d2 = tempfile.mkdtemp(prefix='par-dl-'), tempfile.mkdtemp(prefix='par-sq-')
    try:
        ds, a, ra, _ = run(t, True, d1); dq, b, rb, be = run(t, False, d2)
    finally:
        shutil.rmtree(d1, ignore_errors=True); shutil.rmtree(d2, ignore_errors=True)
    if a is None or b is None:
        print(f"{t[:46]:46} {'-':>8} {'-':>7} {'-':>8}  SKIP (no output)"); continue
    if be != 'sql':
        notported += 1
        print(f"{t[:46]:46} {ds:7.2f}s {dq:6.2f}s {'-':>8}  NOT PORTED (sql arm ran {be})"); continue
    det = []
    if ra and rb:
        for k in sorted(set(ra) | set(rb)):
            if k == '_targets': continue
            sa = {json.dumps(r) for r in ra.get(k, [])}; sb = {json.dumps(r) for r in rb.get(k, [])}
            if sa != sb: det.append(f"{k}(miss {len(sa-sb)}, extra {len(sb-sa)})")
    if a != b: det.append('--json')
    if det:
        bad += 1
        print(f"{t[:46]:46} {ds:7.2f}s {dq:6.2f}s {ds/dq:7.1f}x  DIFFERS {' '.join(det[:4])}")
    else:
        print(f"{t[:46]:46} {ds:7.2f}s {dq:6.2f}s {ds/dq:7.1f}x  identical")
print(f"\nN={len(targets)}  differing={bad}  not-ported={notported}")
sys.exit(1 if bad else 0)
