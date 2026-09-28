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
  engine    a graph built by another engine or another axiomcode-index is stale with no file changed: the answer comes
            from it at once with a note, and `index` rebuilds it saying why; the same engine, even reinstalled elsewhere,
            with no edit, is current
  per-lang  only what shapes the graph's own languages counts: another language's rules or parser, a version-only bump,
            the query rules or IMPACT_VERSION leave it current (IMPACT_VERSION re-exports its facts, no rebuild); its
            own rules or parser, or a shared pipeline or bundle file, make it stale. A table from before the
            per-language key is compared the way it was recorded
  cap       at most AXIOMCODE_REFRESH_MAX background rebuilds run at once on the machine: a third waits while two run,
            and runs once one ends (queued, never dropped); control: with room for three, none waits
  lock      the engine compile lock is taken over when its owner process is dead, never while it lives, however old
  newer     a graph a NEWER axiomcode built (higher IMPACT_VERSION, or a later engine) is never rebuilt by this older one,
            by the refresher or by `index`, edited or not; answers come from it at once and say so. The near-miss: an
            OLDER build is still stale and rebuilt
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
        # SINGLE-FILE COMPONENTS (#1744): an edit to a .vue / .svelte / .astro file makes a JavaScript or TypeScript graph
        # stale, and a new one is an added file. The control: a template, a stylesheet or a doc beside them stays unwatched,
        # and a component alone does not make a repository count as JavaScript or TypeScript
        for lang in ('javascript', 'typescript'):
            root = os.path.join(work, 'sfc-' + lang)
            for f, body in (('src/lib.js', 'export function lazyHelper() {}\nexport function newHelper() {}\n'),
                            ('src/views/Home.vue', "<script setup>import { lazyHelper } from '../lib.js';</script>\n"
                                                   "<template><span>{{ lazyHelper() }}</span></template>\n"),
                            ('src/List.svelte', '<script>let n = 1;</script>\n'), ('src/pages/index.astro', '---\n---\n'),
                            ('src/index.html', '<div></div>\n'), ('src/app.css', 'a {}\n'), ('README.md', '# x\n')):
                write(root, f, body)
            got = {os.path.relpath(p, root) for p in ax_fresh.watched(root, lang)}
            check(f"prune: {lang} watches .vue, .svelte and .astro components, not the .html, .css or .md beside them",
                  got == {'src/lib.js', 'src/views/Home.vue', 'src/List.svelte', 'src/pages/index.astro'}, sorted(got))
            table = dict(lang=lang, lang_auto=True, src='', files=ax_fresh.snapshot(root, lang, root))
            with open(os.path.join(root, 'src/views/Home.vue'), 'w') as fh:
                fh.write("<script setup>import { lazyHelper, newHelper } from '../lib.js';</script>\n"
                         "<template><span>{{ lazyHelper() }}{{ newHelper() }}</span></template>\n")
            write(root, 'src/views/About.vue', '<template><p></p></template>\n')
            write(root, 'src/index.html', '<div>changed</div>\n')
            c = ax_fresh.changes(root, table)
            check(f"prune: {lang}: an edited .vue makes the graph stale and a new one is added; an edited .html does neither",
                  c == (['src/views/Home.vue'], ['src/views/About.vue'], []), c)
        only = os.path.join(work, 'sfc-only')
        write(only, 'src/App.vue', '<script>export default {}</script>\n')
        n = {l: sum(1 for p in ax_fresh.watched(only, l) if p.endswith(ax_fresh.SOURCE[l])) for l in ('javascript', 'typescript')}
        check("prune: a repository of .vue files alone counts no JavaScript or TypeScript source", n == {'javascript': 0, 'typescript': 0}, n)
        # EXTENSION CASE (#1771): the JavaScript parser reads Main.JS and Up.VUE and the C# parser reads Calc.CS, so an edit
        # to one makes the graph stale and they count as source. The control: the TypeScript, Python and Java parsers match
        # an extension exactly, so Main.TS, calc.PY and Calc.JAVA stay unwatched and uncounted
        upper = os.path.join(work, 'upper')
        for f in ('src/lib.js', 'src/Main.JS', 'src/views/Up.VUE', 'src/Old.Mjs', 'src/Main.TS', 'src/calc.PY',
                  'src/Calc.JAVA', 'src/Calc.CS'):
            write(upper, f, 'x\n')
        want = {'javascript': {'src/lib.js', 'src/Main.JS', 'src/views/Up.VUE', 'src/Old.Mjs'}, 'typescript': {'src/lib.js'},
                'python': set(), 'java': set(), 'csharp': {'src/Calc.CS'}}
        for lang, files in want.items():
            got = {os.path.relpath(p, upper) for p in ax_fresh.watched(upper, lang)}
            check(f"prune: {lang} watches an upper-case extension exactly when its parser reads one", got == files, sorted(got))
        table = dict(lang='javascript', lang_auto=True, src='', files=ax_fresh.snapshot(upper, 'javascript', upper))
        write(upper, 'src/Main.JS', 'third();\n'); write(upper, 'src/views/Up.VUE', 'third();\n'); write(upper, 'src/Main.TS', 'y\n')
        c = ax_fresh.changes(upper, table)
        check("prune: javascript: an edit to Main.JS or Up.VUE makes the graph stale; one to Main.TS does not",
              c == (['src/Main.JS', 'src/views/Up.VUE'], [], []), c)
        n = {l: sum(1 for p in ax_fresh.watched(upper, l) if ax_fresh.has_ext(l, os.path.basename(p), ax_fresh.SOURCE[l]))
             for l in ax_fresh.SOURCE}
        check("prune: Main.JS and Calc.CS count as source; Main.TS, calc.PY, Calc.JAVA and Up.VUE do not",
              n == {'java': 0, 'typescript': 0, 'python': 0, 'javascript': 3, 'csharp': 1}, n)
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
                 files=ax_fresh.snapshot(repo, 'python', repo), built_by=ax_fresh.built_by(ax_fresh.current_engine(repo), 'python'))
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
def fake_engine(d, rules='rel(1).\n', version='1.0.0', java='jrel(1).\n', parser_java='// java parser\n', parser_py='// python parser\n',
                pipeline='# run\n', bundle='// bundle\n'):
    for rel, text in (('bin/axiomcode', '#!/bin/sh\n'), ('graph/python/rules.dl', rules), ('package.json', json.dumps(dict(version=version, name='e'))),
                      ('parser/dist/index.js', '// parser\n'), ('parser/dist/index.js.map', '{}'), ('graph/test/case.dl', 'x.\n'),
                      ('graph/java/rules.dl', java), ('graph/csharp/rules.dl', 'crel(1).\n'), ('graph/pipeline/run-souffle.sh', pipeline),
                      ('dist/bundle/write.js', bundle), ('parser/dist/parsers/java/java-parser.js', parser_java),
                      ('parser/dist/parsers/python/python-parser.js', parser_py), ('parser/dist/language-detectors/java-detector.js', parser_java),
                      ('parser/dist/constants/python-constants.js', parser_py)):
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
        check("engine: the file table records the engine (its version, and a content hash over the python graph's files), "
              "axiomcode-index and IMPACT_VERSION",
              by.get('engine_version') == '1.0.0' and len(by.get('engine_hash', '')) == 40 and by.get('engine_langs') == ['python']
              and len(by.get('index', '')) == 40 and by.get('impact') == ax_fresh.plugin_id()[1] and by['impact'] not in ('', '?'), by)
        u = uptodate()
        check("engine: control: the same engine and no edit is fresh, and `index` finds it up to date",
              ax_fresh.status(repo).get('state') == 'fresh' and u.returncode == 0 and not u.stdout.strip(), (ax_fresh.status(repo), u.stdout))
        # the same bytes in another directory, every mtime new: a reinstall that changed nothing
        e2 = os.path.join(work, 'e2'); time.sleep(0.01); fake_engine(e2); os.environ['AXIOMCODE_ENGINE'] = e2
        check("engine: control: the same engine reinstalled elsewhere (new paths and mtimes, same bytes) is fresh",
              ax_fresh.engine_change(repo) == '' and ax_fresh.status(repo).get('state') == 'fresh', ax_fresh.engine_change(repo))
        check("engine: its test and source-map files are not part of the engine",
              not any(p.endswith(('.map', os.path.join('test', 'case.dl'))) for p in ax_fresh._engine_files(e2)), list(ax_fresh._engine_files(e2)))
        py = sorted(os.path.relpath(p, e2).replace(os.sep, '/') for p in ax_fresh._engine_files(e2, ['python']))
        check("per-lang: a python graph's engine files are python's and the shared ones, never another language's",
              'graph/python/rules.dl' in py and 'parser/dist/parsers/python/python-parser.js' in py and 'parser/dist/constants/python-constants.js' in py
              and 'graph/pipeline/run-souffle.sh' in py and 'dist/bundle/write.js' in py and 'parser/dist/index.js' in py
              and not any(x.startswith(('graph/java/', 'graph/csharp/', 'parser/dist/parsers/java/')) or 'java-detector' in x for x in py), py)
        fake_engine(e2, rules='rel(2).\n', version='1.0.1')
        s = ax_fresh.status(repo); n = ax_fresh.note(s); u = uptodate()
        old, new = by['engine_hash'][:8], ax_fresh.engine_id(e2, ['python'])[1]()[:8]
        check("engine: another engine makes the graph stale with no file changed, and names both",
              s.get('state') == 'stale' and not ax_fresh.edited(s) and s.get('engine') == f"graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new} (python))", s)
        check("engine: the answer's note says it comes from that graph while it is rebuilt",
              n.startswith(f"graph refresh: graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new} (python)); rebuilding in the background"), n)
        check("engine: `index` rebuilds it and says why", u.returncode == 1 and u.stdout.strip() == f"graph built by an older axiomcode (engine 1.0.0 {old} -> 1.0.1 {new} (python)); rebuilding", u.stdout)
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
        check("per-lang: another IMPACT_VERSION leaves the graph current (no rebuild) and asks for its facts to be exported again",
              ax_fresh.engine_change(repo) == '' and ax_fresh.status(repo).get('state') == 'fresh' and ax_fresh.export_behind(t) == '1',
              (ax_fresh.engine_change(repo), ax_fresh.export_behind(t)))
        t = dict(table, built_by=dict(by, rules='f' * 40)); json.dump(t, open(tp, 'w'))
        check("per-lang: other query rules (dl/*.dl, compiled apart, never written into the graph) leave it current",
              ax_fresh.engine_change(repo) == '', ax_fresh.engine_change(repo))
        t = dict(table, built_by=dict(by, index='f' * 40)); json.dump(t, open(tp, 'w'))
        check("engine: another axiomcode-index (it writes the graph's symbols) makes it stale",
              ax_fresh.engine_change(repo).startswith('graph built by an older axiomcode (axiomcode-index ffffffff -> '), ax_fresh.engine_change(repo))
        legacy = {k: v for k, v in by.items() if k not in ('index', 'engine_langs')}
        legacy.update(engine_hash=ax_fresh.engine_id(e1)[1](), engine_stat=ax_fresh.engine_id(e1)[2])
        json.dump(dict(table, built_by=legacy), open(tp, 'w'))
        check("per-lang: a table from before the per-language key, from the same engine, is current (the upgrade rebuilds nothing)",
              ax_fresh.engine_change(repo) == '', ax_fresh.engine_change(repo))
        json.dump(dict(table, built_by=dict(legacy, impact='1')), open(tp, 'w'))
        check("per-lang: such a table with another IMPACT_VERSION is stale, as it was recorded to be",
              'IMPACT_VERSION 1 -> ' in ax_fresh.engine_change(repo), ax_fresh.engine_change(repo))
        json.dump(dict(table, built_by=legacy), open(tp, 'w'))
        fake_engine(e1, java='jrel(2).\n')
        check("per-lang: such a table is stale after a java-only change, as it was (whole-engine hash)",
              ax_fresh.engine_change(repo).startswith('graph built by an older axiomcode (engine '), ax_fresh.engine_change(repo))
        fake_engine(e1)
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


