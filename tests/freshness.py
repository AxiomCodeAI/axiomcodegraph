#!/usr/bin/env python3
"""tests/freshness.py: an answer from a graph older than an edit says exactly what is stale, and waits only when it pays.

A query never blocks on a refresh by default (#1595): it answers from the last good graph, marks every row that lies in
a file edited since, and waits only when the answer touches such a file and the refresh is expected within a small
budget. And the refresher watches every file the parser reads, so no edit leaves the graph stale unseen (#1594).

  prune     the directories the file table prunes are the ones each language's parser skips, read from the parser's
            own constants; an edit under out/, build/, target/ or coverage/ is watched where that parser reads it, and
            a directory the parser skips is not
  marks     a row in an edited file is marked "(may be out of date)" in text and "stale": true in --json; a row in an
            untouched file, a quoted line of code and the next: line are not; a same-named file in another
            directory is not taken for the edited one
  wait      the decision, each with its control: an answer touching an edited file waits for a refresh expected within
            the budget and answers from the new graph; it does not wait when the last build says it will take longer,
            when the running build is compiling rules, or when the answer touches no edited file
  fresh     --fresh waits whatever the estimate, with progress on stderr, and answers unmarked; a current graph is
            answered with no mark and no note
  mcp       the MCP tools take fresh=true and pass --fresh, and the CLI's --fresh is written fresh=True in an answer

No engine: the wait checks drive `ax_fresh.py query` with a stand-in verb, and a stand-in refresh that brings the file
table up to date after two seconds, the way a real one swaps in its graph.

    python3 tests/freshness.py [-v]
"""
import importlib.util, json, os, re, shutil, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
PARSER = os.path.join(ROOT, 'parser', 'src')
sys.path.insert(0, SCRIPTS)
import ax_fresh

RESULTS = []
VERBOSE = '-v' in sys.argv


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok and not VERBOSE else f"\n     {str(detail)[:1200]}" if detail != '' else ''))


def write(root, rel, text='x\n'):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(text)


# ── prune ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def ts_list(rel, name):
    """the string literals of `name`'s array or Set in a parser source file"""
    text = open(os.path.join(PARSER, rel)).read()
    m = re.search(re.escape(name) + r'\s*=\s*(?:new Set\()?\[(.*?)\]', text, re.S)
    return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()


