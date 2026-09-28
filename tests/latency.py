#!/usr/bin/env python3
"""tests/latency.py — what a query spends its time on is spent once, and the answer does not change for it.

Measured on a 34k-line React/TypeScript app and on this repository, a query's time went to work repeated on every call
that gives the same result every time: opening every non-source file in the tree to look for the changed name (and a
dev server's build folder is thousands of them), running the impact rules again for a question already asked (page 2
of the same answer), walking the tree once per language to decide the graph is fresh, starting a second bash, a sed, a
tr and two greps to decide a word is a verb, and starting Python once more just to ask it where it lives. And a query
on a repository with no graph yet waited, silently, for the whole first build.

Each check here pins one of those, and every speed-up is checked against the slow path it replaces: the same answer,
byte for byte.

  scan      the cached non-source scan finds exactly what the full scan finds, across edits, additions, deletions,
            a binary file, a too-large file, dotted names and a name the word index cannot hold; and a warm query
            opens only the files whose words include the name
  skip      a name written in a framework's build folder (.next) or a coverage report is not a binding; the same name
            in a config file still is
  walk      the one-walk file table of a repository in several languages is the union of the per-language walks,
            directories only C# prunes (obj, bin) included
  solve     impact answers the same with the solve cache as without it, a repeat reads it, and another question on
            the same graph does not
  verbs     bin/axiomcode tells a verb from a build without starting a second bash, and knows the verbs the frontend
            dispatches
  python    the node launchers' Python probe is remembered, and probed again when what a candidate resolves to moves
  build     a query under the MCP server on a repository with no graph answers within seconds, saying the graph is
            being built and at what stage, and so does a second one while it builds; the answer comes once it is done
  timeout   an MCP call that outlives the server's timeout says so in words instead of raising

The scan, walk, verbs and python checks need no engine; skip, solve and build index a small TypeScript project
(AXIOMCODE_ENGINE, as tests/run.py).

    python3 tests/latency.py [--no-engine]
"""
import builtins, importlib.util, json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, SCRIPTS)
RESULTS = []


def check(why, ok, detail=''):
    RESULTS.append(ok)
    print(('ok   ' if ok else 'FAIL ') + why)
    if not ok and detail: print('     ' + str(detail)[-1500:].replace('\n', '\n     '))


def write(root, rel, text, mode='w'):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, mode) as fh: fh.write(text)
    return p