# ── per language ──────────────────────────────────────────────────────────────────────────────────────────────────
def per_language_checks():
    """the measured storm (2026-09-29): any change to an installed build marked every graph stale. Now a graph is stale
    only for a change to what builds ITS languages. Each language edit has a near miss: the same kind of edit in
    another language's tree"""
    work = tempfile.mkdtemp(prefix='axiomcode-perlang-'); saved = os.environ.get('AXIOMCODE_ENGINE')
    try:
        e = fake_engine(os.path.join(work, 'e')); os.environ['AXIOMCODE_ENGINE'] = e
        repos = {}
        for name, lang in (('python', 'python'), ('java', 'java'), ('csharp', 'csharp'), ('python+java', 'python,java')):
            r = os.path.join(work, name.replace('+', '-')); write(r, '.axiomcode/out/graph.sqlite', '')
            json.dump(dict(lang=lang, lang_auto=False, src='', src_arg='', library='', built=time.time(), files={},
                           built_by=ax_fresh.built_by(e, lang)), open(os.path.join(r, '.axiomcode/out/files.json'), 'w'))
            repos[name] = r
        stale = lambda: sorted(l for l, r in repos.items() if ax_fresh.engine_change(r))
        check("per-lang: control: the engine that built them, unchanged, leaves every graph current", stale() == [], stale())
        fake_engine(e, java='jrel(2).\n')
        check("per-lang: a java rule change makes the java graphs stale and leaves the python and csharp graphs current",
              stale() == ['java', 'python+java'], stale())
        fake_engine(e)
        check("per-lang: control: put back, every graph is current again", stale() == [], stale())
        fake_engine(e, rules='rel(2).\n')
        check("per-lang: a python rule change makes the python graphs stale, not the java or csharp ones",
              stale() == ['python', 'python+java'], stale())
        fake_engine(e, parser_java='// java parser 2\n')
        check("per-lang: a java parser change (its parser directory and its detector) leaves the python and csharp graphs current",
              stale() == ['java', 'python+java'], stale())
        fake_engine(e, parser_py='// python parser 2\n')
        check("per-lang: a python parser change makes the python graphs stale", stale() == ['python', 'python+java'], stale())
        fake_engine(e, version='9.9.9')
        check("per-lang: a version-only bump (package.json's version) leaves every graph current", stale() == [], stale())
        fake_engine(e, pipeline='# run 2\n')
        check("per-lang: a shared pipeline change makes every graph stale", stale() == ['csharp', 'java', 'python', 'python+java'], stale())
        fake_engine(e, bundle='// bundle 2\n')
        check("per-lang: a bundle change (it writes every graph) makes every graph stale", stale() == ['csharp', 'java', 'python', 'python+java'], stale())
    finally:
        if saved is None: os.environ.pop('AXIOMCODE_ENGINE', None)
        else: os.environ['AXIOMCODE_ENGINE'] = saved
        shutil.rmtree(work, ignore_errors=True)


