#!/usr/bin/env python3
"""mutants.py <lang> <repo> [--n N] [--seed S] [--cmd "<test command>"] — behavioural truth for the upstream answer.

Break one method at a time (a throw at the top of its body), run the whole suite, and record which test FILES then
fail that did not fail before. That set is the truth `upstream.py` is scored against: it owes nothing to the graph,
so a fix cannot be tuned into it. Nothing is predicted here.

Writes <repo>/.axiomcode/mutation.json: [{method, file, truth: [test files]}]. Java, Python, TypeScript, JavaScript.
"""
import glob, json, os, random, re, shutil, sqlite3, subprocess, sys, time
import xml.etree.ElementTree as ET
lang, repo = sys.argv[1], os.path.abspath(sys.argv[2])
arg = lambda f, d: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d
N = int(arg('--n', 12)); seed = int(arg('--seed', 1)); out = arg('--out', f'{repo}/.axiomcode/mutation.json')
CMD = arg('--cmd', None)
con = sqlite3.connect(f'{repo}/.axiomcode/out/graph.sqlite'); con.row_factory = sqlite3.Row
os.chdir(repo)
THROW = {'java': 'if (true) throw new RuntimeException("AXMUT");', 'typescript': 'if (1 > 0) throw new Error("AXMUT");',
         'javascript': 'if (1 > 0) throw new Error("AXMUT");', 'python': 'raise RuntimeError("AXMUT")'}[lang]
KNOWN = {r[0] for r in con.execute("SELECT DISTINCT file FROM symbols WHERE is_test = 1")}
def run_suite(tag):
    rep = f'.axiomcode/mut-{tag}'
    if lang == 'java':
        shutil.rmtree('target/surefire-reports', ignore_errors=True)
        subprocess.run(CMD or 'mvn -q -o test -Dsurefire.failIfNoTests=false', shell=True, capture_output=True)
        failed, ran = set(), set()
        cls2file = {r['file'].split('/')[-1][:-5]: r['file'] for r in con.execute("SELECT DISTINCT file FROM symbols WHERE is_test = 1 AND file LIKE 'src/test/%'")}
        for x in glob.glob('target/surefire-reports/TEST-*.xml'):
            for tc in ET.parse(x).getroot().iter('testcase'):
                f = cls2file.get((tc.get('classname') or '').split('.')[-1].split('$')[0])
                if not f: continue
                ran.add(f)
                if tc.find('failure') is not None or tc.find('error') is not None: failed.add(f)
        return failed, ran
    cmd = CMD or (f'pytest -q -p no:cacheprovider --continue-on-collection-errors --junitxml={rep}.xml' if lang == 'python'
                  else f'npx vitest run --reporter=junit --outputFile={rep}.xml')
    root = None
    for attempt in range(2):                                   # a runner that wrote no report (a crash, a collision) is retried once
        if os.path.exists(f'{rep}.xml'): os.remove(f'{rep}.xml')
        subprocess.run(cmd.replace('{report}', f'{rep}.xml'), shell=True, capture_output=True)
        try:
            root = ET.parse(f'{rep}.xml').getroot(); break
        except Exception: root = None
    failed, ran = set(), set()
    if root is not None:
        for tc in root.iter('testcase'):
            f = tc.get('file') or tc.get('classname', '')
            if lang == 'python':
                parts = f.split('.'); f = next(('/'.join(parts[:k]) + '.py' for k in range(len(parts), 0, -1) if '/'.join(parts[:k]) + '.py' in KNOWN), f)
            f = os.path.relpath(f, repo) if os.path.isabs(f) else f
            ran.add(f)
            if tc.find('failure') is not None or tc.find('error') is not None: failed.add(f)
    return failed, ran
def insert_throw(sym):
    lines = open(sym['file']).read().split('\n'); i = sym['line'] - 1
    if lang == 'python':
        j = i
        while j < len(lines) and not lines[j].rstrip().endswith(':'): j += 1
        k = j + 1
        while k < len(lines) and not lines[k].strip(): k += 1
        if k >= len(lines): return None
        lines.insert(k, re.match(r'\s*', lines[k]).group(0) + THROW)
    else:
        j = i
        while j < len(lines) and '{' not in lines[j]:
            j += 1
            if j > (sym['end_line'] or 0) - 1 or (j and ';' in lines[j - 1]): return None
        if j >= len(lines): return None
        lines.insert(j + 1, THROW)
    return '\n'.join(lines)
SRC = {'java': 'src/main/', 'python': '', 'typescript': 'src/', 'javascript': 'src/'}[lang]
rows = [r for r in con.execute("""SELECT display, file, line, end_line, name FROM symbols WHERE method_id IS NOT NULL AND is_test = 0
        AND kind IN ('method', 'function') AND end_line - line >= 2 AND name NOT LIKE '<%'""")
        if (r['file'] or '').startswith(SRC) and '.test.' not in r['file'] and '.spec.' not in r['file'] and not r['file'].startswith('tests/')]
random.seed(seed); random.shuffle(rows)
print(f'{len(rows)} candidate methods; baseline run …', flush=True)
t0 = time.time(); base_failed, base_ran = run_suite('base')
print(f'baseline: {len(base_ran)} test files ran, {len(base_failed)} already failing, {time.time() - t0:.0f}s', flush=True)
if not base_ran: sys.exit("the suite ran no test file: give the command with --cmd")
res = []
for r in rows:
    if len(res) >= N: break
    src = open(r['file']).read(); mut = insert_throw(r)
    if mut is None: continue
    open(r['file'], 'w').write(mut)
    try: failed, ran = run_suite('mut')
    finally: open(r['file'], 'w').write(src)
    if not ran: print(f'  {r["display"]}: the suite did not run (a compile error?) — skipped', flush=True); continue
    truth = {f for f in (failed - base_failed) & base_ran if f in KNOWN}
    res.append(dict(method=r['display'], file=r['file'], truth=sorted(truth)))
    print(f'  {r["display"][:52]:54} {len(truth):3} test file(s) fail', flush=True)
json.dump(res, open(out, 'w'), indent=1)
print(f'\n{len(res)} mutants, {sum(1 for x in res if x["truth"])} with a non-empty truth set, {time.time() - t0:.0f}s → {out}')
