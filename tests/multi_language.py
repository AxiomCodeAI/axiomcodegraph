#!/usr/bin/env python3
"""tests/multi_language.py — a repository in several languages is indexed in all of them, and asked in all of them.

It used to be indexed as the language with the most files, and every other language was dropped without a word: no
symbol, no edge, and `changed` on an edit in the dropped language said the edit touched nothing the graph knows. Each
language now has its own graph (the main one where it always was, the others in .axiomcode/lang/<lang>), and the
query verbs ask all of them. A graph holds one language; no call is followed from one to another.

One throwaway repository in TypeScript (the main language: most files), Python and JavaScript:

  build          every language gets a graph, and the build names each
  queries        a name declared in each language is found, in its own graph; one that is nowhere is refused once
  compatible     a name only the main graph holds is answered exactly as that graph answers alone (no header, same
                 bytes), and --json keeps its shape, adding `other_languages` only when several graphs answer
  changed        an edit in two languages is reported once each, by the graph of its language; a clean tree once
  refresh        an edit in a language other than the main one makes the graph stale, and a query sees it
  --lang         restricting the languages removes the others' graphs, which must not keep answering
  upgrade        a graph built before this (one language, a file table without `lang_auto`) is stale in a repository
                 with other languages, so the first refresh indexes them
  control        a repository in one language gets no .axiomcode/lang and no fan-out
  build output   a Maven repository's target/ and a generated javadoc are not a JavaScript project (#1545); the same
                 repository with JavaScript of its own, one file in a directory named target, still gets that graph
  stopped        a first query builds the graph, and the caller stops it mid-build (a timeout, Ctrl-C, a host that ends the
                 process group): the build is not the query's, it goes on and publishes every graph, and the next query
                 answers from them without building again. `axiomcode index` stopped after its main language is solved
                 publishes that graph before it stops, and the graph stays stale until the others are built. Controls:
                 one stopped before anything is solved stops at once and leaves no graph; a repository in one language
                 behaves the same

    python3 tests/multi_language.py [-v]
"""
import fcntl, json, os, shutil, signal, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
FRESH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_fresh.py')
BUILD = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-build')

FILES = {
    'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
    'src/util.ts': 'export function square(x: number): number {\n  return x * x\n}\n',
    'src/shape.ts': 'import { square } from \'./util\'\n\nexport function area(r: number): number {\n  return 3 * square(r)\n}\n',
    'src/main.ts': 'import { area } from \'./shape\'\n\nexport function run(): number {\n  return area(2)\n}\n',
    'src/extra.ts': 'export function onlyInTs(): number {\n  return 7\n}\n',
    'tools/pkg/__init__.py': '',
    'tools/pkg/calc.py': 'def add(a, b):\n    return a + b\n\n\ndef total(xs):\n    t = 0\n    for x in xs:\n        t = add(t, x)\n    return t\n',
    'tools/pkg/cli.py': 'from pkg.calc import total\n\n\ndef main():\n    return total([1, 2])\n',
    'tools/gen/make.py': 'def emit(x):\n    return x\n\n\ndef main():\n    return emit(1)\n',
    'src/cli.ts': 'import { run } from \'./main\'\n\nexport function main(): number {\n  return run()\n}\n',
    'jslib/package.json': '{ "name": "jslib", "version": "1.0.0", "main": "index.js" }\n',
    'jslib/index.js': 'function helper(a) {\n  return a + 1\n}\n\nfunction api(a) {\n  return helper(a) * 2\n}\n\nmodule.exports = { api }\n',
}

