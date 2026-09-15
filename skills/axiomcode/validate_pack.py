#!/usr/bin/env python3
"""validate_pack.py <tasks.json|dogfood-dir> [work-dir] [--lang L] [--budget N] [ids…] — does ONE `pack "<issue title>"` name the
gold files, and how dense is it? recall = gold files named / gold files; density = gold files named / distinct files named;
also whether an oracle test file present at base is named. No agent."""
import json, os, re, subprocess, sys, glob, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); AX = os.path.join(HERE, 'scripts', 'axiomcode')
ap = argparse.ArgumentParser(); ap.add_argument('tasks'); ap.add_argument('work', nargs='?'); ap.add_argument('--lang', default=None); ap.add_argument('--budget', default='6000'); ap.add_argument('ids', nargs='*')
a = ap.parse_args()
if os.path.isdir(a.tasks): DOG = os.path.abspath(a.tasks); TASKS = os.path.join(DOG, 'tasks.json'); WORK = None; only = set(([a.work] if a.work else []) + a.ids)
else: TASKS = os.path.abspath(a.tasks); WORK = os.path.abspath(a.work); only = set(a.ids); DOG = None
tasks = {t['id']: t for t in json.load(open(TASKS))}
files_in = lambda out: set(re.findall(r'(?<![\w/])((?:[\w.-]+/)+[\w.-]+\.(?:ts|tsx|js|mjs|py|java))(?=[:\s,)]|$)', out))
rows = []
for tid, t in sorted(tasks.items()):
    if only and tid not in only: continue
    if WORK is None:
        rs = [d for d in glob.glob(os.path.join(DOG, 'work', tid, '*', 'repo')) if os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite'))]
        repo = rs[0] if rs else None
    else:
        repo = os.path.join(WORK, tid, 'repo'); repo = repo if os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')) else None
    if not repo: continue
    out = subprocess.run([sys.executable, AX, 'pack', re.sub(r'^\w+:\s*', '', t['title']), f'budget={a.budget}'], cwd=repo, capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_LOGGED='1')).stdout
    named = files_in(out); gold = set(t['gold_files'])
    gitdir = t.get('git_dir') or os.path.join(DOG or os.path.dirname(TASKS), '..', '..', 'Parser')
    tests = {f for f in t['test_files'] if subprocess.run(['git', '-C', gitdir, 'cat-file', '-e', f"{t['base']}:{f}"], capture_output=True).returncode == 0}
    rec = len(named & gold) / max(1, len(gold)); dens = len(named & gold) / max(1, len(named)); th = bool(named & tests)
    rows.append((tid, rec, dens, th, len(named), len(out)))
    print(f"{tid:16} gold recall {rec:.2f}  density {dens:.2f}  oracle test named {'yes' if th else 'no ' if tests else 'n/a'}  files named {len(named):2}  chars {len(out)}")
n = len(rows)
if n: print(f"\n{n} tasks: mean gold recall {sum(r[1] for r in rows)/n:.2f}, any gold file in {sum(1 for r in rows if r[1] > 0)}/{n}, mean density {sum(r[2] for r in rows)/n:.2f}, oracle test named {sum(1 for r in rows if r[3])}/{sum(1 for r in rows if r[3] is not None)}, mean chars {sum(r[5] for r in rows)/n:.0f} (~{sum(r[5] for r in rows)/n/4:.0f} tokens)")