def prune_checks():
    parser = {
        # the Java walk skips `build` only beside a Gradle build script (isGradleBuildOutput), never by name
        'java': ts_list('constants/consts.ts', 'EXCLUDED_DIRS') - {'build'},
        'typescript': ts_list('constants/typescript-constants.ts', 'TS_SKIP_DIRECTORIES'),
        'javascript': ts_list('constants/javascript-constants.ts', 'JS_SKIP_DIRECTORIES'),
        'python': ts_list('workflows/python/python-project-analyzer.ts', 'DEFAULT_EXCLUDES'),
        'csharp': ts_list('workflows/csharp/csharp-project-analyzer.ts', 'DEFAULT_EXCLUDES'),
    }
    for lang, names in parser.items():
        check(f"prune: {lang} prunes exactly the directories its parser skips ({len(names)} names read from the parser)",
              len(names) >= 5 and set(ax_fresh.SKIP[lang]) == names, sorted(set(ax_fresh.SKIP[lang]) ^ names))
    work = tempfile.mkdtemp(prefix='axiomcode-prune-')
    try:
        tree = {
            'python': ['app/out/calc.py', 'app/build/calc.py', 'target/t.py', 'coverage/c.py', 'build/lib/gen.py',
                       'build/frontend.py', '.venv/v.py', 'pkg.egg-info/e.py', 'dist/d.py', 'app/ok.py'],
            'java': ['src/main/java/app/coverage/Calc.java', 'src/main/java/app/Ok.java', 'out/O.java', 'target/T.java',
                     'build/B.java', '.hidden/H.java', 'src/main/java/app/build/StepBuilder.java',
                     'mod/build.gradle.kts', 'mod/build/generated/sources/annotationProcessor/java/main/app/Gen.java',
                     'mod/src/main/java/app/build/Step.java'],
            'csharp': ['src/Shop/build/Calc.cs', 'src/Shop/out/O.cs', 'target/T.cs', 'coverage/C.cs', 'src/Shop/Ok.cs',
                       'src/Shop/obj/G.cs', 'bin/B.cs', 'packages/P.cs'],
        }
        read = {  # what the parser reads (True) or skips (False), by its own lists
            'python': [True, True, True, True, False, True, False, False, False, True],
            # a `build` package is read; only a Gradle module's build/ (beside mod/build.gradle.kts, itself watched) is skipped
            'java': [True, True, False, False, True, False, True, True, False, True],
            'csharp': [True, True, True, True, True, False, False, False],
        }
        for lang, files in tree.items():
            root = os.path.join(work, lang)
            for f in files: write(root, f)
            got = {os.path.relpath(p, root) for p in ax_fresh.watched(root, lang)}
            want = {f for f, r in zip(files, read[lang]) if r}
            check(f"prune: {lang} watches every file its parser reads under out/build/target/coverage, and none it skips",
                  got == want, f"missing {sorted(want - got)} extra {sorted(got - want)}")
        # the control that makes the above mean something: a directory a language's parser skips stays pruned
        check("prune: a node_modules or .axiomcode directory is pruned for every language",
              all(ax_fresh.prunes(l, 'node_modules') and ax_fresh.prunes(l, '.axiomcode') for l in ax_fresh.SKIP))
        # the file table sees an edit there: the whole point of #1594
        root = os.path.join(work, 'python')
        table = dict(lang='python', src='', files=ax_fresh.snapshot(root, 'python', root))
        open(os.path.join(root, 'app/out/calc.py'), 'a').write('\ndef audit():\n    return 3\n')
        c = ax_fresh.changes(root, table)
        check("prune: an edit under app/out/ makes the graph stale", c and c[0] == ['app/out/calc.py'], c)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── marks ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ANSWER = """change: OrderService.total   [method]
reads or uses it (3 callable(s)):
    [resolved] report   shop/report.py:5   - calls it
    [resolved] run   shop/api.py:5   - calls it
    [resolved] other   other/api.py:7   - calls it
    source files (2, nearest first): shop/report.py (1), shop/api.py (1)
      12 | x = run(shop/api.py:5)
next: read shop/orders.py:2, then only these place(s) bound to it: shop/api.py:5, shop/report.py:5"""


def marks_checks():
    stale = ax_fresh.Stale(['shop/api.py'])
    text, n, touched = ax_fresh.mark_answer(ANSWER, stale, False)
    lines = text.split('\n')
    marked = [l for l in lines if l.endswith(ax_fresh.MARK)]
    check("marks: the row in the edited file is marked, and the line listing it", n == 2 and touched and
          any('run   shop/api.py:5' in l for l in marked) and any('source files' in l for l in marked), text)
    check("marks: a row in an untouched file, a same-named file elsewhere, a quoted code line and next: are not",
          not any(k in l for l in marked for k in ('report   shop', 'other/api.py', '12 |', 'next:')), text)
    none = ax_fresh.mark_answer(ANSWER, ax_fresh.Stale(['shop/orders_test.py']), False)
    check("marks: an edit to a file the answer never names marks nothing and does not count as touching it",
          none[1] == 0 and not none[2] and ax_fresh.MARK not in none[0], none)
    j = dict(direct=[dict(display='run', at='shop/api.py:5'), dict(display='report', at='shop/report.py:5')],
             answers=[dict(hops=[dict(declared_at='shop/orders.py:2', call_at='shop/api.py:5')])],
             files=[dict(file='shop/api.py'), dict(file='shop/report.py')], prose=['    run   shop/api.py:5'])
    out, n, touched = ax_fresh.mark_answer(json.dumps(j), stale, True)
    o = json.loads(out)
    check("marks: --json rows in the edited file carry \"stale\": true, the others none, prose is marked",
          [r.get('stale') for r in o['direct']] == [True, None] and o['answers'][0]['hops'][0].get('stale') is True
          and [r.get('stale') for r in o['files']] == [True, None] and o['prose'][0].endswith(ax_fresh.MARK) and n == 3, out)


