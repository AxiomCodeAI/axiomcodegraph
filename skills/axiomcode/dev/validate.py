#!/usr/bin/env python3
"""validate.py <tasks.json> <work-dir> --lang java|typescript|python|javascript [task-id …]
   validate.py <dogfood-dir> [task-id …]                                         (the parser corpus, as before)

End-to-end check of the two surfaces against real, issue-linked commits — no agent. For each task the graph is
built at the BASE commit (a worktree from the task's bare clone, the skill's own axiomcode-build), then:

  search  — the issue TITLE as words, then each `identifier` quoted in the issue body, one call each.
            PASS when a gold source file (a file the fix touched) is among the printed rows.
  impact  — the functions the gold patch changed (hunk start lines → enclosing method), `impact <method>` each.
            PASS when an oracle test file (a test the commit added or changed) is named.
Reported per task: which call found it, its rank, calls and characters ingested (the context an agent would pay).
"""
import json, os, re, subprocess, sys, glob, collections, argparse
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT = os.path.dirname(os.path.dirname(HERE))
AX = os.path.join(HERE, 'scripts', 'axiomcode'); IDX = os.path.join(HERE, 'scripts', 'axiomcode-index'); BUILD = os.path.join(HERE, 'scripts', 'axiomcode-build')
ap = argparse.ArgumentParser(); ap.add_argument('tasks'); ap.add_argument('work', nargs='?'); ap.add_argument('--lang', default=None); ap.add_argument('--src', default=None, help='subtree to analyse (AXIOMCODE_SRC), e.g. src for a solution-style tsconfig'); ap.add_argument('ids', nargs='*')
a = ap.parse_args()
if os.path.isdir(a.tasks):                                   # the dogfood layout: <dir>/tasks.json, graphs already under <dir>/work/<id>/*/repo
    DOG = os.path.abspath(a.tasks); TASKS = os.path.join(DOG, 'tasks.json'); WORK = None; only = set(([a.work] if a.work else []) + a.ids); LANG = a.lang or 'typescript'
    GIT = os.path.join(DOG, '..', '..', 'Parser')
else:
    TASKS = os.path.abspath(a.tasks); WORK = os.path.abspath(a.work); only = set(a.ids); LANG = a.lang; GIT = None
    assert LANG, '--lang is required for a mined corpus'
tasks = {t['id']: t for t in json.load(open(TASKS))}
EXT = r'ts|tsx|js|mjs|py|java'

def run(repo, *args):
    r = subprocess.run([sys.executable, AX, *args], cwd=repo, capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_LOGGED='1'))
    return r.stdout