# ── scan ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def scan_checks():
    import ax_nonsource
    work = tempfile.mkdtemp(prefix='axiomcode-scan-')
    try:
        repo = os.path.join(work, 'repo'); cache = os.path.join(work, 'cache')
        write(repo, 'src/app.ts', 'export function priceOf() {}\n')
        write(repo, 'config/app.yml', 'handler: priceOf\nother: x.priceOf\nprefix: priceOf.rate\nnot: priceOfAll\n')
        write(repo, 'mappers/order.xml', '<select id="Order.priceOf">\n  <call>Order.priceOf.inner</call>\n</select>\n')
        write(repo, 'scripts/run.sh', 'echo $priceOf-x\necho priceOf$\necho ünïcode priceOf\n')
        write(repo, 'blob.bin', b'\0\0priceOf\0', 'wb')
        write(repo, 'big.json', '"priceOf" ' * 60000)
        write(repo, 'notes.md', 'priceOf in prose\n')
        old = time.time() - 60
        for d, _, fs in os.walk(repo):
            for f in fs: os.utime(os.path.join(d, f), (old, old))
        indexed = {'src/app.ts'}
        skip_dir = {'.git', 'node_modules', '.axiomcode'}; skip_ext = {'.ts', '.md'}
        queries = [['priceOf'], ['Order.priceOf'], ['priceOf.rate'], ['rate'], ['x.priceOf'], ['priceOf-x'], ['priceOf$'],
                   ['ünïcode'], ['handler', 'priceOf'], ['a b c'], ['nothing-here']]

        def full(names):
            os.environ['AXIOMCODE_NO_SCAN_CACHE'] = '1'
            try: return ax_nonsource.NonSource(repo, cache, indexed, skip_dir, skip_ext).hits(names), \
                        ax_nonsource.NonSource(repo, cache, indexed, skip_dir, skip_ext).files()
            finally: del os.environ['AXIOMCODE_NO_SCAN_CACHE']

        def cached(names):
            ns = ax_nonsource.NonSource(repo, cache, indexed, skip_dir, skip_ext)
            return ns.hits(names), ns.files()

        def agree(stage):
            bad = [(q, full(q), cached(q)) for q in queries if full(q) != cached(q)]
            check(f"scan: the cached scan finds what the full scan finds ({stage})", not bad, bad[:2])

        agree('cold cache'); agree('warm cache')
        # an edit that keeps the size, a new file, a deleted one, a file turned binary
        p = os.path.join(repo, 'config/app.yml'); t = open(p).read().replace('handler: priceOf', 'handler: priceIf')
        open(p, 'w').write(t); os.utime(p, (old + 10, old + 10))
        q = write(repo, 'config/new.properties', 'price.handler=priceOf\n'); os.utime(q, (old, old))
        os.remove(os.path.join(repo, 'scripts/run.sh'))
        b = write(repo, 'mappers/order.xml', b'<\0binary priceOf', 'wb'); os.utime(b, (old + 10, old + 10))
        agree('after edits, an addition, a deletion and a file turned binary')
        # a file written just now is not trusted to the cache: its mtime may not have ticked yet
        write(repo, 'config/fresh.yml', 'fresh: priceOf\n')
        agree('a file modified this second')
        write(repo, 'config/fresh.yml', 'fresh: priceOf and more text\n')
        agree('the same file modified again within the second')

        # a warm query opens only files whose words include the name
        for i in range(200): write(repo, f'data/f{i}.json', f'{{"k{i}": "v{i}"}}\n')
        for d, _, fs in os.walk(repo):
            for f in fs: os.utime(os.path.join(d, f), (old, old))
        cached(['priceOf'])
        opened = []; real = builtins.open
        def spy(f, *a, **k):
            if isinstance(f, str) and f.startswith(repo): opened.append(f)
            return real(f, *a, **k)
        builtins.open = spy
        try: hits, _ = cached(['priceOf'])
        finally: builtins.open = real
        check("scan: a warm query opens only the files whose words include the name (not 200 unrelated ones)",
              0 < len(opened) <= 3 and hits == full(['priceOf'])[0], opened)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── walk ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def walk_checks():
    import ax_fresh
    work = tempfile.mkdtemp(prefix='axiomcode-walk-')
    try:
        for rel in ('src/a.ts', 'src/b.tsx', 'src/c.js', 'lib/d.py', 'svc/E.cs', 'svc/obj/F.cs', 'svc/obj/g.ts', 'bin/h.js', 'bin/I.cs',
                    'packages/web/j.ts', 'packages/k.cs', 'node_modules/x/l.ts', 'dist/m.js', 'app/src/main/java/N.java',
                    'app/src/main/resources/META-INF/services/p.Q', 'tool', 'Directory.Build.props', 'package.json', 'pyproject.toml',
                    'app/build.gradle', 'deep/obj/bin/r.ts', 'deep/obj/bin/S.cs'):
            write(work, rel, '#!/usr/bin/env python3\n' if rel == 'tool' else 'x\n')
        langs = 'typescript,java,python,javascript,csharp'
        def per_language(lang):
            out = set()
            for l in lang.split(','):
                exts, names, prune = ax_fresh.EXT.get(l, ()), ax_fresh.NAMES.get(l, ()), ax_fresh.PRUNE.get(l, ax_fresh.PRUNE_ALL)
                for d, subdirs, files in os.walk(work):
                    subdirs[:] = [s for s in subdirs if s not in prune]
                    for f in files:
                        if f.endswith(exts) or f in names or (l == 'java' and os.path.basename(d) == 'services' and 'META-INF' in d) \
                                or (l == 'python' and ax_fresh.python_script(os.path.join(d, f), f)):
                            out.add(os.path.join(d, f))
            return out
        for lang in (langs, 'csharp', 'typescript,csharp', 'java', 'python,javascript'):
            got = list(ax_fresh.watched(work, lang))
            check(f"walk: one walk yields what one walk per language did ({lang})", set(got) == per_language(lang) and len(got) == len(set(got)),
                  sorted(set(got) ^ per_language(lang)))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── verbs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def verbs_checks():
    front = subprocess.run(['bash', os.path.join(SCRIPTS, 'axiomcode'), '--verbs'], capture_output=True, text=True).stdout.split()
    r = subprocess.run(['bash', os.path.join(ROOT, 'bin', 'axiomcode'), 'no-such-verb'], capture_output=True, text=True)
    listed = next((l.split(':', 1)[1].split() for l in r.stderr.splitlines() if l.strip().startswith('ask:')), [])
    check("verbs: bin/axiomcode knows exactly the verbs the frontend dispatches (less its `tests` alias)",
          listed == [v for v in front if v != 'tests'], (listed, front))
    work = tempfile.mkdtemp(prefix='axiomcode-verbs-')
    try:
        log = os.path.join(work, 'spawned')
        real_bash = shutil.which('bash')
        shim = os.path.join(work, 'shim'); os.makedirs(shim)
        for name in ('bash', 'sed', 'grep', 'tr', 'dirname'):
            real = shutil.which(name)
            if not real: continue
            write(shim, name, f'#!{real_bash}\necho "{name} $*" >> "{log}"\nexec "{real}" "$@"\n'); os.chmod(os.path.join(shim, name), 0o755)
        env = dict(os.environ, PATH=shim + os.pathsep + os.environ['PATH'])
        subprocess.run([real_bash, os.path.join(ROOT, 'bin', 'axiomcode'), 'impact', '--help'], capture_output=True, text=True, env=env)
        spawned = open(log).read().splitlines() if os.path.exists(log) else []
        before_verb = []
        for l in spawned:
            if l.startswith('bash ') and l.split()[1].endswith(os.path.join('scripts', 'axiomcode')) and '--verbs' not in l: break
            before_verb.append(l)
        check("verbs: `axiomcode impact` reaches the frontend without starting a program to recognise the verb or find its root",
              not before_verb, before_verb)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── python ────────────────────────────────────────────────────────────────────────────────────────────────────────
