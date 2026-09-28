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
  named     "nothing named X" for an X an edit newer than the graph wrote says so, names the file and whether a refresh
            runs, also with AXIOMCODE_NO_REFRESH; a name no edit writes, or one the answer found, is not blamed
  engine    a graph built by another engine, other rules or another IMPACT_VERSION is stale with no file changed: the
            answer comes from it at once with a note, and `index` rebuilds it saying why; the same engine, even reinstalled
            elsewhere, with no edit, is current
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
                 files=ax_fresh.snapshot(repo, 'python', repo), built_by=ax_fresh.built_by(ax_fresh.current_engine(repo)))
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
    # the stand-in verb exits VERB_EXIT (a refusal such as "nothing named X" exits 2) until the refresh swaps its graph in
    verb_cmd = [sys.executable, '-c', "import os,sys; s=os.path.exists('swapped'); print(open('swapped').read().strip() if s else sys.argv[1]); "
                "sys.exit(0 if s else int(os.environ.get('VERB_EXIT') or 0))", verb_out]
    e = dict(os.environ, AXIOMCODE_FRESH_WAIT='30')
    for k in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_GRAPH', 'VERB_EXIT'): e.pop(k, None)
    e.update(env or {})
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


# ── engine ────────────────────────────────────────────────────────────────────────────────────────────────────────
def fake_engine(d, rules='rel(1).\n', version='1.0.0'):
    for rel, text in (('bin/axiomcode', '#!/bin/sh\n'), ('graph/python/rules.dl', rules), ('package.json', json.dumps(dict(version=version))),
                      ('parser/dist/index.js', '// parser\n'), ('parser/dist/index.js.map', '{}'), ('graph/test/case.dl', 'x.\n')):
        write(d, rel, text)
    return d