def files_in(out): return set(re.findall(rf'(?<![\w/])((?:[\w.-]+/)+[\w.-]+\.(?:{EXT}))(?=[:\s,)]|$)', out))
def repo_for(tid, t):
    """the base-commit checkout with its graph: found (dogfood) or made (a mined corpus)"""
    if WORK is None:
        rs = [d for d in glob.glob(os.path.join(DOG, 'work', tid, '*', 'repo')) if os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite'))]
        return rs[0] if rs else None
    repo = os.path.join(WORK, tid, 'repo')
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        os.makedirs(os.path.dirname(repo), exist_ok=True)
        if not os.path.isdir(repo):
            r = subprocess.run(['git', '-C', t['git_dir'], 'worktree', 'add', '-f', '--detach', repo, t['base']], capture_output=True, text=True)
            if r.returncode: print(f"{tid}: checkout failed: {r.stderr.strip()[:200]}"); return None
        env = dict(os.environ, AXIOMCODE_LANG=LANG, AXIOMCODE_ENGINE=ROOT)
        if a.src: env['AXIOMCODE_SRC'] = a.src
        r = subprocess.run(['bash', BUILD, '.'], cwd=repo, capture_output=True, text=True, env=env)
        if r.returncode: print(f"{tid}: build failed: {(r.stdout + r.stderr)[-300:]}"); return None
    return repo

rows = []
for tid, t in sorted(tasks.items()):
    if only and tid not in only: continue
    repo = repo_for(tid, t)
    if not repo: continue
    subprocess.run([sys.executable, IDX, repo], capture_output=True)
    gold = set(t['gold_files'])
    # an oracle test that is a NEW file in the gold commit does not exist at base: no graph can name it. Score only the ones that do.
    tests = {f for f in t['test_files'] if subprocess.run(['git', '-C', GIT or t['git_dir'], 'cat-file', '-e', f"{t['base']}:{f}"], capture_output=True).returncode == 0}
    # ── search ─────────────────────────────────────────────────────────────────────────────────
    found_by, rank, chars = None, None, 0
    out = run(repo, 'search', re.sub(r'^\w+:\s*', '', t['title'])); chars += len(out)          # strip the "ts:" / "python:" prefix
    for i, line in enumerate(out.splitlines()):
        if files_in(line) & gold: found_by, rank = 'title', i; break
    body = t['body'] or ''
    idents = [w for w in re.findall(r'`([A-Za-z_][\w.]*)`', body) if len(w) >= 4][:8]
    # a stack trace is the best seed there is: the deepest frames in the project's own code, as Class.method
    frames = re.findall(r'\bat ((?:[a-z_]\w*\.)+)([A-Z]\w*)\.([a-z]\w*)\(', body)
    seen_f = set()
    for pkg, cls, meth in frames:
        k = f"{cls}.{meth}"
        if k not in seen_f and '$$' not in cls and not meth.startswith('lambda'): seen_f.add(k); idents.append(k)
    idents += [c for c in re.findall(r'\b([A-Z]\w{3,})\{', body) if c not in idents][:3]       # `MethodCallExprContext{wrapped=…}` in a message
    idents = idents[:12]
    calls = 1
    if not found_by:
        for w in idents:
            calls += 1; out = run(repo, 'search', w); chars += len(out)
            for i, line in enumerate(out.splitlines()):
                if files_in(line) & gold: found_by, rank = f'`{w}`', i; break
            if found_by: break
    # ── impact ─────────────────────────────────────────────────────────────────────────────────
    diff = subprocess.run(['git', 'diff', '--unified=0', t['base'], t['sha'], '--', *sorted(gold)], cwd=GIT or t['git_dir'], capture_output=True, text=True).stdout
    cur = None; hunks = []
    for line in diff.splitlines():
        if line.startswith('--- a/'): cur = line[6:]
        m = re.match(r'^@@ -(\d+)(?:,(\d+))? ', line)
        if m and cur: hunks.append((cur, int(m.group(1)) + max(0, (int(m.group(2) or 1) - 1) // 2)))
    methods = collections.OrderedDict()
    for f, ln in hunks[:12]:
        out = run(repo, 'search', f'{f}:{ln}')
        m = re.search(r'^(?:method|function|constructor) (\S+)', out, re.M)          # a hunk inside a type/interface lands on the module initializer: not a changed method
        if m: methods.setdefault(m.group(1), f)
    test_hit, cross_hit, ichars = None, set(), 0
    for disp, f in list(methods.items())[:6]:
        out = run(repo, 'impact', disp); fs = files_in(out); ichars += len(out) if not test_hit else 0
        if fs & tests and not test_hit: test_hit = disp
        cross_hit |= (fs & gold) - {f}
    rows.append(dict(id=tid, search=found_by or 'MISS', rank=rank, calls=calls, gold=len(gold), tests=len(tests), methods=len(methods), impact=test_hit or ('n/a: oracle tests are new files' if not tests else 'MISS' if methods else 'no hunk→method'), cross=len(cross_hit), chars=chars, ichars=ichars))
    print(f"{tid:12} search={rows[-1]['search']:<28} rank={str(rank):<5} calls={calls} chars={chars:<6} | changed methods={len(methods):<2} impact→oracle test={'yes: ' + test_hit if test_hit else rows[-1]['impact']:<50} other gold files named={len(cross_hit)}", flush=True)

n = len(rows)
if n:
    s = sum(1 for r in rows if r['search'] != 'MISS'); s1 = sum(1 for r in rows if r['search'] == 'title')
    im = [r for r in rows if r['methods'] and r['tests']]; ih = sum(1 for r in im if not r['impact'].startswith(('MISS', 'no hunk', 'n/a')))
    med = lambda xs: sorted(xs)[len(xs)//2] if xs else 0
    print(f"\nsearch: gold file named in {s}/{n} tasks ({s1} from the title alone); median calls {med([r['calls'] for r in rows])}, median chars ingested to get there {med([r['chars'] for r in rows if r['search'] != 'MISS'])} (~{med([r['chars'] for r in rows if r['search'] != 'MISS'])//4} tokens)")
    print(f"impact: oracle test file named for {ih}/{len(im)} tasks with a changed method (median chars {med([r['ichars'] for r in im if not r['impact'].startswith(('MISS','no hunk'))])}); other gold files named in {sum(1 for r in im if r['cross'])}/{len(im)}")