PY_JS = r'''
const cp = require('child_process'); let n = 0; const real = cp.spawnSync;
cp.spawnSync = (...a) => { n++; return real(...a); };
const f = require(process.argv[1]);
const a = f.findPython(), k1 = n; const b = f.findPython(), k2 = n;
process.env.PATH = process.argv[2] + require('path').delimiter + process.env.PATH;
const c = f.findPython(), k3 = n;
console.log(JSON.stringify({a, b, c, first: k1, second: k2 - k1, moved: k3 - k2}));
'''


def python_checks():
    if not shutil.which('node'): print('skip python: no node'); return
    work = tempfile.mkdtemp(prefix='axiomcode-py-')
    try:
        shadow = os.path.join(work, 'bin'); os.makedirs(shadow)
        py = shutil.which('python3')
        write(shadow, 'python3', f'#!/bin/sh\nexec "{py}" "$@"\n'); os.chmod(os.path.join(shadow, 'python3'), 0o755)
        env = dict(os.environ, TMPDIR=work, TEMP=work, TMP=work); env.pop('AXIOMCODE_NO_PYTHON_CACHE', None); env.pop('AXIOMCODE_PYTHON', None)
        r = subprocess.run(['node', '-e', PY_JS, os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'find-python.js'), shadow],
                           capture_output=True, text=True, env=env)
        try: o = json.loads(r.stdout)
        except ValueError: check('python: the probe runs', False, r.stdout + r.stderr); return
        check("python: the probe runs once, and a second launch reuses its answer without starting Python",
              o['first'] >= 1 and o['second'] == 0 and o['a'] == o['b'], o)
        check("python: a python3 that now resolves elsewhere on PATH is probed again", o['moved'] >= 1 and o['c'].get('exe'), o)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── the checks that need a graph ─────────────────────────────────────────────────────────────────────────────────