def engine_checks():
    """a graph built by another engine, other rules or another IMPACT_VERSION is stale with no file changed, and says so;
    the same engine, moved or not, with no edit, is current (the near-miss)"""
    work = tempfile.mkdtemp(prefix='axiomcode-engine-'); saved = os.environ.get('AXIOMCODE_ENGINE')
    try:
        e1 = fake_engine(os.path.join(work, 'e1'))
        os.environ['AXIOMCODE_ENGINE'] = e1
        repo = fake_repo(work, 'repo'); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
        tp = os.path.join(repo, '.axiomcode/out/files.json'); table = json.load(open(tp))
        uptodate = lambda: subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'uptodate', repo, 'python', '', ''],
                                          capture_output=True, text=True, env=dict(os.environ))
        by = table['built_by']
        check("engine: the file table records the engine (its version and content hash), the rules and IMPACT_VERSION",
              by.get('engine_version') == '1.0.0' and len(by.get('engine_hash', '')) == 40 and len(by.get('rules', '')) == 40
              and by.get('impact') == ax_fresh.plugin_id()[1] and by['impact'] not in ('', '?'), by)
        u = uptodate()
        check("engine: control: the same engine and no edit is fresh, and `index` finds it up to date",
              ax_fresh.status(repo).get('state') == 'fresh' and u.returncode == 0 and not u.stdout.strip(), (ax_fresh.status(repo), u.stdout))
        # the same bytes in another directory, every mtime new: a reinstall that changed nothing
        e2 = os.path.join(work, 'e2'); time.sleep(0.01); fake_engine(e2); os.environ['AXIOMCODE_ENGINE'] = e2
        check("engine: control: the same engine reinstalled elsewhere (new paths and mtimes, same bytes) is fresh",
              ax_fresh.engine_change(repo) == '' and ax_fresh.status(repo).get('state') == 'fresh', ax_fresh.engine_change(repo))
        check("engine: its test and source-map files are not part of the engine",
              not any(p.endswith(('.map', os.path.join('test', 'case.dl'))) for p in ax_fresh._engine_files(e2)), list(ax_fresh._engine_files(e2)))
        fake_engine(e2, rules='rel(2).\n', version='1.0.1')
        s = ax_fresh.status(repo); n = ax_fresh.note(s); u = uptodate()
        old, new = by['engine_hash'][:8], ax_fresh.engine_id(e2)[1]()[:8]
        check("engine: another engine makes the graph stale with no file changed, and names both",
              s.get('state') == 'stale' and not ax_fresh.edited(s) and s.get('engine') == f"graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new})", s)
        check("engine: the answer's note says it comes from that graph while it is rebuilt",
              n.startswith(f"graph refresh: graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new}); rebuilding in the background"), n)
        check("engine: `index` rebuilds it and says why", u.returncode == 1 and u.stdout.strip() == f"graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new}); rebuilding", u.stdout)
        # the query: an answer at once from the graph it has, unmarked, with the note; the refresh is kicked, not waited for
        driver = os.path.join(work, 'driver.py'); open(driver, 'w').write(DRIVER)
        t0 = time.time()
        r = subprocess.run([sys.executable, driver, SCRIPTS, repo, 'impact', '--', sys.executable, '-c', f"print({ROWS!r})"],
                           capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k not in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_FRESH')})
        check(f"engine: a query answers from the old graph at once ({time.time() - t0:.1f}s), rows unmarked, and says it is rebuilding",
              r.stdout.strip() == ROWS.strip() and 'graph built by an older axiomcode (engine' in r.stderr and 'rebuilding in the background' in r.stderr
              and time.time() - t0 < 10, (r.stdout, r.stderr))
        os.environ['AXIOMCODE_ENGINE'] = e1
        t = dict(table, built_by=dict(by, impact='1')); json.dump(t, open(tp, 'w'))
        check("engine: another IMPACT_VERSION makes it stale, named as such",
              ax_fresh.engine_change(repo) == f"graph built by an older axiomcode (IMPACT_VERSION 1 -> {by['impact']})", ax_fresh.engine_change(repo))
        t = dict(table, built_by=dict(by, rules='f' * 40)); json.dump(t, open(tp, 'w'))
        check("engine: other query rules make it stale", ax_fresh.engine_change(repo).startswith('graph built by an older axiomcode (rules ffffffff -> '), ax_fresh.engine_change(repo))
        t = dict(table); t.pop('built_by'); json.dump(t, open(tp, 'w'))
        check("engine: a table that does not say what built it (every graph from before this) is stale",
              ax_fresh.engine_change(repo).startswith('graph built by an older axiomcode (one that did not record its engine -> 1.0.0 '), ax_fresh.engine_change(repo))
        json.dump(table, open(tp, 'w'))
        check("engine: control: put back, it is fresh again", ax_fresh.status(repo).get('state') == 'fresh', ax_fresh.status(repo))
        c = [[], [], []]; st = dict(failed_table=ax_fresh.change_key(c), failed_engine='graph built by an older axiomcode (engine a -> b)')
        check("engine: a rebuild that failed on a difference is not retried for it, but is for another one, or for another edit",
              ax_fresh.failed_on(st, c, st['failed_engine']) and not ax_fresh.failed_on(st, c, 'graph built by an older axiomcode (engine a -> c)')
              and not ax_fresh.failed_on(st, [['x.py'], [], []], st['failed_engine']))
        e = dict(os.environ, AXIOMCODE_ENGINE=e2, AXIOMCODE_NO_ENGINE_CHECK='1'); os.environ.update(e)
        check("engine: AXIOMCODE_NO_ENGINE_CHECK=1 turns the check off", ax_fresh.engine_change(repo) == '')
    finally:
        os.environ.pop('AXIOMCODE_NO_ENGINE_CHECK', None)
        if saved is None: os.environ.pop('AXIOMCODE_ENGINE', None)
        else: os.environ['AXIOMCODE_ENGINE'] = saved
        shutil.rmtree(work, ignore_errors=True)


# ── named ─────────────────────────────────────────────────────────────────────────────────────────────────────────
NOT_FOUND = "nothing named 'audit' in the graph, and nothing close to it."


def named_checks():
    """a "nothing named X" for an X an edit newer than the graph wrote says the graph is stale, names the file, and says
    whether a refresh is running — including when the refresher is switched off. Each with a control that stays quiet"""
    work = tempfile.mkdtemp(prefix='axiomcode-named-')
    try:
        # the gap as it was met: AXIOMCODE_NO_REFRESH set, the answer came back bare, as if audit did not exist
        out, err, took = ask(fake_repo(work, 'off'), NOT_FOUND, env=dict(AXIOMCODE_NO_REFRESH='1', VERB_EXIT='2'), args=('audit',))
        check(f"named: refresh OFF — a name an edit added says the graph predates that edit and that no refresh runs ({took:.1f}s)",
              out.strip() == NOT_FOUND and took < 1.5 and 'graph refresh: OFF' in err and 'predates edits to shop/api.py' in err
              and "'audit' is written in shop/api.py" in err and '`axiomcode index` rebuilds it' in err, (out, err))
        # a refresh too long to wait for: the note already said "queued"; it now also says why nothing was found
        out, err, took = ask(fake_repo(work, 'queued', build_seconds='300 0'), NOT_FOUND, env=dict(VERB_EXIT='2'), args=('audit',))
        check(f"named: refresh queued — the note names the edited file that writes the name ({took:.1f}s)",
              took < 1.5 and 'graph refresh: queued' in err and "'audit' is written in shop/api.py" in err, (out, err))
        # --json carries it as data
        out, err, took = ask(fake_repo(work, 'json', build_seconds='300 0'), json.dumps(dict(error=NOT_FOUND)),
                             env=dict(VERB_EXIT='2'), args=('audit', '--json'))
        fr = (json.loads(out) if out.strip().startswith('{') else {}).get('freshness', {})
        check("named: --json says named_in_edits",
              fr.get('named_in_edits') == [dict(name='audit', file='shop/api.py')] and fr.get('state') == 'stale', (out, err))
        # CONTROL: a name that no edit writes, refresh off — the graph is still said to be stale, but no name is blamed
        out, err, took = ask(fake_repo(work, 'ghost'), "nothing named 'ghost' in the graph, and nothing close to it.",
                             env=dict(AXIOMCODE_NO_REFRESH='1', VERB_EXIT='2'), args=('ghost',))
        check("named: control — a name no edit writes gets the stale note but no 'is written in'",
              'graph refresh: OFF' in err and 'is written in' not in err, (out, err))
        # CONTROL: `path audit total` with only audit missing blames audit, not total (which the edited file also writes)
        out, err, took = ask(fake_repo(work, 'path', build_seconds='300 0'), NOT_FOUND, env=dict(VERB_EXIT='2'), verb='path',
                             args=('audit', 'total'))
        check("named: control — path with one endpoint missing names only that one",
              "'audit' is written in shop/api.py" in err and "'total' is written" not in err, (out, err))
        # CONTROL: a name found in the graph that the edited file also writes: the answer found it, nothing to explain
        out, err, took = ask(fake_repo(work, 'found', build_seconds='300 0'), ROWS, args=('run',))
        check("named: control — a name the answer found says nothing about where it is written",
              'graph refresh: queued' in err and 'is written in' not in err, (out, err))
        # CONTROL: refresh off over a graph that matches the files: no mark, no note, as before
        repo = fake_repo(work, 'offcurrent'); driver = os.path.join(work, 'driver.py')
        r = subprocess.run([sys.executable, driver, SCRIPTS, repo, 'impact', '--', sys.executable, '-c', f"print({ROWS!r})"],
                           capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_NO_REFRESH='1'))
        check("named: control — refresh off over a current graph answers with no mark and no note",
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
    prune_checks(); marks_checks(); wait_checks(); engine_checks(); named_checks(); mcp_checks()
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)} of {len(RESULTS)} passed" + (f"; FAILED: {len(bad)}" if bad else ''))
    sys.exit(1 if bad or not RESULTS else 0)