# ── newer ─────────────────────────────────────────────────────────────────────────────────────────────────────────
NEWER_BUILD = "import os, sys; open(os.path.join(sys.argv[2], 'built-by-this-one'), 'a').write('x\\n')\n"


def newer_checks():
    """a graph built by a NEWER axiomcode (a higher IMPACT_VERSION, or the same one and a later engine) is never rebuilt
    by this older one: not by the refresher (whatever changed), not by `index`; every answer comes from it at once and
    says so. The near-miss: a graph built by an OLDER axiomcode is still rebuilt, by the refresher and by `index`"""
    work = tempfile.mkdtemp(prefix='axiomcode-newer-'); saved = os.environ.get('AXIOMCODE_ENGINE')
    try:
        e1 = fake_engine(os.path.join(work, 'e1'), version='1.0.0'); os.environ['AXIOMCODE_ENGINE'] = e1
        mine = ax_fresh.plugin_id()[1]
        # the stand-in build the refresher runs: it only records that it ran (AXIOMCODE_BASH runs it in place of bash)
        fb = os.path.join(work, 'fake_build.py'); open(fb, 'w').write(NEWER_BUILD)
        runner = os.path.join(work, 'runner.sh'); open(runner, 'w').write(f'#!/bin/sh\nexec "{sys.executable}" "{fb}" "$@"\n'); os.chmod(runner, 0o755)
        driver = os.path.join(work, 'driver.py'); open(driver, 'w').write(DRIVER)

        def repo_by(name, **by):
            repo = fake_repo(work, name); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
            tp = os.path.join(repo, '.axiomcode/out/files.json'); t = json.load(open(tp))
            t['built_by'].update(by); json.dump(t, open(tp, 'w'))
            return repo

        def worker(repo):
            env = dict(os.environ, AXIOMCODE_BASH=runner, AXIOMCODE_REFRESH_DEBOUNCE='0.05',
                       AXIOMCODE_REFRESH_SLOTS=os.path.join(work, 'slots'))     # not the machine's own build slots
            for k in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_GRAPH'): env.pop(k, None)
            subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'worker', repo], env=env, capture_output=True, text=True, timeout=60)
            return os.path.exists(os.path.join(repo, 'built-by-this-one'))

        def query(repo):
            env = {k: v for k, v in os.environ.items() if k not in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_FRESH', 'AXIOMCODE_GRAPH')}
            t0 = time.time()
            r = subprocess.run([sys.executable, driver, SCRIPTS, repo, 'impact', '--', sys.executable, '-c', f"print({ROWS!r})"],
                               capture_output=True, text=True, env=dict(env, AXIOMCODE_FRESH_WAIT='30'))
            return r.stdout, r.stderr, time.time() - t0

        up = str(int(mine) + 1); down = str(int(mine) - 1)
        repo = repo_by('newer', impact=up)
        s = ax_fresh.status(repo); want = f"graph built by a newer axiomcode (IMPACT_VERSION {up}, this one has {mine})"
        check("newer: a higher IMPACT_VERSION is a newer build, not an older one to rebuild; with no edit the graph is fresh",
              s.get('state') == 'fresh' and s.get('newer') == want and ax_fresh.engine_change(repo) == '', s)
        out, err, took = query(repo)
        check(f"newer: the answer comes from it at once ({took:.1f}s), unmarked, and says a newer axiomcode built it and it is not rebuilt",
              out.strip() == ROWS.strip() and want in err and 'not rebuild' in err and 'rebuilding' not in err and took < 10, (out, err))
        n = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'newer', repo], capture_output=True, text=True)
        u = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'uptodate', repo, 'python', '', ''], capture_output=True, text=True)
        check("newer: `index` is told to keep it (ax_fresh.py newer exits 0 and says why), and finds the files up to date",
              n.returncode == 0 and want in n.stdout and 'AXIOMCODE_REINDEX=1' in n.stdout and u.returncode == 0, (n.stdout, u.stdout))
        check("newer: the refresher does not rebuild it", not worker(repo) and ax_fresh.read_state(repo).get('state') == 'newer', ax_fresh.read_state(repo))
        # an edit: still never rebuilt; the answer marks the edited file's rows, waits for nothing, and says why no refresh comes
        open(os.path.join(repo, 'shop/api.py'), 'a').write('\ndef audit(items):\n    return total(items)\n')
        s = ax_fresh.status(repo); out, err, took = query(repo)
        check("newer: with a file edited the graph is stale, and still a newer build", s.get('state') == 'stale' and s.get('newer') == want, s)
        check("newer: with a file edited the refresher still does not rebuild it", not worker(repo), '')
        check(f"newer: with a file edited the answer marks that file's rows, does not wait ({took:.1f}s), and names no rebuild",
              'shop/api.py:5   - calls it' + ax_fresh.MARK in out and want in err and 'predates edits to shop/api.py' in err
              and 'queued' not in err and 'rebuilding' not in err and 'waiting' not in err and took < 10, (out, err))
        w = ax_fresh.wait(repo, 5)
        check("newer: a wait for a fresh graph returns at once rather than waiting for a rebuild that never comes", w.get('newer') == want, w)
        # the same IMPACT_VERSION and a later engine is newer too
        repo = repo_by('newer-engine', engine_version='1.0.1')
        check("newer: the same IMPACT_VERSION and a later engine version is a newer build",
              ax_fresh.status(repo).get('newer') == "graph built by a newer axiomcode (engine 1.0.1, this one is 1.0.0)" and not worker(repo),
              ax_fresh.status(repo))
        # ── composed with the per-language key: NEVER A DOWNGRADE is decided first ──
        # a newer graph whose own language's rules differ from this engine's is still not rebuilt: that difference is
        # the newer axiomcode's, not a staleness this one can fix
        repo = repo_by('newer-own-rules', impact=up, engine_hash='0' * 40, engine_stat='0' * 40)
        check("newer: a newer build whose own language's engine files differ is still a newer build, not an older one",
              ax_fresh.status(repo).get('newer') == want and ax_fresh.engine_change(repo) == '' and not worker(repo), ax_fresh.status(repo))
        # a higher IMPACT_VERSION is not re-exported either (rewarm): that would record this older version over it
        worker(repo)
        check("newer: the refresher does not re-export a newer build's facts; the table keeps the newer IMPACT_VERSION",
              json.load(open(os.path.join(repo, '.axiomcode/out/files.json')))['built_by'].get('impact') == up
              and ax_fresh.export_behind(json.load(open(os.path.join(repo, '.axiomcode/out/files.json')))) == '', '')
        # ── the near-miss: an OLDER build is this one's to bring up to date ──
        # with the per-language key a lower IMPACT_VERSION changes no graph: it is re-exported (rewarm), not rebuilt
        repo = repo_by('older', impact=down)
        s = ax_fresh.status(repo)
        check("control: a lower IMPACT_VERSION is an older build: not a newer one, and behind on its export",
              s.get('state') == 'fresh' and not s.get('newer') and ax_fresh.export_behind(json.load(open(os.path.join(repo, '.axiomcode/out/files.json')))) == down, s)
        n = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'newer', repo], capture_output=True, text=True)
        check("control: `index` is not told to keep an older build (ax_fresh.py newer exits 1, silent)", n.returncode == 1 and not n.stdout.strip(), n.stdout)
        rebuilt = worker(repo)
        check("control: the refresher brings an older IMPACT_VERSION up to this one by re-exporting, with no rebuild",
              not rebuilt and json.load(open(os.path.join(repo, '.axiomcode/out/files.json')))['built_by'].get('impact') == mine, ax_fresh.read_state(repo))
        # a table from before the per-language key: a lower IMPACT_VERSION is stale and rebuilt, as it was recorded
        repo = repo_by('older-legacy', impact=down)
        tp = os.path.join(repo, '.axiomcode/out/files.json'); t = json.load(open(tp)); t['built_by'].pop('index', None); json.dump(t, open(tp, 'w'))
        s = ax_fresh.status(repo)
        check("control: in a table from before the per-language key, a lower IMPACT_VERSION is stale, named as older, not newer",
              s.get('state') == 'stale' and f"IMPACT_VERSION {down} -> {mine}" in s.get('engine', '') and s.get('engine', '').startswith('graph built by an older axiomcode')
              and not s.get('newer'), s)
        check("control: the refresher rebuilds that older build", worker(repo), ax_fresh.read_state(repo))
        repo = repo_by('older-engine', engine_version='0.9.0', engine_hash='0' * 40, engine_stat='0' * 40)
        check("control: an earlier engine at the same IMPACT_VERSION is an older build, and is rebuilt",
              ax_fresh.status(repo).get('engine', '').startswith('graph built by an older axiomcode (engine 0.9.0') and not ax_fresh.status(repo).get('newer')
              and worker(repo), ax_fresh.status(repo))
    finally:
        if saved is None: os.environ.pop('AXIOMCODE_ENGINE', None)
        else: os.environ['AXIOMCODE_ENGINE'] = saved
        shutil.rmtree(work, ignore_errors=True)