# ── wait / fresh ──────────────────────────────────────────────────────────────────────────────────────────────────
DRIVER = r"""
import os, sys
sys.path.insert(0, sys.argv[1]); import ax_fresh
ax_fresh.kick = lambda *a, **k: True                     # the stand-in refresh is the test's own thread
sys.exit(ax_fresh.query(os.path.realpath(sys.argv[2]), sys.argv[3], sys.argv[5:], fresh=bool(os.environ.get('AXIOMCODE_FRESH'))))
"""


def fake_repo(work, name, build_seconds='3 0', log=''):
    repo = os.path.join(work, name)
    write(repo, 'shop/api.py', 'def run(items):\n    return total(items)\n')
    write(repo, 'shop/report.py', 'def report(items):\n    return total(items)\n')
    write(repo, '.axiomcode/out/graph.sqlite', '')
    table = dict(lang='python', lang_auto=False, src='', src_arg='', library='', built=time.time(),
                 files=ax_fresh.snapshot(repo, 'python', repo))
    json.dump(table, open(os.path.join(repo, '.axiomcode/out/files.json'), 'w'))
    if build_seconds: write(repo, '.axiomcode/out/build-seconds', build_seconds + '\n')
    json.dump(dict(state='building', started=time.time()), open(os.path.join(repo, '.axiomcode/refresh.json'), 'w'))
    if log: write(repo, '.axiomcode/build.log', log)
    return repo


def ask(repo, verb_out, after=None, env=None, verb='impact', args=('OrderService.total',)):
    """run `ax_fresh.py query` over a stand-in verb that prints verb_out; `after` seconds in, the stand-in refresh
    brings the file table up to date. Returns (stdout, stderr, seconds)"""
    driver = os.path.join(os.path.dirname(repo), 'driver.py'); open(driver, 'w').write(DRIVER)
    edit = os.path.join(repo, 'shop/api.py'); open(edit, 'a').write('\ndef audit(items):\n    return total(items)\n')
    def refresh():
        time.sleep(after)
        t = json.load(open(os.path.join(repo, '.axiomcode/out/files.json')))
        t['files'] = ax_fresh.snapshot(repo, 'python', repo)
        json.dump(t, open(os.path.join(repo, '.axiomcode/out/files.json'), 'w'))
        open(os.path.join(repo, 'swapped'), 'w').write('new graph\n')
    th = threading.Thread(target=refresh) if after is not None else None
    if th: th.start()
    verb_cmd = [sys.executable, '-c', "import os,sys; print(open('swapped').read().strip() if os.path.exists('swapped') else sys.argv[1])", verb_out]
    e = dict(os.environ, AXIOMCODE_FRESH_WAIT='30', **(env or {}))
    for k in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_GRAPH'): e.pop(k, None)
    if 'AXIOMCODE_FRESH' not in (env or {}): e.pop('AXIOMCODE_FRESH', None)
    t0 = time.time()
    r = subprocess.run([sys.executable, driver, SCRIPTS, repo, verb, '--', *verb_cmd, *args, repo], cwd=repo,
                       capture_output=True, text=True, env=e, timeout=120)
    took = time.time() - t0
    if th: th.join()
    return r.stdout, r.stderr, took


ROWS = "    [resolved] run   shop/api.py:5   - calls it\n    [resolved] report   shop/report.py:5   - calls it"


