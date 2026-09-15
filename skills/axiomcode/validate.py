#!/usr/bin/env python3
"""validate.py <dogfood-dir> [task-id …]  — end-to-end check of the two surfaces against real tasks, no agent.

For every task whose base-commit graph exists under <dogfood>/work/<id>/*/repo/.axiomcode:

  search  — the issue TITLE as words, then each `identifier` quoted in the issue body, one call each.
            PASS when a gold source file (the file the fix touched) is among the printed rows.
            Reported: which call found it (title / identifier / neither) and its rank.
  impact  — the functions the gold patch changed (hunk start lines → enclosing method), one
            `impact <method> depth=3` each. PASS when an oracle test file (the tests the commit added
            or changed) appears in the blast radius. Also reported: gold files named by impact of
            OTHER changed functions (the "if you change this, you must also touch that" signal).

Nothing here runs a model. It measures whether the graph, through these two verbs, names the files
a human's fix and tests touched — the precondition for an agent skipping search.
"""
import json, os, re, subprocess, sys, glob, collections
HERE = os.path.dirname(os.path.abspath(__file__)); AX = os.path.join(HERE, 'scripts', 'axiomcode'); IDX = os.path.join(HERE, 'scripts', 'axiomcode-index')
DOG = os.path.abspath(sys.argv[1]); only = set(sys.argv[2:])
tasks = {t['id']: t for t in json.load(open(os.path.join(DOG, 'tasks.json')))}
PARSER = os.path.join(DOG, '..', '..', 'Parser')

def run(repo, *args):
    r = subprocess.run([sys.executable, AX, *args], cwd=repo, capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_LOGGED='1'))
    return r.stdout
def files_in(out): return set(re.findall(r'(?<![\w/])((?:[\w.-]+/)+[\w.-]+\.(?:ts|tsx|js|mjs|py|java))(?=[:\s,)]|$)', out))

rows = []
for tid, t in sorted(tasks.items()):
    if only and tid not in only: continue
    repos = [d for d in glob.glob(os.path.join(DOG, 'work', tid, '*', 'repo')) if os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite'))]
    if not repos: continue
    repo = repos[0]
    subprocess.run([sys.executable, IDX, repo], capture_output=True)
    gold = set(t['gold_files']); tests = set(t['test_files'])
    # ── search ─────────────────────────────────────────────────────────────────────────────────
    found_by, rank = None, None
    out = run(repo, 'search', re.sub(r'^\w+:\s*', '', t['title']))          # strip the "ts:" / "python:" prefix
    for i, line in enumerate(out.splitlines()):
        if files_in(line) & gold: found_by, rank = 'title', i; break
    idents = [w for w in re.findall(r'`([A-Za-z_][\w.]*)`', t['body'] or '') if len(w) >= 4][:8]
    calls = 1
    if not found_by:
        for w in idents:
            calls += 1; out = run(repo, 'search', w)
            for i, line in enumerate(out.splitlines()):
                if files_in(line) & gold: found_by, rank = f'`{w}`', i; break
            if found_by: break
    # ── impact ─────────────────────────────────────────────────────────────────────────────────
    diff = subprocess.run(['git', 'show', '--format=', '--unified=0', t['sha'], '--', *sorted(gold)], cwd=PARSER, capture_output=True, text=True).stdout
    cur = None; hunks = []
    for line in diff.splitlines():
        if line.startswith('--- a/'): cur = line[6:]
        m = re.match(r'^@@ -(\d+)(?:,(\d+))? ', line)
        if m and cur: hunks.append((cur, int(m.group(1)) + max(0, (int(m.group(2) or 1) - 1) // 2)))
    methods = collections.OrderedDict()
    for f, ln in hunks[:12]:
        out = run(repo, 'search', f'{f}:{ln}')
        m = re.search(r'^(?:method|function|constructor) (\S+)', out, re.M)
        if m: methods.setdefault(m.group(1), f)
    test_hit, cross_hit, impacted = None, set(), 0
    for disp, f in list(methods.items())[:6]:
        out = run(repo, 'impact', disp, 'depth=3'); fs = files_in(out); impacted += 1
        if fs & tests and not test_hit: test_hit = disp
        cross_hit |= (fs & gold) - {f}
    rows.append(dict(id=tid, search=found_by or 'MISS', rank=rank, calls=calls, gold=len(gold), tests=len(tests), methods=len(methods), impact=test_hit or ('MISS' if methods else 'no hunk→method'), cross=len(cross_hit)))
    print(f"{tid:12} search={rows[-1]['search']:<28} rank={str(rank):<5} calls={calls}  | changed methods={len(methods):<2} impact→oracle test={'yes: ' + test_hit if test_hit else rows[-1]['impact']:<50} other gold files named={len(cross_hit)}", flush=True)

n = len(rows)
if n:
    s = sum(1 for r in rows if r['search'] != 'MISS'); s1 = sum(1 for r in rows if r['search'] == 'title')
    im = [r for r in rows if r['methods']]; ih = sum(1 for r in im if not r['impact'].startswith(('MISS', 'no hunk')))
    print(f"\nsearch: gold file named in {s}/{n} tasks ({s1} from the title alone, median calls {sorted(r['calls'] for r in rows)[n//2]})")
    print(f"impact: oracle test file in the blast radius for {ih}/{len(im)} tasks with a changed method; other gold files named in {sum(1 for r in im if r['cross'])}/{len(im)}")