# a Maven project whose build wrote javadoc: target/ beside the pom.xml, and a copy committed for a docs site
JAVADOC_JS = 'function loadScripts(doc, tag) {\n  createElem(doc, tag, \'search.js\')\n}\n\nfunction createElem(doc, tag, path) {\n  return doc.createElement(tag)\n}\n'
MAVEN = {
    'pom.xml': '<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>example</groupId>\n  <artifactId>widgets</artifactId>\n  <version>1.0</version>\n</project>\n',
    'src/main/java/app/WidgetValidator.java': 'package app;\n\npublic class WidgetValidator {\n    public boolean check(String name) {\n        return name != null && !name.isEmpty();\n    }\n}\n',
    'target/site/apidocs/script.js': JAVADOC_JS,
    'docs/apidocs/index.html': '<!DOCTYPE html>\n<html><head><script src="script.js"></script></head></html>\n',
    'docs/apidocs/element-list': 'app\n',
    'docs/apidocs/script.js': JAVADOC_JS,
}
# ...and its own JavaScript, one module of it in a directory named target that no pom.xml owns
MAVEN_WEB = {
    'package.json': '{ "name": "widgets-web", "version": "1.0.0", "main": "src/main/js/app.js" }\n',
    'webpack.config.js': "module.exports = { entry: './src/main/js/app.js' }\n",
    'src/main/js/app.js': "const aim = require('./target/aim')\n\nfunction start(order) {\n  return aim.point(order)\n}\n\nmodule.exports = { start }\n",
    'src/main/js/target/aim.js': 'function point(order) {\n  return order\n}\n\nmodule.exports = { point }\n',
}


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make(root, files):
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        open(os.path.join(root, rel), 'w').write(text)
    for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'), ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
        sh(root, *cmd)


def settle(repo, env):
    """wait until no background refresh is running: a query that refreshed starts one, and a check that reads the
    graph's state or rebuilds it must not race it"""
    # the refresher loops: after a rebuild it waits out the debounce and checks again, so one look between two of its
    # passes is not quiet. Quiet is several seconds with no build
    deadline, quiet_since = time.time() + 600, None
    while time.time() < deadline:
        busy = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}').get('state') == 'building'
        quiet_since = None if busy else (quiet_since or time.time())
        if quiet_since and time.time() - quiet_since > 3: return
        time.sleep(0.2)


def building(repo):
    """a build holds the repository's build lock"""
    try: fd = os.open(os.path.join(repo, '.axiomcode', 'build.lock'), os.O_RDWR)
    except OSError: return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); return False
    except OSError: return True
    finally: os.close(fd)