PROJECT = {
    'package.json': '{"name": "shop", "version": "1.0.0"}\n',
    'tsconfig.json': '{"compilerOptions": {"strict": true}}\n',
    'src/price.ts': 'export function priceOf(n: number): number {\n  return n * 2;\n}\n\nexport function taxOf(n: number): number {\n  return n / 10;\n}\n',
    'src/cart.ts': 'import { priceOf, taxOf } from "./price";\n\nexport function total(items: number[]): number {\n  return items.map(priceOf).reduce((a, b) => a + b + taxOf(b), 0);\n}\n\nexport function first(items: number[]): number {\n  return priceOf(items[0]);\n}\n',
    'src/cart.test.ts': 'import { total } from "./cart";\n\ntest("total", () => {\n  expect(total([1, 2])).toBe(6);\n});\n',
    'config/app.yml': 'pricing:\n  handler: priceOf\n',
    '.next/server/app/page.js.map': '{"version":3,"sourcesContent":["export function priceOf(n) { return n * 2 }"],"names":["priceOf"]}\n',
    'coverage/lcov-report/price.ts.html': '<td>priceOf</td>\n',
}


def git_repo(repo):
    subprocess.run(['git', 'init', '-q', '.'], cwd=repo, check=True)
    subprocess.run(['git', 'add', '-A'], cwd=repo, check=True)
    subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], cwd=repo, check=True)