# ── cap ───────────────────────────────────────────────────────────────────────────────────────────────────────────
FAKE_BUILD = r'''#!{py}
# stands in for `bash axiomcode-build <repo>`: logs when it runs, takes a while, and records the table a build would
import json, os, subprocess, sys, time
repo = sys.argv[2]; log = os.environ['CAP_LOG']
open(log, 'a').write(f"start {{os.path.basename(repo)}} {{time.time()}}\n")
time.sleep(float(os.environ.get('CAP_BUILD_SECONDS') or 3))
out = subprocess.run([sys.executable, os.path.join({scripts!r}, 'ax_fresh.py'), 'snapshot', repo, 'python', ''], capture_output=True, text=True).stdout
open(os.path.join(repo, '.axiomcode', 'out', 'files.json'), 'w').write(out)
open(log, 'a').write(f"end {{os.path.basename(repo)}} {{time.time()}}\n")
'''


def overlap(log):
    """the most builds the log shows running at once, and how many ran to the end"""
    ev = sorted((float(t), 1 if k == 'start' else -1) for k, _, t in (l.split() for l in open(log) if l.strip()))
    run = most = 0
    for _, d in ev: run += d; most = max(most, run)
    return most, sum(1 for l in open(log) if l.startswith('end '))


def cap_checks():
    work = tempfile.mkdtemp(prefix='axiomcode-cap-')
    try:
        fake = os.path.join(work, 'fake-build'); open(fake, 'w').write(FAKE_BUILD.format(py=sys.executable, scripts=SCRIPTS)); os.chmod(fake, 0o755)
        for cap in ('2', '3'):
            log = os.path.join(work, f'log-{cap}'); open(log, 'w').close()
            repos = []
            for i in range(3):
                r = fake_repo(work, f'r{cap}-{i}'); os.remove(os.path.join(r, '.axiomcode/refresh.json'))
                open(os.path.join(r, 'shop/api.py'), 'a').write('\ndef audit():\n    return 1\n')
                repos.append(r)
            env = dict(os.environ, AXIOMCODE_BASH=fake, CAP_LOG=log, AXIOMCODE_REFRESH_MAX=cap, AXIOMCODE_REFRESH_DEBOUNCE='0.1',
                       AXIOMCODE_REFRESH_SLOTS=os.path.join(work, f'slots-{cap}'))
            for k in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_GRAPH'): env.pop(k, None)
            procs = [subprocess.Popen([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'worker', r], env=env,
                                      stdout=open(os.path.join(r, '.axiomcode/refresh.log'), 'w'), stderr=subprocess.STDOUT) for r in repos]
            for p in procs: p.wait(timeout=120)
            most, ended = overlap(log)
            logs = [open(os.path.join(r, '.axiomcode/refresh.log')).read() for r in repos]
            queued = [l for l in logs if 'queued until one ends' in l]
            if cap == '2':
                check(f"cap: with AXIOMCODE_REFRESH_MAX=2, a third refresh waits while two run (at most {most} at once), then runs "
                      f"({ended} of 3 finished), and says it was queued", most == 2 and ended == 3 and len(queued) == 1, (open(log).read(), logs))
                check("cap: every queued repository ends fresh (queued, never dropped)",
                      all(ax_fresh.status(r).get('state') == 'fresh' for r in repos), [ax_fresh.status(r) for r in repos])
            else:
                check(f"cap: control: with room for three, all three run at once ({most}) and none is queued",
                      most == 3 and ended == 3 and not queued, (open(log).read(), logs))
        saved = os.environ.pop('AXIOMCODE_REFRESH_MAX', None)
        try:
            d = ax_fresh.refresh_cap(); os.environ['AXIOMCODE_REFRESH_MAX'] = '0'
            check("cap: the default is 2, and 0 turns it off (no slot taken)", d == 2 and ax_fresh.take_slot(work) is None, d)
        finally:
            os.environ.pop('AXIOMCODE_REFRESH_MAX', None)
            if saved is not None: os.environ['AXIOMCODE_REFRESH_MAX'] = saved
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── compile lock ──────────────────────────────────────────────────────────────────────────────────────────────────
def lock_checks():
    work = tempfile.mkdtemp(prefix='axiomcode-lock-')
    helper = os.path.join(ROOT, 'graph', 'pipeline', 'compile-lock.sh')
    def take(lock, secs):
        """True when compile_lock_take got `lock` within secs; its output"""
        p = subprocess.Popen(['bash', '-c', '. "$1"; compile_lock_take "$2"; echo TOOK; compile_lock_drop "$2"', 'x', helper, lock],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=dict(os.environ, COMPILE_LOCK_POLL='0.2'))
        try: out = p.communicate(timeout=secs)[0]
        except subprocess.TimeoutExpired: p.kill(); out = p.communicate()[0]
        return 'TOOK' in out, out
    try:
        live = subprocess.Popen(['sleep', '60'])
        lock = os.path.join(work, 'live.lock'); os.mkdir(lock); open(os.path.join(lock, 'pid'), 'w').write(f'{live.pid}\n')
        old = time.time() - 3 * 3600; os.utime(lock, (old, old))                  # three hours old: dead by the old 30-min rule
        took, out = take(lock, 3)
        check("lock: a lock whose owner is alive is not taken over, however old it is", not took and os.path.isdir(lock), out)
        live.kill(); live.wait()
        took, out = take(lock, 20)
        check("lock: once its owner is dead it is taken over at once", took and 'is gone; taking its lock over' in out and not os.path.exists(lock), out)
        young = os.path.join(work, 'nopid.lock'); os.mkdir(young)
        took, out = take(young, 3)
        check("lock: control: a young lock with no pid yet (between its mkdir and its write) is waited for", not took, out)
        os.utime(young, (old, old)); took, out = take(young, 20)
        check("lock: an old lock with no pid (an older run's) is taken over", took, out)
        mine = os.path.join(work, 'mine.lock')
        r = subprocess.run(['bash', '-c', '. "$1"; compile_lock_take "$2"; [ "$(cat "$2/pid")" = "$$" ] && echo OWNER', 'x', helper, mine], capture_output=True, text=True)
        check("lock: the run that takes the lock writes its own pid into it", 'OWNER' in r.stdout, (r.stdout, r.stderr))
    finally:
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
    prune_checks(); marks_checks(); wait_checks(); engine_checks(); per_language_checks(); newer_checks(); cap_checks(); lock_checks(); named_checks(); mcp_checks()
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)} of {len(RESULTS)} passed" + (f"; FAILED: {len(bad)}" if bad else ''))
    sys.exit(1 if bad or not RESULTS else 0)