def wait_checks():
    work = tempfile.mkdtemp(prefix='axiomcode-fresh-')
    try:
        out, err, took = ask(fake_repo(work, 'soon'), ROWS, after=2)
        check(f"wait: an answer touching an edited file waits for a refresh expected within the budget ({took:.1f}s), "
              "and answers from the new graph", out.strip() == 'new graph' and 1.5 < took < 20 and 'graph refresh:' not in err
              and 'waiting for the graph to refresh' in err, (out, err))
        out, err, took = ask(fake_repo(work, 'long', build_seconds='300 0'), ROWS, after=2)
        check(f"wait: it does not wait when the last build says the refresh takes longer than the budget ({took:.1f}s)",
              took < 1.5 and 'run   shop/api.py:5   - calls it' + ax_fresh.MARK in out and 'report   shop/report.py:5   - calls it\n' in out + '\n'
              and '1 row(s) lie in those files' in err, (out, err))
        out, err, took = ask(fake_repo(work, 'compile', log='▶ compiling souffle program (cache miss)...\n'), ROWS, after=2)
        check(f"wait: it never waits on a build that is compiling the engine's rules ({took:.1f}s)",
              took < 1.5 and ax_fresh.MARK in out, (out, err))
        out, err, took = ask(fake_repo(work, 'untouched'), "    [resolved] report   shop/report.py:5   - calls it", after=2,
                             args=('report',))
        check(f"wait: it does not wait when neither the answer nor the name asked about touches an edited file ({took:.1f}s)",
              took < 1.5 and ax_fresh.MARK not in out and 'no row of this answer lies in those files' in err, (out, err))
        out, err, took = ask(fake_repo(work, 'named'), "no declaration named audit", after=2, args=('audit',))
        check(f"wait: a name that is written only in an edited file (a declaration just added) waits ({took:.1f}s)",
              out.strip() == 'new graph' and 1.5 < took < 20, (out, err))
        out, err, took = ask(fake_repo(work, 'fresh', build_seconds='300 0'), ROWS, after=2, env=dict(AXIOMCODE_FRESH='1'))
        check(f"fresh: --fresh waits whatever the estimate, says so, and answers from the new graph ({took:.1f}s)",
              out.strip() == 'new graph' and 1.5 < took < 20 and '(--fresh)' in err and 'graph refresh:' not in err, (out, err))
        repo = fake_repo(work, 'current'); driver = os.path.join(work, 'driver.py')
        r = subprocess.run([sys.executable, driver, SCRIPTS, repo, 'impact', '--', sys.executable, '-c', f"print({ROWS!r})"],
                           capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != 'AXIOMCODE_NO_REFRESH'})
        check("fresh: a graph that matches the files answers with no mark and no note",
              r.stdout.strip() == ROWS.strip() and not r.stderr.strip(), (r.stdout, r.stderr))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── mcp ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def mcp_checks():
    spec = importlib.util.spec_from_file_location('axiomcode_mcp_server', os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py'))
    m = importlib.util.module_from_spec(spec)
    import io, contextlib
    with contextlib.redirect_stderr(io.StringIO()): spec.loader.exec_module(m)
    check("mcp: context, path and impact take fresh", all('fresh' in m.PARAMS.get(t, []) for t in ('axiomcode_context', 'axiomcode_path', 'axiomcode_impact')),
          {t: m.PARAMS.get(t) for t in ('axiomcode_context', 'axiomcode_path', 'axiomcode_impact')})
    seen = []
    m.run = lambda args, *a, **k: seen.append(args) or ''
    fn = lambda name: getattr(m, name)
    try:
        fn('axiomcode_impact')(['X'], repo='.', fresh=True); fn('axiomcode_path')('A', 'B', fresh=True); fn('axiomcode_context')('t', fresh=True)
        fn('axiomcode_impact')(['X'], repo='.')
    except TypeError as e:
        seen.append(str(e))
    check("mcp: fresh=true passes --fresh to the CLI, and only when asked",
          len(seen) == 4 and all('--fresh' in s for s in seen[:3]) and '--fresh' not in seen[3], seen)
    check("mcp: an answer's --fresh is written as the parameter", 'fresh=True' in m.mcp_words('ask again with --fresh to wait'),
          m.mcp_words('ask again with --fresh to wait'))


if __name__ == '__main__':
    prune_checks(); marks_checks(); wait_checks(); mcp_checks()
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)} of {len(RESULTS)} passed" + (f"; FAILED: {len(bad)}" if bad else ''))
    sys.exit(1 if bad or not RESULTS else 0)