def graph_checks():
    work = tempfile.mkdtemp(prefix='axiomcode-latency-')
    try:
        repo = os.path.join(work, 'repo')
        for rel, text in PROJECT.items(): write(repo, rel, text)
        git_repo(repo)
        r = subprocess.run(['bash', os.path.join(SCRIPTS, 'axiomcode-build'), repo], capture_output=True, text=True, timeout=900)
        if r.returncode != 0: check('index the project', False, r.stdout + r.stderr); return
        env = dict(os.environ, AXIOMCODE_NO_REFRESH='1')
        def impact(*args, **extra):
            p = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'axiomcode-impact'), *args, repo], cwd=repo,
                               capture_output=True, text=True, env=dict(env, **extra), timeout=300)
            return p.stdout, p.stderr, p.returncode

        out, _, _ = impact('priceOf')
        check("skip: a name in a config file is still reported as bound from outside the source", 'config/app.yml' in out, out)
        check("skip: a name in a framework build folder or a coverage report is not", '.next/' not in out and 'coverage/' not in out, out)

        # the answer is the same with every cache off, cold and warm; a repeat reads the solve; another question does not
        solve = os.path.join(repo, '.axiomcode', 'out', 'dl', 'impact', 'solve'); shutil.rmtree(solve, ignore_errors=True)
        ref = {t: impact(t, AXIOMCODE_NO_SOLVE_CACHE='1', AXIOMCODE_NO_SCAN_CACHE='1')[0] for t in ('priceOf', 'taxOf', 'total')}
        a1, e1, _ = impact('priceOf', AXIOMCODE_PROFILE='1')
        a2, e2, _ = impact('priceOf', AXIOMCODE_PROFILE='1')
        b1, e3, _ = impact('taxOf', AXIOMCODE_PROFILE='1')
        c1, _, _ = impact('total', '--page', '1')
        check("solve: impact answers the same with the caches as without them, cold and warm", a1 == a2 == ref['priceOf'] and b1 == ref['taxOf'] and c1 == ref['total'],
              (a1[-400:], ref['priceOf'][-400:]))
        check("solve: the first query runs the rules and a repeat reads what they derived", 'souffle returned' in e1 and 'solve read from the cache' in e2, e1 + e2)
        check("solve: another target on the same graph runs the rules, not the cached answer", 'souffle returned' in e3, e3)
        # a changed non-source file is a changed per-query fact: the solve runs again and sees it
        write(repo, 'config/app.yml', 'pricing:\n  handler: priceOf\n  fallback: priceOf\n')
        a3, e4, _ = impact('priceOf', AXIOMCODE_PROFILE='1')
        check("solve: a new mention in a config file is a new question, not a cache hit", 'souffle returned' in e4 and a3 == impact('priceOf', AXIOMCODE_NO_SOLVE_CACHE='1', AXIOMCODE_NO_SCAN_CACHE='1')[0], e4)

        # build: no graph, under the MCP server
        fresh = os.path.join(work, 'fresh'); shutil.copytree(repo, fresh, ignore=shutil.ignore_patterns('.axiomcode'))
        disp = os.path.join(SCRIPTS, 'axiomcode')
        benv = dict(os.environ, AXIOMCODE_BUILD_NOWAIT='1', AXIOMCODE_BUILD_WAIT='0')
        t = time.time(); p = subprocess.run(['bash', disp, 'impact', 'priceOf', fresh], capture_output=True, text=True, env=benv, timeout=120); t1 = time.time() - t
        check("build: a query with no graph answers at once that the graph is being built, and at what stage",
              t1 < 20 and 'is being built' in p.stdout and 'ask again' in p.stdout, (round(t1, 1), p.stdout + p.stderr))
        t = time.time(); p2 = subprocess.run(['bash', disp, 'path', 'total', 'priceOf', fresh], capture_output=True, text=True, env=benv, timeout=120); t2 = time.time() - t
        import ax_fresh
        building = ax_fresh.building(fresh)
        check("build: a second query while it builds says so too, instead of queueing a second build behind it",
              t2 < 20 and ('is being built' in p2.stdout or (not building and 'priceOf' in p2.stdout)), (round(t2, 1), p2.stdout + p2.stderr))
        end = time.time() + 900
        while (ax_fresh.building(fresh) or not os.path.exists(os.path.join(fresh, '.axiomcode', 'out', 'graph.sqlite'))) and time.time() < end: time.sleep(1)
        p3 = subprocess.run(['bash', disp, 'impact', 'priceOf', fresh], capture_output=True, text=True, env=benv, timeout=300)
        check("build: once it is done the same call answers", 'change: priceOf' in p3.stdout and 'first' in p3.stdout and 'is being built' not in p3.stdout, p3.stdout + p3.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── timeout ───────────────────────────────────────────────────────────────────────────────────────────────────────
def timeout_checks():
    spec = importlib.util.spec_from_file_location('axserver', os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py'))
    m = importlib.util.module_from_spec(spec)
    import io, contextlib
    with contextlib.redirect_stderr(io.StringIO()): spec.loader.exec_module(m)
    work = tempfile.mkdtemp(prefix='axiomcode-timeout-')
    try:
        try: out = m.run(['context', 'anything', work], timeout=0.01); raised = ''
        except Exception as e: out, raised = '', repr(e)
        check("timeout: an MCP call past the server's timeout answers in words, not with an exception",
              not raised and 'did not answer within' in out, raised or out)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    scan_checks(); walk_checks(); verbs_checks(); python_checks(); timeout_checks()
    if '--no-engine' not in sys.argv: graph_checks()
    bad = RESULTS.count(False)
    print(f"{len(RESULTS)} check(s) held" if not bad else f"{bad} of {len(RESULTS)} FAILED")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