def until(cond, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if cond(): return True
        time.sleep(0.05)
    return False


def stopped_query(repo, env, verb_args):
    """a first query in its own process group, stopped by a signal to that group once its build holds the lock, as a
    caller's timeout stops it; then the build (if it survived) is waited for. Returns whether the build was running when
    the query was stopped"""
    p = subprocess.Popen([AX] + verb_args, cwd=repo, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    started = until(lambda: building(repo) or p.poll() is not None, 300) and p.poll() is None
    try: os.killpg(p.pid, signal.SIGTERM)
    except OSError: pass
    p.wait(); time.sleep(0.5)
    until(lambda: not building(repo), 900)
    return started


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-multi-')
    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_REFRESH_DEBOUNCE='0.5', AXIOMCODE_FRESH_WAIT='600')
    # a machine that turns the refresher off for everything (AXIOMCODE_NO_REFRESH) must not turn it off for the
    # checks about it: `quiet` below is where this test turns it off itself
    env.pop('AXIOMCODE_LANG', None); env.pop('AXIOMCODE_GRAPH', None); env.pop('AXIOMCODE_NO_REFRESH', None)
    quiet = dict(env, AXIOMCODE_NO_REFRESH='1')
    try:
        repo = os.path.join(work, 'mixed'); make(repo, FILES)
        lang_dir = os.path.join(repo, '.axiomcode', 'lang')

        # ── build ─────────────────────────────────────────────────────────────────────────────────────────────
        b = sh(repo, AX, 'index', '.', env=quiet)
        graphs = {l: os.path.exists(os.path.join(lang_dir, l, 'out', 'graph.sqlite')) for l in ('python', 'javascript')}
        check(b.returncode == 0 and all(graphs.values()) and os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')),
              'build: the main language (typescript) and every other language (python, javascript) get a graph', b.stdout + b.stderr + json.dumps(graphs))
        check('typescript + python + javascript' in b.stdout and '(python)' in b.stdout and '(javascript)' in b.stdout,
              'build: the output names every language it indexed', b.stdout)
        if b.returncode: return 1

        # ── queries ───────────────────────────────────────────────────────────────────────────────────────────
        p = sh(repo, AX, 'impact', 'add', '.', env=quiet)
        check(p.returncode == 0 and '══ python graph' in p.stdout and 'tools/pkg/calc.py' in p.stdout and 'total' in p.stdout,
              'queries: a Python function in a TypeScript repository is found, with its caller, in the python graph', p.stdout + p.stderr)
        j = sh(repo, AX, 'path', 'api', 'helper', '.', env=quiet)
        check(j.returncode == 0 and 'verified' in j.stdout and '══ javascript graph' in j.stdout,
              'queries: a JavaScript chain is found in the javascript graph', j.stdout + j.stderr)
        n = sh(repo, AX, 'impact', 'nowhereAtAll', '.', env=quiet)
        check(n.returncode != 0 and n.stdout.count('nothing named') == 1,
              'queries: a name in no graph is refused, once, with a non-zero status', n.stdout + n.stderr)

        # ── scope ─────────────────────────────────────────────────────────────────────────────────────────────
        # a scope only another language's graph holds is honoured, not refused because the main graph lacks it. The
        # scope is a real directory and comes after the repository: the dispatcher once took it for the repository
        # and asked the main graph alone
        s = sh(repo, AX, 'context', 'add up a total', '.', '--in', 'tools/pkg', env=quiet)
        check(s.returncode == 0 and '══ python graph' in s.stdout and 'no indexed file' not in s.stdout,
              'scope: context --in a directory only the python graph holds answers from that graph', s.stdout + s.stderr)
        s = sh(repo, AX, 'impact', 'add', '.', '--in', 'tools/pkg', env=quiet)
        check(s.returncode == 0 and 'total' in s.stdout, 'scope: impact --in it too', s.stdout + s.stderr)
        s = sh(repo, AX, 'path', 'total', 'add', '.', '--in', 'tools/pkg', env=quiet)
        check(s.returncode == 0 and 'verified' in s.stdout, 'scope: and path --in it', s.stdout + s.stderr)
        s = sh(repo, AX, 'context', 'compute the area of a shape', '.', '--in', 'src', env=quiet)
        check(s.returncode == 0 and '══' not in s.stdout and 'src/' in s.stdout,
              'scope (control): --in the main graph\'s directory answers as the main graph alone', s.stdout + s.stderr)
        s = sh(repo, AX, 'context', 'add up a total', '.', '--in', 'tools/nosuch', env=quiet)
        check(s.returncode != 0 and 'no indexed file' in s.stdout, 'scope (control): a directory no graph holds is still refused', s.stdout + s.stderr)
        s = sh(repo, AX, 'context', 'compute the area of a shape', '.', '--in', 'tools/pkg', env=quiet)
        check(s.returncode != 0 and 'none of these words appear under it' in s.stdout and 'no indexed file' not in s.stdout,
              'scope (control): a scope one graph holds, with nothing under it matching, is refused by that graph alone', s.stdout + s.stderr)

        # ── --from ────────────────────────────────────────────────────────────────────────────────────────────
        # `main` is declared in the typescript graph and twice in the python one: the flow starts where the task's
        # words land, and that language comes first
        f = sh(repo, AX, 'context', 'how does the calc tool total its numbers', '.', '--from', 'main', env=quiet)
        first = f.stdout.split('══')[1] if f.stdout.count('══') >= 2 else f.stdout
        check(f.returncode == 0 and first.strip().startswith('python graph') and 'tools/pkg/cli.py' in f.stdout
              and 'tools/gen/make.py' not in f.stdout and 'axiomcode-from-landing' not in f.stdout + f.stderr,
              '--from: a common name starts in the language and the file the task\'s words land in', f.stdout + f.stderr)
        f = sh(repo, AX, 'context', 'how does the calc tool total its numbers', '.', '--in', 'tools/gen', '--from', 'main', env=quiet)
        check(f.returncode == 0 and 'tools/gen/make.py' in f.stdout and 'tools/pkg/cli.py' not in f.stdout,
              '--from: a scope the caller gives picks the declaration under it', f.stdout + f.stderr)
        f = sh(repo, AX, 'context', 'how does the shape area get run', '.', '--from', 'main', env=quiet)
        first = f.stdout.split('══')[1] if f.stdout.count('══') >= 2 else f.stdout
        check(f.returncode == 0 and 'src/cli.ts' in f.stdout and not first.strip().startswith('python graph'),
              '--from (control): a task about the typescript code starts there', f.stdout + f.stderr)
        f = sh(repo, AX, 'context', 'how does it work', '.', '--from', 'total', env=quiet)
        check(f.returncode == 0 and 'tools/pkg/calc.py' in f.stdout and '--from total:' not in f.stdout,
              '--from (control): a name declared once starts there, with nothing narrowed', f.stdout + f.stderr)

        # ── compatible ────────────────────────────────────────────────────────────────────────────────────────
        alone = sh(repo, AX, 'impact', 'onlyInTs', '.', env=dict(quiet, AXIOMCODE_GRAPH=os.path.join(repo, '.axiomcode')))
        fan = sh(repo, AX, 'impact', 'onlyInTs', '.', env=quiet)
        check(fan.returncode == 0 and fan.stdout == alone.stdout and '══' not in fan.stdout,
              'compatible: a name only the main graph holds is answered exactly as the main graph answers alone', f"alone:\n{alone.stdout}\nfanned out:\n{fan.stdout}")
        js = sh(repo, AX, 'impact', 'square', '.', '--json', env=quiet)
        try: d = json.loads(js.stdout)
        except ValueError: d = {}
        check('direct' in d and 'other_languages' not in d and any('shape.ts' in (e.get('at') or '') for e in d.get('direct', [])),
              'compatible: --json from one graph is that graph\'s object, unchanged in shape', js.stdout[-800:] + js.stderr)

        # ── changed ───────────────────────────────────────────────────────────────────────────────────────────
        calc = os.path.join(repo, 'tools/pkg/calc.py'); util = os.path.join(repo, 'src/util.ts')
        open(calc, 'w').write(FILES['tools/pkg/calc.py'].replace('return a + b', 'return b + a'))
        open(util, 'w').write(FILES['src/util.ts'].replace('return x * x', 'return x * x * 1'))
        c = sh(repo, AX, 'changed', '.', env=quiet)
        check(c.returncode == 0 and c.stdout.count('add ') == 1 and c.stdout.count('square ') == 1 and 'no declarations known here' not in c.stdout
              and '══ javascript graph' not in c.stdout,
              'changed: a Python edit and a TypeScript edit are each reported once, by the graph of their language', c.stdout + c.stderr)
        cj = sh(repo, AX, 'changed', '.', '--json', env=quiet)
        try: d = json.loads(cj.stdout)
        except ValueError: d = {}
        syms = sorted([e['symbol'] for e in d.get('changed', [])] + [e['symbol'] for o in d.get('other_languages', {}).values() for e in o.get('changed', [])])
        check(syms == ['add', 'square'], 'changed --json: both edits, the other language\'s under other_languages', cj.stdout[-800:])
        t = sh(repo, AX, 'test-impact', '.', env=quiet)
        check(t.returncode == 0 and 'add [body]' in t.stdout and 'square' in t.stdout, 'test-impact: starts from the edits in both languages', t.stdout + t.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        c = sh(repo, AX, 'changed', '.', env=quiet)
        check(c.returncode == 0 and c.stdout.count('no change to a declaration') == 1 and '══' not in c.stdout,
              'changed: a clean tree is one "no change", as in a repository of one language', c.stdout + c.stderr)

        # ── refresh ───────────────────────────────────────────────────────────────────────────────────────────
        open(calc, 'a').write('\n\ndef added_later(xs):\n    return total(xs)\n')
        st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'stale' and 'tools/pkg/calc.py' in st.get('changed', []),
              'refresh: an edit in a language other than the main one makes the graph stale', json.dumps(st))
        q = sh(repo, AX, 'path', 'added_later', 'add', '.', env=env)
        check(q.returncode == 0 and 'verified' in q.stdout, 'refresh: a query refreshes the graphs and finds the new Python function', q.stdout + q.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        settle(repo, quiet)

        # ── --lang ────────────────────────────────────────────────────────────────────────────────────────────
        r = sh(repo, AX, 'index', '.', '--lang', 'typescript', env=quiet)
        check(r.returncode == 0 and (not os.path.exists(lang_dir) or not os.listdir(lang_dir)),
              '--lang: restricting to one language removes the other languages\' graphs', r.stdout + r.stderr)
        g = sh(repo, AX, 'impact', 'add', '.', env=quiet)
        check(g.returncode != 0, '--lang: and a name in a removed language is no longer answered', g.stdout)

        # ── upgrade ───────────────────────────────────────────────────────────────────────────────────────────
        settle(repo, quiet)
        tp = os.path.join(repo, '.axiomcode', 'out', 'files.json'); tab = json.load(open(tp))
        tab.pop('lang_auto', None); json.dump(tab, open(tp, 'w'))       # as a build from before this wrote it
        st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'stale', 'upgrade: a one-language graph from before is stale in a repository with other languages', json.dumps(st))
        # the answer lies in no edited file, so a plain query answers at once from the old graph and queues the
        # rebuild (#1594); --fresh is the query that waits for it
        q = sh(repo, AX, 'impact', 'add', '.', '--fresh', env=env)
        check(q.returncode == 0 and '══ python graph' in q.stdout, 'upgrade: and the first query indexes them', q.stdout + q.stderr)

        # ── control ───────────────────────────────────────────────────────────────────────────────────────────
        one = os.path.join(work, 'one'); make(one, {k: v for k, v in FILES.items() if k.startswith(('src/', 'tsconfig'))})
        b = sh(one, AX, 'index', '.', env=quiet)
        check(b.returncode == 0 and not os.path.exists(os.path.join(one, '.axiomcode', 'lang')) and 'building typescript graph for' in b.stdout,
              'control: a repository in one language builds one graph, as before', b.stdout + b.stderr)
        tab = json.load(open(os.path.join(one, '.axiomcode', 'out', 'files.json')))
        check(tab.get('lang') == 'typescript', 'control: its file table names the one language', json.dumps({k: tab.get(k) for k in ('lang', 'lang_auto')}))
        st = json.loads(sh(one, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'fresh', 'control: and it is fresh', json.dumps(st))

        # ── stopped ───────────────────────────────────────────────────────────────────────────────────────────
        kq = os.path.join(work, 'stopped'); make(kq, FILES)
        ran = stopped_query(kq, quiet, ['impact', 'add', '.'])
        main_db = os.path.join(kq, '.axiomcode', 'out', 'graph.sqlite')
        langs = {l: os.path.exists(os.path.join(kq, '.axiomcode', 'lang', l, 'out', 'graph.sqlite')) for l in ('python', 'javascript')}
        check(ran and os.path.exists(main_db) and all(langs.values()),
              'stopped: a first query stopped mid-build leaves the build running, and it publishes the main graph and every other one',
              json.dumps(dict(build_was_running=ran, main=os.path.exists(main_db), **langs)) + '\n' + ' '.join(sorted(os.listdir(os.path.join(kq, '.axiomcode', 'out')))))
        q = sh(kq, AX, 'impact', 'add', '.', env=quiet)
        check(q.returncode == 0 and '══ python graph' in q.stdout and 'building one' not in q.stderr and 'graph build is' not in q.stderr,
              'stopped: and the next query answers from those graphs, without building again', q.stdout[-600:] + q.stderr[-600:])
        # `axiomcode index` stopped once its main language is solved publishes that graph first
        ki = os.path.join(work, 'stopped-index'); make(ki, FILES)
        prog = os.path.join(ki, '.axiomcode', 'out', '.progress')
        b = subprocess.Popen(['bash', BUILD, ki], cwd=ki, env=quiet, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        solved = until(lambda: 'typescript ok' in (open(prog).read() if os.path.exists(prog) else ''), 600)
        os.killpg(b.pid, signal.SIGTERM); out, _ = b.communicate()
        ptr = os.path.join(ki, '.axiomcode', 'out', 'graph.sqlite')
        check(solved and b.returncode != 0 and os.path.exists(ptr) and os.path.exists(os.path.join(ki, '.axiomcode', 'out', 'stamp')),
              'stopped: an index stopped after its main language is solved publishes that graph before it stops', f'rc={b.returncode} solved={solved}\n{out}')
        q = sh(ki, AX, 'impact', 'square', '.', env=quiet)
        check(q.returncode == 0 and 'area' in q.stdout and 'building one' not in q.stderr,
              'stopped: and a query answers from it without building', q.stdout[-600:] + q.stderr[-600:])
        st = json.loads(sh(ki, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        r = sh(ki, AX, 'index', '.', env=quiet)
        check(st.get('state') == 'stale' and 'up to date' not in r.stdout
              and all(os.path.exists(os.path.join(ki, '.axiomcode', 'lang', l, 'out', 'graph.sqlite')) for l in ('python', 'javascript')),
              'stopped: the languages it did not build leave the graph stale, and the next build builds them', json.dumps(st) + '\n' + r.stdout[-600:])
        # control: stopped before anything is solved, it stops (no graph to keep) and the next query builds one
        kc = os.path.join(work, 'stopped-early'); make(kc, FILES)
        b = subprocess.Popen(['bash', BUILD, kc], cwd=kc, env=quiet, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        until(lambda: building(kc), 60)
        t0 = time.time(); os.killpg(b.pid, signal.SIGTERM); out, _ = b.communicate(); took = time.time() - t0
        check(b.returncode != 0 and took < 15 and not os.path.lexists(os.path.join(kc, '.axiomcode', 'out', 'graph.sqlite')),
              f'control: an index stopped before its main language is solved stops at once ({took:.1f}s) and leaves no graph', f'rc={b.returncode}\n{out}')
        # control: a repository in one language, its first query stopped mid-build, gets its graph the same way
        k1 = os.path.join(work, 'stopped-one'); make(k1, {k: v for k, v in FILES.items() if k.startswith(('src/', 'tsconfig'))})
        ran = stopped_query(k1, quiet, ['impact', 'square', '.'])
        q = sh(k1, AX, 'impact', 'square', '.', env=quiet)
        check(ran and not os.path.exists(os.path.join(k1, '.axiomcode', 'lang')) and q.returncode == 0 and 'area' in q.stdout and 'building one' not in q.stderr,
              'stopped: in a repository of one language too, the stopped first query\'s build completes and the next query answers', q.stdout[-400:] + q.stderr[-400:])

        # ── build output ──────────────────────────────────────────────────────────────────────────────────────
        mvn = os.path.join(work, 'maven'); make(mvn, MAVEN)
        b = sh(mvn, AX, 'index', '.', env=quiet)
        check(b.returncode == 0 and 'building java graph for' in b.stdout and 'javascript 0 ' in b.stdout
              and not os.path.exists(os.path.join(mvn, '.axiomcode', 'lang')),
              'build output: javadoc under target/ and a committed javadoc do not make a Maven repository a JavaScript one', b.stdout + b.stderr)
        n = sh(mvn, AX, 'impact', 'createElem', '.', env=quiet)
        check(n.returncode != 0 and 'nothing named' in n.stdout, 'build output: and no graph answers for javadoc\'s own functions', n.stdout + n.stderr)
        st = json.loads(sh(mvn, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'fresh', 'build output: and the graph is fresh, not waiting on a language it will never build', json.dumps(st))
        web = os.path.join(work, 'maven-web'); make(web, dict(MAVEN, **MAVEN_WEB))
        b = sh(web, AX, 'index', '.', env=quiet)
        # three JavaScript files to one Java file, so JavaScript is the main language and Java the other one
        check(b.returncode == 0 and 'javascript + java' in b.stdout and 'javascript 3 ' in b.stdout
              and os.path.exists(os.path.join(web, '.axiomcode', 'lang', 'java', 'out', 'graph.sqlite')),
              'build output (control): the same repository with JavaScript of its own gets its graph, all three files', b.stdout + b.stderr)
        j = sh(web, AX, 'path', 'start', 'point', '.', env=quiet)
        check(j.returncode == 0 and 'verified' in j.stdout and 'src/main/js/target/aim.js' in j.stdout,
              'build output (control): a directory named target that no pom.xml owns is source', j.stdout + j.stderr)
        n = sh(web, AX, 'impact', 'createElem', '.', env=quiet)
        check(n.returncode != 0 and 'nothing named' in n.stdout, 'build output (control): and javadoc\'s functions are still not in it', n.stdout + n.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all passed'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
